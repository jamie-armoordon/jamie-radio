/**
 * Extract HTML icon links from homepage
 */

import * as cheerio from 'cheerio';
import { ensureAbsolute } from './domain.js';
import { fetchImage } from './fetchImage.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

interface IconCandidate {
  url: string;
  size: number;
}

/**
 * Parse size string like "32x32" or "512" to get numeric size
 */
function parseSize(sizeStr: string | undefined): number {
  if (!sizeStr) return 0;
  
  // Handle "32x32" format
  const match = sizeStr.match(/(\d+)x\d+/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  
  // Handle single number "512"
  const single = parseInt(sizeStr, 10);
  if (!isNaN(single)) return single;
  
  return 0;
}

/**
 * Extract HTML icons from homepage
 * Returns highest quality validated icon URL or null
 */
export async function extractHTMLIcons(homepage: string): Promise<string | null> {
  if (!homepage) return null;
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(homepage, {
      headers: {
        'User-Agent': USER_AGENT,
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) return null;
    
    const html = await response.text();
    const baseUrl = response.url || homepage;
    const $ = cheerio.load(html);
    
    const candidates: IconCandidate[] = [];
    
    // Find all relevant link tags
    $('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').each((_, el) => {
      const href = $(el).attr('href');
      const sizes = $(el).attr('sizes');
      const rel = $(el).attr('rel');
      
      if (!href) return;
      
      const absoluteUrl = ensureAbsolute(href, baseUrl);
      const size = parseSize(sizes);
      
      // Prioritize apple-touch-icon (usually higher quality)
      const priority = rel?.includes('apple-touch-icon') ? 1000 : 0;
      
      candidates.push({
        url: absoluteUrl,
        size: size + priority,
      });
    });
    
    if (candidates.length === 0) return null;
    
    // Sort by size descending
    candidates.sort((a, b) => b.size - a.size);
    
    // Try each candidate in order, return first valid one
    for (const candidate of candidates) {
      const validated = await fetchImage(candidate.url);
      if (validated) return validated;
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

