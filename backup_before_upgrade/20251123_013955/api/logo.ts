/**
 * Maximum Success Rate Logo Resolver
 * Orchestrates all logo resolution strategies with caching and parallel execution
 */

import type { Request, Response } from 'express';
import { normalizeHomepage, extractDomain, cleanDomain } from './_utils/domain.js';
import { getCached, setCached, clearCached } from './_utils/cache.js';
import { extractOGImage } from './_utils/ogImage.js';
import { extractHTMLIcons } from './_utils/htmlIcons.js';
import { applySpecialRules } from './_utils/rules.js';
import { fetchImage, fetchImageBuffer } from './_utils/fetchImage.js';
import { getGoogleFavicon } from './_utils/googleFavicon.js';
import { raceResolvers } from './_utils/parallel.js';
import { discoverHomepage } from './_utils/homepageDiscovery.js';

/**
 * Clearbit logo fallback
 */
async function clearbitResolve(domain: string): Promise<string | null> {
  if (!domain) return null;
  const clearbitUrl = `https://logo.clearbit.com/${domain}`;
  return await fetchImage(clearbitUrl);
}

/**
 * Main logo handler
 */
export default async function handler(req: Request, res: Response): Promise<void> {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  // Cache for 1 day, but allow revalidation
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, must-revalidate');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  try {
    // Helper to check if URL is a Google favicon (don't cache these)
    const isGoogleFavicon = (url: string): boolean => {
      return url.includes('gstatic.com/faviconV2') || url.includes('google.com/favicon');
    };
    
    // Extract query parameters
    const homepage = (req.query.url as string) || '';
    const fallback = (req.query.fallback as string) || '';
    const stationId = (req.query.stationId as string) || undefined;
    const discoveryId = (req.query.discoveryId as string) || undefined;
    const stationName = (req.query.stationName as string) || undefined;
    
    // Normalize homepage (filters out stream URLs)
    let finalHomepage = normalizeHomepage(homepage);
    if (!finalHomepage && fallback) {
      finalHomepage = normalizeHomepage(fallback);
    }
    
    // If no homepage but we have stationName, try homepage discovery
    if (!finalHomepage && stationName) {
      // Check cache for discovered homepage
      const cacheKey = `homepage_${stationName.toLowerCase()}`;
      const cachedHomepage = getCached(cacheKey);
      if (cachedHomepage) {
        finalHomepage = cachedHomepage;
      } else {
        // Discover homepage using RadioBrowser -> DuckDuckGo
        console.log(`[Logo Handler] Discovering homepage for: ${stationName}`);
        const discovered = await discoverHomepage(stationName);
        if (discovered) {
          finalHomepage = discovered;
          // Cache discovered homepage for 7 days
          setCached(cacheKey, discovered);
          console.log(`[Logo Handler] Discovered homepage: ${discovered}`);
        }
      }
    }
    
    // Extract and clean domain (only from valid homepages, not stream URLs)
    let domain: string | null = null;
    if (finalHomepage) {
      domain = extractDomain(finalHomepage);
      // If domain looks like a stream server (contains 'stream', 'icecast', etc), ignore it
      if (domain && /stream|icecast|shoutcast|edge-|cdn-|media-/i.test(domain)) {
        domain = null;
      }
    }
    
    // If no domain, use google.com as universal fallback
    if (!domain) {
      domain = 'google.com';
    }
    
    // Clean domain for cache key
    const cleanDomainKey = cleanDomain(domain);
    
    // Also create a station-specific cache key for more reliable caching
    const stationCacheKey = stationName ? `logo_${stationName.toLowerCase()}_${cleanDomainKey}` : null;
    
    // Check cache first - try station-specific key, then domain key
    let cachedUrl: string | null = null;
    let cacheSource = '';
    if (stationCacheKey) {
      cachedUrl = getCached(stationCacheKey);
      if (cachedUrl) cacheSource = 'station-cache';
    }
    if (!cachedUrl) {
      cachedUrl = getCached(cleanDomainKey);
      if (cachedUrl) cacheSource = 'domain-cache';
    }
    
    if (cachedUrl) {
      // If cached URL is a Google favicon, skip it and re-resolve (Google favicons shouldn't be cached)
      if (isGoogleFavicon(cachedUrl)) {
        console.log(`[Logo Handler] Skipping cached Google favicon, re-resolving for ${stationName || cleanDomainKey}`);
        if (stationCacheKey) {
          clearCached(stationCacheKey);
        }
        clearCached(cleanDomainKey);
        cachedUrl = null; // Force re-resolution
      } else {
        console.log(`[Logo Handler] Using cached logo from ${cacheSource} for ${stationName || cleanDomainKey}: ${cachedUrl}`);
        // Always proxy the cached image - never redirect
        const imageData = await fetchImageBuffer(cachedUrl, 5000);
        if (imageData) {
          res.setHeader('Content-Type', imageData.contentType);
          res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
          res.send(imageData.buffer);
          return;
        }
        // If proxying cached URL fails, clear the bad cache entry and fall through
        console.warn(`[Logo Handler] Cached URL failed to proxy: ${cachedUrl}, clearing cache and re-resolving`);
        if (stationCacheKey) {
          clearCached(stationCacheKey);
        }
        // Also clear domain-based cache if it was the same URL
        const domainCached = getCached(cleanDomainKey);
        if (domainCached === cachedUrl) {
          clearCached(cleanDomainKey);
        }
      }
    }
    
    // If no homepage, try Google fallback immediately (don't cache)
    if (!finalHomepage) {
      const googleUrl = getGoogleFavicon(domain);
      // Don't cache Google favicon URLs - they're fallbacks
      console.log('[Logo Handler] No homepage, proxying Google favicon (not cached):', googleUrl);
      const imageData = await fetchImageBuffer(googleUrl, 5000);
      if (imageData) {
        res.setHeader('Content-Type', imageData.contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.send(imageData.buffer);
        return;
      }
      // If proxying Google fails, try again with longer timeout
      const retryData = await fetchImageBuffer(googleUrl, 10000);
      if (retryData) {
        res.setHeader('Content-Type', retryData.contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.send(retryData.buffer);
        return;
      }
      // Last resort: try to fetch Google favicon directly (should always work)
      // This should never fail, but if it does, we'll return a 1x1 transparent PNG
      console.error('[Logo Handler] Failed to proxy Google favicon after retry, using direct fetch');
      try {
        const directResponse = await fetch(googleUrl, { 
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(15000)
        });
        if (directResponse.ok) {
          const buffer = Buffer.from(await directResponse.arrayBuffer());
          const contentType = directResponse.headers.get('content-type') || 'image/png';
          res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
          res.send(buffer);
          return;
        }
      } catch (e) {
        console.error('[Logo Handler] Direct fetch also failed:', e);
      }
      // Absolute last resort: return a 1x1 transparent PNG
      const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
      res.send(transparentPng);
      return;
    }
    
    // Build parallel resolvers
    const resolvers: Array<() => Promise<string | null>> = [
      // 1. Try fallback URL directly if it's a valid image URL (highest priority)
      () => {
        if (!fallback) return Promise.resolve(null);
        // Check if fallback looks like an image URL
        const lower = fallback.toLowerCase();
        if (/\.(png|jpg|jpeg|gif|svg|webp|ico)(\?|$)/i.test(lower) || lower.includes('/logo') || lower.includes('/favicon')) {
          return fetchImage(fallback);
        }
        return Promise.resolve(null);
      },
      
      // 2. Special rules (BBC/Global/Bauer/WordPress) - high priority for UK stations
      () => applySpecialRules(domain, finalHomepage, stationId, discoveryId, stationName),
      
      // 3. OG image extraction
      () => extractOGImage(finalHomepage),
      
      // 4. HTML icon extraction
      () => extractHTMLIcons(finalHomepage),
      
      // 5. Clearbit fallback (may be blocked by ad blockers, but we try anyway)
      () => clearbitResolve(domain),
    ];
    
    // Run all resolvers in parallel
    const result = await raceResolvers(resolvers, 10000); // 10 second timeout
    
    // If we got a result, cache and proxy
    if (result) {
      console.log(`[Logo Handler] Resolved logo for ${stationName || cleanDomainKey}: ${result}`);
      
      // Only cache if it's not a Google favicon (fallback)
      if (!isGoogleFavicon(result)) {
        // Cache by both domain and station name for reliability
        setCached(cleanDomainKey, result);
        if (stationCacheKey) {
          setCached(stationCacheKey, result);
        }
      } else {
        console.log('[Logo Handler] Skipping cache for Google favicon fallback');
      }
      const imageData = await fetchImageBuffer(result, 5000);
      if (imageData) {
        res.setHeader('Content-Type', imageData.contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.send(imageData.buffer);
        return;
      }
      // If proxying result fails, try with longer timeout
      const retryData = await fetchImageBuffer(result, 10000);
      if (retryData) {
        res.setHeader('Content-Type', retryData.contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.send(retryData.buffer);
        return;
      }
      // If still fails, fall through to Google fallback
    }
    
    // Final fallback: Google S2 favicon (guaranteed)
    // Don't cache Google favicon URLs - they're fallbacks and should be fetched fresh
    const googleUrl = getGoogleFavicon(domain);
    console.log('[Logo Handler] All resolvers failed, using Google favicon fallback (not cached):', googleUrl);
    const imageData = await fetchImageBuffer(googleUrl, 5000);
    if (imageData) {
      res.setHeader('Content-Type', imageData.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
      res.send(imageData.buffer);
      return;
    }
    // Retry with longer timeout
    const retryData = await fetchImageBuffer(googleUrl, 10000);
    if (retryData) {
      res.setHeader('Content-Type', retryData.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
      res.send(retryData.buffer);
      return;
    }
    // Last resort: try direct fetch of Google favicon
    console.error('[Logo Handler] Failed to proxy Google favicon after all retries, using direct fetch');
    try {
      const directResponse = await fetch(googleUrl, { 
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15000)
      });
      if (directResponse.ok) {
        const buffer = Buffer.from(await directResponse.arrayBuffer());
        const contentType = directResponse.headers.get('content-type') || 'image/png';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.send(buffer);
        return;
      }
    } catch (e) {
      console.error('[Logo Handler] Direct fetch failed:', e);
    }
    // Absolute last resort: return a 1x1 transparent PNG
    const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    res.send(transparentPng);
    
  } catch (error) {
    // Never throw - always return a valid fallback
    console.error('[Logo Handler] Error:', error);
    let domain = 'google.com';
    const urlParam = (req.query.url as string) || '';
    if (urlParam) {
      const extracted = extractDomain(urlParam);
      if (extracted && !/stream|icecast|shoutcast|edge-|cdn-|media-/i.test(extracted)) {
        domain = extracted;
      }
    }
    const googleUrl = getGoogleFavicon(domain);
    console.log('[Logo Handler] Error fallback, proxying Google favicon:', googleUrl);
    try {
      const imageData = await fetchImageBuffer(googleUrl, 10000);
      if (imageData) {
        res.setHeader('Content-Type', imageData.contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.send(imageData.buffer);
        return;
      }
    } catch (proxyError) {
      console.error('[Logo Handler] Proxy error:', proxyError);
    }
    // Final fallback: try direct fetch
    try {
      const directResponse = await fetch(googleUrl, { 
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15000)
      });
      if (directResponse.ok) {
        const buffer = Buffer.from(await directResponse.arrayBuffer());
        const contentType = directResponse.headers.get('content-type') || 'image/png';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.send(buffer);
        return;
      }
    } catch (e) {
      console.error('[Logo Handler] Direct fetch in catch block failed:', e);
    }
    // Absolute last resort: return a 1x1 transparent PNG (never return 500)
    const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    res.send(transparentPng);
  }
}
