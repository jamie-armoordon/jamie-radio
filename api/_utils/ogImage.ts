/**
 * Extract Open Graph image from homepage HTML
 */

import * as cheerio from 'cheerio';
import { ensureAbsolute } from './domain.js';
import { fetchImage } from './fetchImage.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Extract OG image from homepage
 * Returns validated image URL or null
 */
export async function extractOGImage(homepage: string): Promise<string | null> {
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
    
    // Try <meta property="og:image">
    let ogImage = $('meta[property="og:image"]').attr('content');
    
    // Fallback to <meta name="og:image">
    if (!ogImage) {
      ogImage = $('meta[name="og:image"]').attr('content');
    }
    
    if (!ogImage) return null;
    
    // Resolve absolute URL
    const absoluteUrl = ensureAbsolute(ogImage, baseUrl);
    
    // Validate with fetchImage
    return await fetchImage(absoluteUrl);
  } catch (error) {
    return null;
  }
}

