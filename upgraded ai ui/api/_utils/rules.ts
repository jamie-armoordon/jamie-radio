/**
 * Special rules for UK radio stations and common patterns
 */

import * as cheerio from 'cheerio';
import { extractDomain, ensureAbsolute } from './domain.js';
import { fetchImage } from './fetchImage.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * BBC station ID to iChef slug mapping
 */
const BBC_LOGO_MAP: Record<string, string> = {
  'bbc_radio_one': 'radio1',
  'bbc_radio_one_london': 'radio1',
  'bbc_radio_one_anthems': 'radio1',
  'bbc_radio_one_anthems_london': 'radio1',
  'bbc_radio_one_dance': 'radio1',
  'bbc_radio_one_dance_london': 'radio1',
  'bbc_radio_two': 'radio2',
  'bbc_radio_two_london': 'radio2',
  'bbc_radio_three': 'radio3',
  'bbc_radio_three_london': 'radio3',
  'bbc_radio_three_unwind': 'radio3',
  'bbc_radio_three_unwind_london': 'radio3',
  'bbc_radio_fourfm': 'radio4',
  'bbc_radio_fourfm_london': 'radio4',
  'bbc_radio_four_extra': 'radio4extra',
  'bbc_radio_four_extra_london': 'radio4extra',
  'bbc_radio_five_live': 'radio5live',
  'bbc_radio_five_live_london': 'radio5live',
  'bbc_radio_five_live_sports_extra': 'radio5livesportsextra',
  'bbc_radio_five_live_sports_extra_london': 'radio5livesportsextra',
  'bbc_6music': '6music',
  'bbc_6music_london': '6music',
  'bbc_1xtra': '1xtra',
  'bbc_1xtra_london': '1xtra',
  'bbc_asian_network': 'asiannetwork',
  'bbc_asian_network_london': 'asiannetwork',
  'bbc_world_service': 'worldservice',
  'bbc_world_service_london': 'worldservice',
  'bbc_london': 'london',
};

/**
 * Normalize station ID/name for Global/Bauer networks
 */
function normalizeStationId(id: string | undefined): string {
  if (!id) return '';
  return id
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/uk$/, '')
    .replace(/london$/, '')
    .replace(/kent$/, '');
}

/**
 * Check if domain is a BBC domain
 */
function isBBCDomain(domain: string): boolean {
  return domain.includes('bbc.co.uk') || domain.includes('bbc.com');
}

/**
 * Check if domain is a Global Radio domain
 */
function isGlobalDomain(domain: string): boolean {
  return domain.includes('globalplayer.com') || 
         domain.includes('capitalfm.com') || 
         domain.includes('heart.co.uk') || 
         domain.includes('lbc.co.uk') ||
         domain.includes('radiox.co.uk') ||
         domain.includes('classicfm.com') ||
         domain.includes('smoothradio.com');
}

/**
 * Check if domain is a Bauer domain
 */
function isBauerDomain(domain: string): boolean {
  return domain.includes('planetradio.co.uk') || 
         domain.includes('kissfmuk.com') || 
         domain.includes('magic.co.uk') ||
         domain.includes('absoluteradio.co.uk') ||
         domain.includes('planetrock.co.uk') ||
         domain.includes('jazzfm.com') ||
         domain.includes('kerrangradio.com') ||
         domain.includes('scalaradio.co.uk');
}

/**
 * Detect WordPress site
 */
async function detectWordPress(homepage: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(homepage, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) return false;
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Check for WordPress meta tags
    const generator = $('meta[name="generator"]').attr('content') || '';
    if (generator.toLowerCase().includes('wordpress')) return true;
    
    // Check for WordPress API link
    if ($('link[rel="https://api.w.org/"]').length > 0) return true;
    
    // Check for wp-content in HTML
    if (html.includes('/wp-content/')) return true;
    
    return false;
  } catch {
    return false;
  }
}

/**
 * Try WordPress favicon paths
 */
