/**
 * RadioFeeds Discovery Service
 * Queries RadioFeeds.co.uk to discover stream URLs for commercial UK stations
 */

export interface RadioFeedsResult {
  station: string;
  urls: string[];
  sourceUrl: string;
}

export class RadioFeedsDiscovery {
  static baseUrl = 'http://www.radiofeeds.co.uk';

  // Quick lookup map for common stations
  static quickStations: Record<string, string> = {
    capital: 'Capital+FM',
    heart: 'Heart',
    kiss: 'KISS',
    lbc: 'LBC',
    classic: 'Classic+FM',
    absolute: 'Absolute+Radio',
    virgin: 'Virgin+Radio',
    smooth: 'Smooth+Radio',
    magic: 'Magic',
    radiox: 'Radio+X',
  };

  /**
   * Search for station streams on RadioFeeds
   * @param stationName - Station name to search for
   * @returns Promise with station info and stream URLs
   */
  static async searchStation(stationName: string): Promise<RadioFeedsResult | null> {
    try {
      const query = encodeURIComponent(stationName);
      const url = `${this.baseUrl}/query.asp?feedme=${query}`;

      // Use a CORS proxy or fetch with no-cors mode
      // Note: This may require a backend proxy due to CORS restrictions
      await fetch(url, {
        mode: 'no-cors', // May not work due to CORS, but try anyway
        credentials: 'omit',
      });

      // If no-cors mode, we can't read the response
      // For now, return null and let the fallback handle it
      // In production, this would need a backend proxy
      console.warn('RadioFeeds query requires backend proxy due to CORS restrictions');
      return null;
    } catch (error) {
      console.error(`Error searching RadioFeeds for ${stationName}:`, error);
      return null;
    }
  }

  /**
   * Extract stream URLs from HTML content
   * @param html - HTML content to parse
   * @returns Array of stream URLs found
   */
  static extractStreamUrls(html: string): string[] {
    const urls: string[] = [];

    // Look for common stream URL patterns
    const patterns = [
      /https?:\/\/[^\s"<>]+\.(?:aac|mp3|m3u8|pls)[^\s"<>]*/gi,
      /StreamUrl["']\s*:\s*["']([^"']+)["']*/gi,
      /src=["']([^"']+\.(?:aac|mp3|m3u8|pls)[^"']*)['"]/gi,
      /href=["']([^"']+\.(?:aac|mp3|m3u8|pls)[^"']*)['"]/gi,
    ];

    patterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1] || match[0];
        if (url && !urls.includes(url)) {
          urls.push(url);
        }
      }
    });

    return urls;
  }

  /**
   * Quick lookup for common stations
   * @param abbreviation - Station abbreviation (e.g., 'capital', 'heart')
   * @returns Promise with station info
   */
  static async getQuickStation(abbreviation: string): Promise<RadioFeedsResult | null> {
    const stationName = this.quickStations[abbreviation.toLowerCase()];
    if (!stationName) {
      console.warn(`Unknown station abbreviation: ${abbreviation}`);
      return null;
    }
    return this.searchStation(stationName);
  }

  /**
   * Get known Planet Radio stream URLs (predictable pattern)
   * @param stationCode - Station code (e.g., 'smoothfm', 'magicfm')
   * @param quality - 'high' for AAC, 'standard' for MP3
   * @returns Stream URL
   */
  static getPlanetRadioUrl(stationCode: string, quality: 'high' | 'standard' = 'high'): string {
    const domain = 'stream-mz.planetradio.co.uk';
    const extension = quality === 'high' ? '.aac' : '.mp3';
    // Use HTTP (not HTTPS) as many radio streams don't support SSL properly
    return `http://${domain}/${stationCode}${extension}`;
  }

  /**
   * Planet Radio station codes
   */
  static planetRadioStations: Record<string, string> = {
    smooth: 'smoothfm',
    magic: 'magicfm',
    classicrock: 'xfmclassicrock',
    virgin: 'virginradio',
    heart: 'heart',
  };

  /**
   * Get Planet Radio stream for a station
   * @param stationName - Station name
   * @param quality - Stream quality
   * @returns Stream URL or null
   */
  static getPlanetRadioStream(stationName: string, quality: 'high' | 'standard' = 'high'): string | null {
    const code = this.planetRadioStations[stationName.toLowerCase()];
    if (!code) return null;
    return this.getPlanetRadioUrl(code, quality);
  }
}
