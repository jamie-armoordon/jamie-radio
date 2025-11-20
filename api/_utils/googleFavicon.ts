/**
 * Google S2 favicon fallback
 */

/**
 * Generate Google S2 favicon URL (256px)
 * This is a guaranteed fallback - always returns a URL
 */
export function getGoogleFavicon(domain: string): string {
  // Use google.com as universal fallback - always returns 200, never geo-blocks, extremely cache-friendly
  if (!domain) domain = 'google.com';
  
  return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=256`;
}

