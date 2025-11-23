/**
 * Stream URL Manager
 * Handles caching, redirect resolution, and multi-source fallback for radio streams
 */

import { BBCRadioStreamer } from './bbcStreams';
import { searchStationByName, resolveStreamByUUID, RadioBrowserClient } from './radioBrowser';
import type { StationMetadata } from '../config/stations';
import { getStationByName } from '../config/stations';
import { parsePlaylist } from './playlistParser';
import { Timer } from '../utils/timer';

export interface StreamResult {
  url: string;
  homepage?: string;
  favicon?: string;
  source: string;
}

interface CachedUrl {
  url: string;
  homepage?: string;
  favicon?: string;
  expiration: number;
  source: string;
}

export class StreamUrlManager {
  private cache: Map<string, CachedUrl> = new Map()
  // Promise cache/mutex: prevent concurrent resolution for same station
  // If multiple play commands arrive for the same station, they share the same resolution promise
  private inFlightResolutions: Map<string, Promise<StreamResult | null>> = new Map();
  private cacheTimeout = 4 * 60 * 60 * 1000; // 4 hours

  /**
   * Universal HTTPS upgrade - upgrades ALL HTTP URLs to HTTPS
   * This is necessary for mixed content compliance on HTTPS sites
   * Most modern CDNs support HTTPS, so this works for the vast majority of streams
   */
  private upgradeToHttps(url: string, network?: string): string {
    if (!url || url.startsWith('https://')) {
      return url;
    }

    if (!url.startsWith('http://')) {
      return url;
    }

    // Global Radio: Special handling for media-ssl endpoint
    if (network === 'global' || url.includes('media-the.musicradio.com') || url.includes('vis.media-ice.musicradio.com')) {
      const secureUrl = url
        .replace(/http:\/\/(media-the|vis\.media-ice)\.musicradio\.com/, 'https://media-ssl.musicradio.com')
        .replace(/^http:/, 'https:');
      if (secureUrl !== url) {
      }
      return secureUrl;
    }

    // Universal upgrade: ALL HTTP URLs -> HTTPS
    // This is safe because:
    // 1. Most modern CDNs support HTTPS
    // 2. Browser will handle failures gracefully
    // 3. Better than blocking due to mixed content
    const secureUrl = url.replace(/^http:/, 'https:');
    if (secureUrl !== url) {
    }
    return secureUrl;
  }

