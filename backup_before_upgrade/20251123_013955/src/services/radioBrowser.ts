import axios from 'axios';
import type { RadioStation, StationFilters } from '../types/station';

// RadioBrowser API calls are now handled by backend /api/radiobrowser endpoint
// This eliminates browser network errors (ERR_NAME_NOT_RESOLVED) from appearing in console
// Note: fetchStations still uses direct API calls - consider moving to backend if needed

const API_BASE_URL = 'https://de1.api.radio-browser.info/json/stations';

// Cache for API responses
let stationsCache: RadioStation[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export async function fetchStations(filters: StationFilters = {}): Promise<RadioStation[]> {
  const now = Date.now();
  
  // Return cached data if available and fresh
  if (stationsCache && (now - cacheTimestamp) < CACHE_DURATION) {
    console.log(`[radioBrowser] Using cached stations (${stationsCache.length} stations)`);
    return stationsCache;
  }

  try {
    console.log('[radioBrowser] Fetching stations from API...');
    // Build query parameters
    const params: Record<string, string> = {
      countrycode: filters.countrycode || 'GB',
      order: 'votes',
      limit: '6000',
      reverse: 'true',
    };

    if (filters.state) {
      params.state = filters.state;
    }

    const response = await axios.get<RadioStation[]>(API_BASE_URL, { 
      params,
      timeout: 10000, // 10 second timeout
    });
    
    console.log(`[radioBrowser] Fetched ${response.data.length} stations from API`);
    
    // Cache the raw response
    stationsCache = response.data;
    cacheTimestamp = now;

    return stationsCache;
  } catch (error: any) {
    console.error('[radioBrowser] Error fetching stations:', error?.message || error);
    
    // If we have cached data, return it even if stale
    if (stationsCache && stationsCache.length > 0) {
      console.warn('[radioBrowser] Using stale cache due to API error');
      return stationsCache;
    }
    
    throw error;
  }
}

export async function getUKStations(): Promise<RadioStation[]> {
  // First, fetch all UK stations without strict filters
  const allStations = await fetchStations({
    countrycode: 'GB',
  });

  // Apply filters step by step
  let filtered = allStations;

  // Filter for live stations
  filtered = filtered.filter(station => station.lastcheckok === 1);

  // Filter by minimum bitrate (320kbps+)
  filtered = filtered.filter(station => station.bitrate >= 320);

  // Filter by location (London or Kent) - prioritize but don't exclude all others
  // Since we already filtered for UK (countrycode=GB), all stations are UK-based
  // We'll prioritize London/Kent stations but include all high-quality UK stations
  const prioritized = filtered.filter(station => {
    const stateLower = (station.state || '').toLowerCase();
    const nameLower = (station.name || '').toLowerCase();
    const tagsLower = (station.tags || '').toLowerCase();
    
    // Check for London or Kent in various fields
    return (
      stateLower.includes('london') || 
      stateLower.includes('kent') ||
      nameLower.includes('london') ||
      nameLower.includes('kent') ||
      tagsLower.includes('london') ||
      tagsLower.includes('kent')
    );
  });

  // If we have London/Kent stations, use those; otherwise use all UK stations
  // This ensures we show stations even if location metadata is incomplete
  if (prioritized.length > 0) {
    filtered = prioritized;
  }

  // Remove duplicates
  const seen = new Set<string>();
  filtered = filtered.filter(station => {
    const key = `${station.name.toLowerCase()}_${station.url}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return filtered;
}

/**
 * Resolve stream URL by RadioBrowser UUID
 * @param uuid - RadioBrowser station UUID
 * @returns Stream metadata (URL, homepage, favicon) or null
 */
export async function resolveStreamByUUID(uuid: string): Promise<StreamMetadata | null> {
  try {
    const params = new URLSearchParams({
      action: 'uuid',
      uuid: uuid,
    });
    
    const response = await fetch(`/api/radiobrowser?${params.toString()}`);
    
    if (!response.ok) return null;
    
    const station: RadioStation | null = await response.json();
    
    if (!station) return null;
    
    const url_resolved = station.url_resolved || station.url;
    if (!url_resolved) return null;
    
    // Return metadata subset
    return {
      url_resolved,
      homepage: station.homepage || undefined,
      favicon: station.favicon || undefined,
    };
  } catch (error) {
    // Silent failure - expected when backend can't reach RadioBrowser mirrors
    return null;
  }
}

/**
 * Stream metadata result from RadioBrowser
 */
export interface StreamMetadata {
  url_resolved: string;
  homepage?: string;
  favicon?: string;
}

/**
 * RadioBrowser Client Class
 * Provides robust stream resolution with mirror redundancy
 */
export class RadioBrowserClient {
  /**
   * Resolve stream URL by station name using RadioBrowser API (via backend)
   * Uses url_resolved field which provides the actual, live, tokenized stream URL
   * @param stationName - Station name to search for
   * @returns Stream metadata (URL, homepage, favicon) or null
   */
  static async resolveStream(stationName: string): Promise<StreamMetadata | null> {
    try {
      const params = new URLSearchParams({
        action: 'search',
        name: stationName,
        countrycode: 'GB',
        limit: '1',
        order: 'clickcount',
        reverse: 'true',
        hidebroken: 'true',
      });
      
      const response = await fetch(`/api/radiobrowser?${params.toString()}`);
      
      if (!response.ok) return null;
      
      const data: RadioStation[] = await response.json();
      if (!data || data.length === 0) return null;
      
      const station = data[0];
      const url_resolved = station.url_resolved || station.url;
      
      if (!url_resolved) return null;
      
      // Return full metadata
      return {
        url_resolved,
        homepage: station.homepage || undefined,
        favicon: station.favicon || undefined,
      };
    } catch (error) {
      // Silent failure - expected when backend can't reach RadioBrowser mirrors
      return null;
    }
  }
}

/**
 * Search for a specific station by name (direct API search)
 * This bypasses the filtering to find stations that might not be in the pre-filtered list
 * @param stationName - Station name to search for
 * @returns Matching RadioStation or null (full station object for compatibility)
 */
export async function searchStationByName(stationName: string): Promise<RadioStation | null> {
  try {
    const params = new URLSearchParams({
      action: 'search',
      name: stationName,
      countrycode: 'GB',
      limit: '50',
      order: 'clickcount',
      reverse: 'true',
      hidebroken: 'true',
    });
    
    const response = await fetch(`/api/radiobrowser?${params.toString()}`);
    
    if (!response.ok) return null;
    
    const stations: RadioStation[] = await response.json();
    
    if (!stations || stations.length === 0) return null;
    
    // Try exact match first
    const exactMatch = stations.find(s => 
      s.name.toLowerCase() === stationName.toLowerCase() && s.lastcheckok === 1
    );
    if (exactMatch) return exactMatch;
    
    // Try normalized match (remove common suffixes/prefixes)
    const normalizedSearch = stationName.toLowerCase()
      .replace(/\s+(uk|london|kent|national)$/i, '')
      .trim();
    const normalizedMatch = stations.find(s => {
      const sName = s.name.toLowerCase()
        .replace(/\s+(uk|london|kent|national)$/i, '')
        .trim();
      return sName === normalizedSearch && s.lastcheckok === 1;
    });
    if (normalizedMatch) return normalizedMatch;
    
    // Try partial match
    const partialMatch = stations.find(s => {
      const sName = s.name.toLowerCase();
      const searchLower = stationName.toLowerCase();
      return (sName.includes(searchLower) || searchLower.includes(sName)) && s.lastcheckok === 1;
    });
    
    return partialMatch || null;
  } catch (error) {
    // Silent failure - expected when backend can't reach RadioBrowser mirrors
    return null;
  }
}

