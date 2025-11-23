/**
 * Smart image fetcher with timeout, redirect following, and MIME validation
 */

const DEFAULT_TIMEOUT = 3000; // 3 seconds
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Fetch an image URL with validation
 * Returns the final resolved URL if valid, null otherwise
 * Never throws - always returns null on failure
 */
export async function fetchImage(url: string, timeoutMs: number = DEFAULT_TIMEOUT): Promise<string | null> {
  if (!url || typeof url !== 'string') return null;
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    // Check if response is OK
    if (!response.ok) return null;
    
    // Get final URL after redirects
    const finalUrl = response.url;
    
    // Check MIME type
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      return null;
    }
    
    return finalUrl;
  } catch (error) {
    // Silently fail - return null
    return null;
  }
}

/**
 * Fetch image as buffer for proxying
 * Returns buffer and content-type if valid, null otherwise
 */
export async function fetchImageBuffer(url: string, timeoutMs: number = DEFAULT_TIMEOUT): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!url || typeof url !== 'string') {
    console.error('[fetchImageBuffer] Invalid URL:', url);
    return null;
  }
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    // Check if response is OK
    if (!response.ok) {
      console.error('[fetchImageBuffer] Response not OK:', response.status, response.statusText, 'for URL:', url);
      return null;
    }
    
    // Check MIME type
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      console.error('[fetchImageBuffer] Invalid content-type:', contentType, 'for URL:', url);
      return null;
    }
    
    // Get image as buffer
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    return { buffer, contentType };
  } catch (error) {
    console.error('[fetchImageBuffer] Error fetching image:', error);
    if (error instanceof Error) {
      console.error('[fetchImageBuffer] Error message:', error.message);
    }
    return null;
  }
}