  /**
   * Get stream URL with caching and fallback strategy
   * @param station - Station metadata or station name (for backward compatibility)
   * @returns Stream result with URL and metadata (homepage, favicon) or null
   */
  async getStreamUrl(station: StationMetadata | string): Promise<StreamResult | null> {
    // Handle backward compatibility: if string, look up metadata
    let metadata: StationMetadata | undefined;
    if (typeof station === 'string') {
      metadata = getStationByName(station);
      if (!metadata) {
        // Fallback to old behavior for stations not in registry
        return this.getStreamUrlLegacy(station);
      }
    } else {
      metadata = station;
    }

    const stationName = metadata.name;
    const cacheKey = metadata.id || stationName;

    // Check cache first
    const cached = this.getCachedEntry(cacheKey);
    if (cached) {
      // Upgrade cached URL to HTTPS (cache might contain old HTTP URLs)
      const upgradedUrl = this.upgradeToHttps(cached.url, metadata.network);
      return {
        url: upgradedUrl,
        homepage: cached.homepage,
        favicon: cached.favicon,
        source: cached.source,
      };
    }

    // Mutex: check if resolution is already in flight for this station (prevent race conditions)
    // If handlePlayStationByName and resolveStreamForStation are called concurrently for the same station,
    // they will share the same resolution promise instead of double-resolving
    const inFlight = this.inFlightResolutions.get(cacheKey);
    if (inFlight) {
      return inFlight; // Reuse existing promise
    }

    // Create resolution promise and cache it
    const resolutionPromise = (async (): Promise<StreamResult | null> => {
      // Timer to measure resolution latency
      const resolveTimer = new Timer(`resolve_${cacheKey}`);
      resolveTimer.mark('stream resolution started');
      
      let streamUrl: string | null = null;
      let homepage: string | undefined;
      let favicon: string | undefined;
      let source = 'unknown';

      try {
        // Network-based routing
      switch (metadata.network) {
        case 'bbc': {
          // Use direct HTTPS Akamai URLs (bypasses HTTP-only lsn.lv redirector)
          if (metadata.discovery_id) {
            const station = BBCRadioStreamer.getStationByDiscoveryId(metadata.discovery_id);
            if (station && station.pool) {
              // Construct HTTPS Akamai URL directly
              streamUrl = `https://as-hls-ww-live.akamaized.net/pool_${station.pool}/live/ww/${station.id}/${station.id}.isml/${station.id}-audio%3d96000.norewind.m3u8`;
              source = 'bbc-akamai-https';
            } else {
              // Fallback: Use RadioBrowser for stations without pool IDs (pool_904 is outdated)
              console.warn(`[StreamManager] No pool found for BBC station ${metadata.discovery_id}, trying RadioBrowser`);
              try {
                const streamMetadata = await RadioBrowserClient.resolveStream(metadata.name);
                if (streamMetadata) {
                  streamUrl = await parsePlaylist(streamMetadata.url_resolved);
                  if (streamUrl) {
                    streamUrl = this.upgradeToHttps(streamUrl, metadata.network);
                    source = 'bbc-radiobrowser-fallback';
                  }
                }
              } catch (error) {
                console.warn(`[StreamManager] RadioBrowser fallback failed for ${metadata.name}:`, error);
              }
            }
          }
          break;
        }

        case 'bauer':
        case 'global':
        case 'other': {
          // Commercial stations: Use dynamic discovery via RadioBrowser
          // Prioritize UUID lookup (more reliable) over discovery_id search
          
          console.log(`[StreamManager] Resolving stream for ${metadata.name} (network: ${metadata.network}, uuid: ${metadata.uuid || 'none'}, discovery_id: ${metadata.discovery_id || 'none'})`);
          
          // First: Try UUID-based lookup (most reliable)
          if (metadata.uuid) {
            try {
              console.log(`[StreamManager] Trying UUID lookup for ${metadata.name} (${metadata.uuid})`);
              const streamMetadata = await resolveStreamByUUID(metadata.uuid);
              if (streamMetadata && streamMetadata.url_resolved) {
                let resolvedUrl = await parsePlaylist(streamMetadata.url_resolved);
                // Upgrade insecure URLs for Global stations
                resolvedUrl = this.upgradeToHttps(resolvedUrl, metadata.network);
                streamUrl = resolvedUrl;
                homepage = streamMetadata.homepage;
                favicon = streamMetadata.favicon;
                source = 'radio-browser-uuid';
                console.log(`[StreamManager] UUID lookup succeeded for ${metadata.name}: ${streamUrl.substring(0, 50)}...`);
              } else {
                console.warn(`[StreamManager] UUID lookup returned no URL for ${metadata.name}`);
              }
            } catch (error) {
              console.warn(`[StreamManager] UUID lookup failed for ${metadata.name}:`, error instanceof Error ? error.message : error);
            }
          }
          
          // Fallback: Try discovery_id search if UUID lookup failed
          if (!streamUrl && metadata.discovery_id) {
            try {
              console.log(`[StreamManager] Trying discovery_id search for ${metadata.name} (${metadata.discovery_id})`);
              // Call RadioBrowserClient.resolveStream with discovery_id (search term)
              const streamMetadata = await RadioBrowserClient.resolveStream(metadata.discovery_id);
              
              if (streamMetadata && streamMetadata.url_resolved) {
                // Pass the result to parsePlaylist (handles .m3u/.pls or returns as-is)
                let resolvedUrl = await parsePlaylist(streamMetadata.url_resolved);
                // Upgrade insecure URLs for Global stations
                resolvedUrl = this.upgradeToHttps(resolvedUrl, metadata.network);
                streamUrl = resolvedUrl;
                homepage = streamMetadata.homepage;
                favicon = streamMetadata.favicon;
                source = 'radio-browser-dynamic';
                console.log(`[StreamManager] Discovery ID search succeeded for ${metadata.name}: ${streamUrl.substring(0, 50)}...`);
              } else {
                console.warn(`[StreamManager] Discovery ID search returned no URL for ${metadata.name}`);
              }
            } catch (error) {
              console.warn(`[StreamManager] Discovery ID search failed for ${metadata.name}:`, error instanceof Error ? error.message : error);
            }
          }
          
          // Last fallback: Try name-based search
          if (!streamUrl) {
            try {
              const matching = await searchStationByName(stationName);
              if (matching && matching.url_resolved) {
                let resolvedUrl = await parsePlaylist(matching.url_resolved);
                // Upgrade insecure URLs for Global stations
                resolvedUrl = this.upgradeToHttps(resolvedUrl, metadata.network);
                streamUrl = resolvedUrl;
                homepage = matching.homepage || undefined;
                favicon = matching.favicon || undefined;
                source = 'radio-browser-name-search';
              }
            } catch (error) {
              // RadioBrowser name search failed (expected when mirrors are down)
            }
          }
          break;
        }
      }

        // Cache the result if we found a working URL
        if (streamUrl) {
          // Apply HTTPS upgrade to final URL (handles playlistParser returning HTTP URLs)
          streamUrl = this.upgradeToHttps(streamUrl, metadata.network);
          this.setInCache(cacheKey, streamUrl, source, homepage, favicon);
          resolveTimer.mark('stream resolution complete', { source, urlLength: streamUrl.length });
          // Return stream result with metadata
          return {
            url: streamUrl,
            homepage,
            favicon,
            source,
          };
        }
      } catch (error) {
        // Error getting stream (silent - expected for some stations)
        resolveTimer.mark('stream resolution failed', { error: error instanceof Error ? error.message : String(error) });
      }

      // Return null if nothing worked (NO hardcoded fallbacks)
      // Could not discover stream URL (silent - expected for some stations)
      resolveTimer.mark('stream resolution no result');
      return null;
    })();

    // Cache the promise and clean it up when done
    this.inFlightResolutions.set(cacheKey, resolutionPromise);
    resolutionPromise.finally(() => {
      this.inFlightResolutions.delete(cacheKey);
    });

    return resolutionPromise;
  }

