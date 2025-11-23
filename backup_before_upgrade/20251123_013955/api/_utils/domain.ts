/**
 * Domain and URL utility functions
 */

/**
 * Validate if a string is a valid HTTP/HTTPS URL
 */
export function isValidHttpUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Extract domain (hostname) from a URL
 * Handles both full URLs and domain-only strings
 */
export function extractDomain(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  
  const trimmed = url.trim();
  if (!trimmed) return null;
  
  // If it's already a domain-like string (no protocol), try to extract
  if (!trimmed.includes('://') && !trimmed.startsWith('/')) {
    // Remove path, query, fragment if present
    const domainPart = trimmed.split('/')[0].split('?')[0].split('#')[0];
    // Basic validation - should contain at least one dot or be a valid TLD
    if (domainPart.includes('.') || domainPart.match(/^[a-z0-9-]+$/i)) {
      return domainPart.replace(/^www\./i, '');
    }
  }
  
  // Try parsing as URL
  try {
    // If no protocol, add https://
    const urlToParse = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
    const u = new URL(urlToParse);
    return u.hostname ? u.hostname.replace(/^www\./i, '') : null;
  } catch {
    return null;
  }
}

/**
 * Ensure a URL is absolute by resolving it against a base URL
 */
export function ensureAbsolute(href: string, base: string): string {
  if (!href) return base;
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

/**
 * Check if URL is a stream URL (not a homepage)
 */
export function isStreamUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  // Common stream URL patterns
  return /\.(mp3|m3u8?|pls|aac|ogg|wav|flac|wma)(\?|$)/i.test(lower) ||
         /\/stream/i.test(lower) ||
         /\/listen/i.test(lower) ||
         /icecast|shoutcast|streaming/i.test(lower);
}

/**
 * Normalize homepage URL - prepend https:// if missing, clean garbage values
 * Filters out stream URLs
 */
export function normalizeHomepage(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  
  const trimmed = url.trim();
  if (!trimmed) return null;
  
  // Remove garbage values
  const garbage = ['0', 'none', 'unknown', 'http://', 'https://'];
  if (garbage.includes(trimmed.toLowerCase())) return null;
  
  // Filter out stream URLs - these are not homepages
  if (isStreamUrl(trimmed)) return null;
  
  // If already a valid URL, return as-is
  if (isValidHttpUrl(trimmed)) return trimmed;
  
  // If starts with //, prepend https:
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  
  // If doesn't start with http, prepend https://
  if (!trimmed.match(/^https?:\/\//i)) {
    return `https://${trimmed}`;
  }
  
  return trimmed;
}

/**
 * Clean domain name - remove www. prefix
 */
export function cleanDomain(domain: string): string {
  if (!domain || typeof domain !== 'string') return '';
  return domain.replace(/^www\./i, '').toLowerCase();
}