async function tryWordPressFavicons(homepage: string): Promise<string | null> {
  const baseUrl = homepage.replace(/\/$/, '');
  const currentYear = new Date().getFullYear();
  const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
  
  // Common WordPress favicon paths
  const paths = [
    '/wp-content/uploads/favicon.png',
    '/wp-content/uploads/logo.png',
    '/wp-content/uploads/icon.png',
    `/wp-content/uploads/${currentYear}/${currentMonth}/site-icon-32x32.png`,
    `/wp-content/uploads/${currentYear}/${currentMonth}/site-icon-512x512.png`,
    `/wp-content/uploads/${currentYear}/${currentMonth}/favicon.png`,
    `/wp-content/uploads/${currentYear}/${currentMonth}/logo.png`,
  ];
  
  // Also try with wildcard patterns (common uploads folder structure)
  for (let year = currentYear; year >= currentYear - 2; year--) {
    for (let month = 12; month >= 1; month--) {
      const monthStr = String(month).padStart(2, '0');
      paths.push(`/wp-content/uploads/${year}/${monthStr}/favicon.png`);
      paths.push(`/wp-content/uploads/${year}/${monthStr}/logo.png`);
      paths.push(`/wp-content/uploads/${year}/${monthStr}/site-icon-*.png`);
    }
  }
  
  // Try each path
  for (const path of paths) {
    // Skip wildcard patterns for now (would need directory listing)
    if (path.includes('*')) continue;
    
    const url = `${baseUrl}${path}`;
    const validated = await fetchImage(url);
    if (validated) return validated;
  }
  
  return null;
}

/**
 * Try root-level favicon paths
 */
async function tryRootFavicons(homepage: string): Promise<string | null> {
  const baseUrl = homepage.replace(/\/$/, '');
  const paths = ['/favicon.ico', '/favicon.png', '/favicon.jpg', '/logo.png', '/logo.jpg'];
  
  for (const path of paths) {
    const url = `${baseUrl}${path}`;
    const validated = await fetchImage(url);
    if (validated) return validated;
  }
  
  return null;
}

/**
 * Apply special rules for UK stations and common patterns
 */
export async function applySpecialRules(
  domain: string,
  homepage: string,
  stationId?: string,
  discoveryId?: string,
  stationName?: string
): Promise<string | null> {
  if (!domain || !homepage) return null;
  
  const domainLower = domain.toLowerCase();
  
  // 1. BBC Rules
  if (isBBCDomain(domainLower) && stationId) {
    const slug = BBC_LOGO_MAP[stationId];
    if (slug) {
      const bbcUrl = `https://ichef.bbci.co.uk/images/ic/512x512/${slug}.png`;
      const validated = await fetchImage(bbcUrl);
      if (validated) return validated;
    }
  }
  
  // 2. Global Radio Rules
  if (isGlobalDomain(domainLower)) {
    const candidates = [
      stationId,
      discoveryId,
      stationName ? normalizeStationId(stationName) : null,
    ].filter(Boolean) as string[];
    
    for (const candidate of candidates) {
      const normalized = normalizeStationId(candidate);
      if (!normalized) continue;
      
      const globalUrl = `https://assets.globalplayer.com/stations/${normalized}/logo.png`;
      const validated = await fetchImage(globalUrl);
      if (validated) return validated;
    }
  }
  
  // 3. Bauer Radio Rules
  if (isBauerDomain(domainLower)) {
    const candidates = [
      stationId,
      discoveryId,
      stationName ? normalizeStationId(stationName) : null,
    ].filter(Boolean) as string[];
    
    for (const candidate of candidates) {
      const normalized = normalizeStationId(candidate);
      if (!normalized) continue;
      
      const bauerUrl = `https://assets.planetradio.co.uk/img/logos/${normalized}.png`;
      const validated = await fetchImage(bauerUrl);
      if (validated) return validated;
    }
  }
  
  // 4. WordPress Detection and Favicon Paths
  const isWordPress = await detectWordPress(homepage);
  if (isWordPress) {
    const wpFavicon = await tryWordPressFavicons(homepage);
    if (wpFavicon) return wpFavicon;
  }
  
  // 5. Root-level favicons (try regardless of WordPress)
  const rootFavicon = await tryRootFavicons(homepage);
  if (rootFavicon) return rootFavicon;
  
  // 6. Radio Browser fallback (if stream domain available)
  // This would require stream URL, which we don't have in this context
  // Could be added later if needed
  
  return null;
}