  /**
   * Legacy method for backward compatibility (stations not in registry)
   * @param stationName - Station name
   * @returns Stream result with URL and metadata or null
   */
  private async getStreamUrlLegacy(stationName: string): Promise<StreamResult | null> {
      // Check cache first
      const cached = this.getCachedEntry(stationName);
      if (cached) {
        // Upgrade cached URL to HTTPS (cache might contain old HTTP URLs)
        const upgradedUrl = this.upgradeToHttps(cached.url);
        return {
          url: upgradedUrl,
          homepage: cached.homepage,
          favicon: cached.favicon,
          source: cached.source,
        };
      }

    let streamUrl: string | null = null;
    let homepage: string | undefined;
    let favicon: string | undefined;
    let source = 'unknown';

    try {
      // Priority 1: Try BBC (most reliable)
      if (BBCRadioStreamer.isBBCStation(stationName)) {
        const station = BBCRadioStreamer.getStationByName(stationName);
        if (station && station.pool) {
          // Use direct HTTPS Akamai URLs (bypasses HTTP-only lsn.lv redirector)
          streamUrl = `https://as-hls-ww-live.akamaized.net/pool_${station.pool}/live/ww/${station.id}/${station.id}.isml/${station.id}-audio%3d96000.norewind.m3u8`;
          source = 'bbc-akamai-https';
        }
      }

      // Priority 2: Try RadioBrowser API (dynamic discovery)
      if (!streamUrl) {
        try {
          const streamMetadata = await RadioBrowserClient.resolveStream(stationName);
          if (streamMetadata) {
            let resolvedUrl = await parsePlaylist(streamMetadata.url_resolved);
            // Try to detect network from URL patterns
            const isGlobal = resolvedUrl.includes('musicradio.com');
            const isBauer = resolvedUrl.includes('planetradio.co.uk');
            const network = isGlobal ? 'global' : (isBauer ? 'bauer' : undefined);
            resolvedUrl = this.upgradeToHttps(resolvedUrl, network);
            streamUrl = resolvedUrl;
            homepage = streamMetadata.homepage;
            favicon = streamMetadata.favicon;
            source = 'radio-browser-dynamic';
          } else {
            // Fallback to name-based search
            const matching = await searchStationByName(stationName);
            if (matching && matching.url_resolved) {
              let resolvedUrl = await parsePlaylist(matching.url_resolved);
              // Try to detect network from URL patterns
              const isGlobal = resolvedUrl.includes('musicradio.com');
              const isBauer = resolvedUrl.includes('planetradio.co.uk');
              const network = isGlobal ? 'global' : (isBauer ? 'bauer' : undefined);
              resolvedUrl = this.upgradeToHttps(resolvedUrl, network);
              streamUrl = resolvedUrl;
              homepage = matching.homepage || undefined;
              favicon = matching.favicon || undefined;
              source = 'radio-browser-name-search';
            }
          }
        } catch (error) {
          console.warn('RadioBrowser lookup failed:', error);
        }
      }

      // Cache the result if we found a working URL
      if (streamUrl) {
        // Apply HTTPS upgrade to final URL (handles playlistParser returning HTTP URLs)
        streamUrl = this.upgradeToHttps(streamUrl);
        this.setInCache(stationName, streamUrl, source, homepage, favicon);
        // Return stream result with metadata
        return {
          url: streamUrl,
          homepage,
          favicon,
          source,
        };
      }
    } catch (error) {
      // Error getting stream (silent - expected for some stations)
    }

    // Return null if nothing worked (NO hardcoded fallbacks)
    // Could not discover stream URL (silent - expected for some stations)
    return null;
  }

