/**
 * BBC Radio Stream Service
 * Provides stream URLs for BBC radio stations using lstn.lv proxy (recommended)
 * and Akamai direct URLs as fallback
 */

export interface BBCStation {
  id: string;
  name: string;
  pool?: string; // Akamai pool ID for direct URLs
}

export class BBCRadioStreamer {
  // BBC station identifiers
  // Maps both station keys and discovery_ids to BBCStation
  static stations: Record<string, BBCStation> = {
    // Main stations (by key)
    radio1: {
      id: 'bbc_radio_one',
      name: 'BBC Radio 1',
      pool: '01505109',
    },
    radio2: {
      id: 'bbc_radio_two',
      name: 'BBC Radio 2',
      pool: '74208725',
    },
    radio3: {
      id: 'bbc_radio_three',
      name: 'BBC Radio 3',
      pool: '23461179',
    },
    radio4: {
      id: 'bbc_radio_fourfm',
      name: 'BBC Radio 4',
      pool: '55057080',
    },
    radio5live: {
      id: 'bbc_radio_five_live',
      name: 'BBC Radio 5 Live',
      pool: '89021708',
    },
    '6music': {
      id: 'bbc_6music',
      name: 'BBC Radio 6 Music',
      pool: '81827798',
    },
    radiokent: {
      id: 'bbc_radio_kent',
      name: 'BBC Radio Kent',
    },
    // Discovery ID mappings (for network-based routing)
    bbc_radio_one: {
      id: 'bbc_radio_one',
      name: 'BBC Radio 1',
      pool: '01505109',
    },
    bbc_radio_two: {
      id: 'bbc_radio_two',
      name: 'BBC Radio 2',
      pool: '74208725',
    },
    bbc_radio_three: {
      id: 'bbc_radio_three',
      name: 'BBC Radio 3',
      pool: '23461179',
    },
    bbc_radio_fourfm: {
      id: 'bbc_radio_fourfm',
      name: 'BBC Radio 4',
      pool: '55057080',
    },
    bbc_radio_four_extra: {
      id: 'bbc_radio_four_extra',
      name: 'BBC Radio 4 Extra',
    },
    bbc_radio_five_live: {
      id: 'bbc_radio_five_live',
      name: 'BBC Radio 5 Live',
      pool: '89021708',
    },
    bbc_radio_five_live_sports_extra: {
      id: 'bbc_radio_five_live_sports_extra',
      name: 'BBC Radio 5 Live Sports Extra',
    },
    bbc_1xtra: {
      id: 'bbc_1xtra',
      name: 'BBC Radio 1Xtra',
    },
    bbc_6music: {
      id: 'bbc_6music',
      name: 'BBC Radio 6 Music',
      pool: '81827798',
    },
    bbc_asian_network: {
      id: 'bbc_asian_network',
      name: 'BBC Asian Network',
    },
    bbc_world_service: {
      id: 'bbc_world_service',
      name: 'BBC World Service',
    },
    bbc_radio_one_anthems: {
      id: 'bbc_radio_one_anthems',
      name: 'BBC Radio 1 Anthems',
    },
    bbc_radio_one_dance: {
      id: 'bbc_radio_one_dance',
      name: 'BBC Radio 1 Dance',
    },
    bbc_radio_three_unwind: {
      id: 'bbc_radio_three_unwind',
      name: 'BBC Radio 3 Unwind',
    },
    bbc_london: {
      id: 'bbc_london',
      name: 'BBC London',
    },
    bbc_radio_kent: {
      id: 'bbc_radio_kent',
      name: 'BBC Radio Kent',
    },
  };

  /**
   * Get BBC stream URL using lstn.lv proxy (recommended)
   * @param stationKey - Station key (e.g., 'radio1', 'radio2')
   * @param bitrate - Bitrate in bps (default: 96000 for 96kbps worldwide)
   * @param ukOnly - Use UK-only streams for higher quality (default: false)
   * @returns Stream URL
   */
  static getLstnUrl(stationKey: string, bitrate: number = 96000, ukOnly: boolean = false): string | null {
    const station = this.stations[stationKey.toLowerCase()];
    if (!station) return null;

    const uk = ukOnly ? '&uk=1' : '';
    return `http://lsn.lv/bbcradio.m3u8?station=${station.id}&bitrate=${bitrate}${uk}`;
  }

