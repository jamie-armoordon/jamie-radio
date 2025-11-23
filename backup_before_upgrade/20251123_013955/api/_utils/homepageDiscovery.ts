/**
 * Homepage Discovery Utility
 * Discovers official station homepages using RadioBrowser and DuckDuckGo fallback
 */

import * as cheerio from 'cheerio';
import { normalizeHomepage, isStreamUrl } from './domain.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// RadioBrowser API mirrors for redundancy
const RADIOBROWSER_MIRRORS = [
  'https://at1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://de1.api.radio-browser.info',
];

const TIMEOUT_MS = 5000;

/**
 * Try a RadioBrowser API call with mirror fallback (reused from radiobrowser.ts logic)
 */
async function tryRadioBrowserRequest(path: string): Promise<any> {
  for (const base of RADIOBROWSER_MIRRORS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
      
      const url = `${base}${path}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      // Silently try next mirror
      continue;
    }
  }
  
  return null;
}

/**
 * Search RadioBrowser for station homepage
 * Uses direct RadioBrowser API with mirror redundancy
 */
async function searchRadioBrowser(stationName: string): Promise<string | null> {
  const searchName = encodeURIComponent(stationName);
  const path = `/json/stations/search?name=${searchName}&countrycode=GB&limit=5&order=clickcount&reverse=true&hidebroken=true`;
  
  const stations: any[] = await tryRadioBrowserRequest(path);
  
  if (stations && stations.length > 0) {
    // Find best match - exact name match first
    const exactMatch = stations.find(s => 
      s.name?.toLowerCase() === stationName.toLowerCase()
    );
    if (exactMatch?.homepage) {
      const homepage = normalizeHomepage(exactMatch.homepage);
      if (homepage && !isStreamUrl(homepage)) {
        return homepage;
      }
    }
    
    // Try first result if no exact match
    const first = stations[0];
    if (first?.homepage) {
      const homepage = normalizeHomepage(first.homepage);
      if (homepage && !isStreamUrl(homepage)) {
        return homepage;
      }
    }
  }
  
  return null;
}

/**
 * Search DuckDuckGo for official site
 */
async function searchDuckDuckGo(stationName: string): Promise<string | null> {
  try {
    // Try API first
    const query = encodeURIComponent(`${stationName} official site`);
    const apiUrl = `https://api.duckduckgo.com/?q=${query}&format=json&no_html=1&skip_disambig=1`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': USER_AGENT,
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data: any = await response.json();
      
      // Check AbstractURL
      if (data.AbstractURL) {
        const homepage = normalizeHomepage(data.AbstractURL);
        if (homepage && !isStreamUrl(homepage)) {
          return homepage;
        }
      }
      
      // Check RelatedTopics
      if (data.RelatedTopics && Array.isArray(data.RelatedTopics) && data.RelatedTopics.length > 0) {
        for (const topic of data.RelatedTopics) {
          if (topic.FirstURL) {
            const homepage = normalizeHomepage(topic.FirstURL);
            if (homepage && !isStreamUrl(homepage)) {
              return homepage;
            }
          }
        }
      }
    }
  } catch (error) {
    // API failed, try HTML scraping
  }
  
  // Fallback: Scrape HTML version
  try {
    const query = encodeURIComponent(`${stationName} official site`);
    const htmlUrl = `https://html.duckduckgo.com/html/?q=${query}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS * 2);
    
    const response = await fetch(htmlUrl, {
      headers: {
        'User-Agent': USER_AGENT,
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const html = await response.text();
      const $ = cheerio.load(html);
      
      // Look for first result link
      const firstResult = $('.result__a').first();
      if (firstResult.length > 0) {
        const href = firstResult.attr('href');
        if (href) {
          // DuckDuckGo uses redirect URLs, extract actual URL
          const match = href.match(/uddg=([^&]+)/);
          if (match) {
            const decoded = decodeURIComponent(match[1]);
            const homepage = normalizeHomepage(decoded);
            if (homepage && !isStreamUrl(homepage)) {
              return homepage;
            }
          }
        }
      }
    }
  } catch (error) {
    // HTML scraping failed
  }
  
  return null;
}

/**
 * Discover homepage for a station
 * Tries RadioBrowser first, then DuckDuckGo as fallback
 */
export async function discoverHomepage(stationName: string): Promise<string | null> {
  if (!stationName || typeof stationName !== 'string') {
    return null;
  }
  
  // Try RadioBrowser first (most reliable for radio stations)
  const rbHomepage = await searchRadioBrowser(stationName);
  if (rbHomepage) {
    return rbHomepage;
  }
  
  // Fallback to DuckDuckGo
  const ddgHomepage = await searchDuckDuckGo(stationName);
  if (ddgHomepage) {
    return ddgHomepage;
  }
  
  return null;
}