  /**
   * Follow redirect chain to get final stream URL
   * @param url - Initial URL
   * @param maxRedirects - Maximum redirects to follow
   * @returns Final URL after redirects
   */
  async resolveStreamUrl(url: string, maxRedirects: number = 5): Promise<string> {
    let currentUrl = url;
    let redirects = 0;

    while (redirects < maxRedirects) {
      try {
        await fetch(currentUrl, {
          method: 'HEAD',
          redirect: 'follow',
          credentials: 'omit',
          mode: 'no-cors', // May not work for all URLs due to CORS
        });

        // In no-cors mode, we can't check redirected status
        // So we'll just return the original URL
        // In production with a backend proxy, this would work better
        return currentUrl;
      } catch (error) {
        // If fetch fails, return the URL we have
        return currentUrl;
      }
    }

    return currentUrl;
  }

  /**
   * Verify stream is accessible
   * Note: Browser-based verification is limited due to CORS/SSL restrictions
   * This method is optimistic - actual playback will determine if the stream works
   * 405 errors (Method Not Allowed) are normal for stream servers - they work fine with GET
   * @param url - Stream URL to verify
   * @returns True if stream appears to be accessible (optimistic)
   */
  async verifyStream(url: string): Promise<boolean> {
    // Skip verification for known URL patterns (verification fails in browser due to CORS/SSL)
    if (url.includes('stream-mz.planetradio.co.uk') ||
        url.includes('radio-browser') ||
        url.includes('media-ice.musicradio.com') ||
        url.includes('media-sov.musicradio.com')) {
      return true;
    }

    // For all other URLs, optimistically return true
    // Browser verification doesn't work properly due to CORS/SSL restrictions
    // The audio player will handle actual playback errors
    return true;
  }

  /**
   * Get cached entry with metadata if available and not expired
   */
  private getCachedEntry(key: string): CachedUrl | null {
    const cached = this.cache.get(key.toLowerCase());
    if (cached && cached.expiration > Date.now()) {
      return cached;
    }
    if (cached) {
      this.cache.delete(key.toLowerCase());
    }
    return null;
  }

  /**
   * Cache a URL with expiration and metadata
   */
  private setInCache(key: string, url: string, source: string, homepage?: string, favicon?: string): void {
    this.cache.set(key.toLowerCase(), {
      url,
      homepage,
      favicon,
      expiration: Date.now() + this.cacheTimeout,
      source,
    });
  }

  /**
   * Clear cache for a specific station or all stations
   */
  clearCache(stationName?: string): void {
    if (stationName) {
      this.cache.delete(stationName.toLowerCase());
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: Array<{ key: string; source: string; expiresIn: number }> } {
    const entries = Array.from(this.cache.entries()).map(([key, value]) => ({
      key,
      source: value.source,
      expiresIn: Math.max(0, value.expiration - Date.now()),
    }));

    return {
      size: this.cache.size,
      entries,
    };
  }
}

// Export singleton instance
export const streamUrlManager = new StreamUrlManager();