  /**
   * Get BBC stream URL using direct Akamai CDN (fallback)
   * @param stationKey - Station key
   * @param bitrate - Bitrate in bps (default: 96000)
   * @param ukOnly - Use UK-only streams (default: false)
   * @returns Stream URL or null if station not found
   */
  static getAkamaiUrl(stationKey: string, bitrate: number = 96000, ukOnly: boolean = false): string | null {
    const station = this.stations[stationKey.toLowerCase()];
    if (!station || !station.pool) return null;

    const region = ukOnly ? 'uk' : 'ww';
    return `http://as-hls-${region}-live.akamaized.net/pool_${station.pool}/live/${region}/${station.id}/${station.id}.isml/${station.id}-audio%3d${bitrate}.norewind.m3u8`;
  }

  /**
   * Get stream URL with fallback strategy (HTTPS Akamai only)
   * @param stationKey - Station key
   * @param bitrate - Bitrate in bps (default: 96000)
   * @param ukOnly - Use UK-only streams (default: false)
   * @returns Array of URLs to try in order (HTTPS only)
   */
  static getStreamUrls(stationKey: string, bitrate: number = 96000, ukOnly: boolean = false): string[] {
    const urls: string[] = [];
    
    // Use HTTPS Akamai directly (replaces HTTP-only lsn.lv)
    const akamaiUrl = this.getAkamaiUrl(stationKey, bitrate, ukOnly);
    if (akamaiUrl) urls.push(akamaiUrl);

    return urls;
  }

  /**
   * Get station info by name (fuzzy match)
   */
  static getStationByName(name: string): BBCStation | null {
    const nameLower = name.toLowerCase();
    
    // Direct match
    for (const [, station] of Object.entries(this.stations)) {
      if (station.name.toLowerCase() === nameLower || station.id === nameLower) {
        return station;
      }
    }

    // Fuzzy match
    for (const [key, station] of Object.entries(this.stations)) {
      if (nameLower.includes(key) || nameLower.includes(station.id.replace('bbc_', ''))) {
        return station;
      }
    }

    return null;
  }

  /**
   * Check if a station name is a BBC station
   */
  static isBBCStation(name: string): boolean {
    return this.getStationByName(name) !== null;
  }

  /**
   * Get station by discovery_id (for network-based routing)
   * @param discoveryId - Discovery ID from station metadata (e.g., 'bbc_radio_one')
   * @returns BBCStation or null
   */
  static getStationByDiscoveryId(discoveryId: string): BBCStation | null {
    const station = this.stations[discoveryId.toLowerCase()];
    if (station) return station;
    
    // Try to find by matching the discovery_id to station.id
    for (const [, station] of Object.entries(this.stations)) {
      if (station.id === discoveryId || station.id.toLowerCase() === discoveryId.toLowerCase()) {
        return station;
      }
    }
    
    return null;
  }

  /**
   * Get stream URLs by discovery_id (for network-based routing)
   * @param discoveryId - Discovery ID from station metadata
   * @param bitrate - Bitrate in bps (default: 96000)
   * @param ukOnly - Use UK-only streams (default: false)
   * @returns Array of URLs to try in order
   */
  static getStreamUrlsByDiscoveryId(discoveryId: string, bitrate: number = 96000, ukOnly: boolean = false): string[] {
    const station = this.getStationByDiscoveryId(discoveryId);
    if (!station) return [];
    
    const urls: string[] = [];
    
    const lstnUrl = this.getLstnUrlByStation(station, bitrate, ukOnly);
    if (lstnUrl) urls.push(lstnUrl);
    
    const akamaiUrl = this.getAkamaiUrlByStation(station, bitrate, ukOnly);
    if (akamaiUrl) urls.push(akamaiUrl);
    
    return urls;
  }

  /**
   * Get HTTPS Akamai URL by station object (replaces lsn.lv)
   */
  private static getLstnUrlByStation(station: BBCStation, bitrate: number = 96000, ukOnly: boolean = false): string | null {
    // Use HTTPS Akamai directly (replaces HTTP-only lsn.lv)
    return this.getAkamaiUrlByStation(station, bitrate, ukOnly);
  }

  /**
   * Get HTTPS Akamai URL by station object
   */
  private static getAkamaiUrlByStation(station: BBCStation, bitrate: number = 96000, ukOnly: boolean = false): string | null {
    if (!station.pool) return null;
    const region = ukOnly ? 'uk' : 'ww';
    // Always use HTTPS for mixed content compliance
    return `https://as-hls-${region}-live.akamaized.net/pool_${station.pool}/live/${region}/${station.id}/${station.id}.isml/${station.id}-audio%3d${bitrate}.norewind.m3u8`;
  }

  /**
   * Get all available BBC stations
   */
  static getAllStations(): BBCStation[] {
    // Return unique stations (deduplicate by id)
    const seen = new Set<string>();
    return Object.values(this.stations).filter((station) => {
      if (seen.has(station.id)) return false;
      seen.add(station.id);
      return true;
    });
  }
}

