/**
 * Playlist Parser
 * Fetches and parses M3U/M3U8/PLS playlist files to extract actual stream URLs
 * This enables dynamic stream discovery instead of hardcoded URL patterns
 */

/**
 * Parse a playlist URL to extract the actual stream URL
 * Supports M3U, M3U8, and PLS formats
 * @param url - URL to the playlist file or direct stream URL
 * @returns The actual stream URL from the playlist, or original URL if not a playlist
 */
export async function parsePlaylist(url: string): Promise<string> {
  // If not a playlist, return as is
  if (!url.endsWith('.m3u') && !url.endsWith('.m3u8') && !url.endsWith('.pls')) {
    return url;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`Failed to fetch playlist ${url}: ${response.statusText}`);
      return url; // Return original URL on failure
    }

    const text = await response.text();

    // Handle M3U/M3U8 format
    if (url.endsWith('.m3u') || url.endsWith('.m3u8')) {
      // Find the first line starting with http or https
      const lines = text.split('\n');
      const streamUrl = lines.find((line: string) => {
        const trimmed = line.trim();
        return trimmed.startsWith('http://') || trimmed.startsWith('https://');
      });
      
      if (streamUrl) {
        return streamUrl.trim();
      }
    }
    
    // Handle PLS format
    if (url.endsWith('.pls')) {
      // Parse PLS: Look for File1=(http...)
      const match = text.match(/File\d+=(https?:\/\/[^\s\r\n]+)/i);
      if (match) {
        return match[1];
      }
    }

    // If parsing fails, return original URL
    console.warn(`Could not parse playlist format for ${url}`);
    return url;
  } catch (error) {
    console.error(`Failed to parse playlist ${url}:`, error);
    return url; // Return original URL on failure
  }
}

/**
 * Check if a URL is a playlist URL
 * @param url - URL to check
 * @returns True if the URL appears to be a playlist file
 */
export function isPlaylistUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return (
    lowerUrl.endsWith('.m3u') ||
    lowerUrl.endsWith('.m3u8') ||
    lowerUrl.endsWith('.pls') ||
    lowerUrl.includes('/playlist') ||
    lowerUrl.includes('/stream.m3u8')
  );
}

