import axios from 'axios';
import type { RadioplayerStation, RadioplayerSearchResponse } from '../types/radioplayer';
import type { RadioStation } from '../types/station';

const API_BASE_URL = 'https://api.radioplayer.org/v4';
const API_KEY = import.meta.env.VITE_RADIOPLAYER_API_KEY || '';

// Cache for API responses
let stationsCache: RadioStation[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Convert Radioplayer station to our RadioStation format
function convertRadioplayerStation(rpStation: RadioplayerStation): RadioStation | null {
  // Find the best quality stream (highest bitrate)
  const bestStream = rpStation.streams
    .filter(s => s.status === 'live' || !s.status)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

  if (!bestStream || !bestStream.url) {
    return null;
  }

  // Filter for 320kbps+ streams (if bitrate is specified)
  // If bitrate is not specified, assume it's high quality and include it
  if (bestStream.bitrate && bestStream.bitrate < 320) {
    return null;
  }

  return {
    changeuuid: rpStation.id,
    stationuuid: rpStation.id,
    name: rpStation.name,
    url: bestStream.url,
    url_resolved: bestStream.url,
    homepage: '',
    favicon: rpStation.logo?.url || '',
    tags: rpStation.genres?.join(',') || '',
    country: rpStation.location?.country || 'United Kingdom',
    countrycode: 'GB',
    state: rpStation.location?.region || rpStation.location?.city || '',
    language: rpStation.language || 'en',
    languagecodes: rpStation.language || 'en',
    votes: 0,
    lastchangetime: new Date().toISOString(),
    codec: bestStream.codec || 'MP3',
    bitrate: bestStream.bitrate || 320,
    hls: 0,
    lastcheckok: 1, // Assume live if returned by API
    lastchecktime: new Date().toISOString(),
    lastcheckoktime: new Date().toISOString(),
    lastlocalchecktime: new Date().toISOString(),
    clicktimestamp: '',
    clickcount: 0,
    clicktrend: 0,
    ssl_error: 0,
    geo_lat: rpStation.location?.coordinates?.lat?.toString() || '',
    geo_long: rpStation.location?.coordinates?.lon?.toString() || '',
    has_extended_info: true,
  };
}

async function searchRadioplayer(query?: string, lat?: number, lon?: number): Promise<RadioplayerStation[]> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (API_KEY) {
      headers['X-Radioplayer-API-Key'] = API_KEY;
    }

    const params: Record<string, string> = {};
    if (query) {
      params.q = query;
    }
    if (lat !== undefined && lon !== undefined) {
      params.lat = lat.toString();
      params.lon = lon.toString();
    }

    const response = await axios.get<RadioplayerSearchResponse>(
      `${API_BASE_URL}/search`,
      { headers, params, timeout: 10000 }
    );

    return response.data?.stations || [];
  } catch (error) {
    // Log but don't throw - allow other searches to continue
    console.warn(`Radioplayer search failed for query="${query}", lat=${lat}, lon=${lon}:`, error);
    return [];
  }
}

export async function getUKStations(): Promise<RadioStation[]> {
  const now = Date.now();

  // Return cached data if available and fresh
  if (stationsCache && (now - cacheTimestamp) < CACHE_DURATION) {
    return stationsCache;
  }

  try {
    // Search for UK stations - try multiple approaches
    const allStations: RadioplayerStation[] = [];

    // Search by location (London coordinates)
    const londonStations = await searchRadioplayer(undefined, 51.5074, -0.1278);
    allStations.push(...londonStations);

    // Search for popular UK stations
    const ukStations = await searchRadioplayer('UK');
    allStations.push(...ukStations);

    // Search for London stations
    const londonSearch = await searchRadioplayer('London');
    allStations.push(...londonSearch);

    // Search for Kent stations
    const kentSearch = await searchRadioplayer('Kent');
    allStations.push(...kentSearch);

    // Search for popular UK radio stations
    const popularSearches = ['BBC', 'Capital', 'Heart', 'Kiss', 'Smooth', 'Absolute', 'Classic FM', 'Radio 1', 'Radio 2', 'LBC'];
    for (const search of popularSearches) {
      const results = await searchRadioplayer(search);
      allStations.push(...results);
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`Fetched ${allStations.length} stations from Radioplayer API`);

    // Convert to our format and filter
    let converted: RadioStation[] = [];
    const seenIds = new Set<string>();

    for (const rpStation of allStations) {
      // Skip duplicates
      if (seenIds.has(rpStation.id)) {
        continue;
      }
      seenIds.add(rpStation.id);

      // Filter for UK stations
      const country = (rpStation.location?.country || '').toLowerCase();
      if (country !== 'united kingdom' && country !== 'uk' && country !== 'gb' && country !== '') {
        continue;
      }

      const convertedStation = convertRadioplayerStation(rpStation);
      if (convertedStation) {
        converted.push(convertedStation);
      }
    }

    console.log(`Converted ${converted.length} stations after filtering`);

    // Filter by location (London or Kent) - prioritize but don't exclude all others
    const prioritized = converted.filter(station => {
      const stateLower = (station.state || '').toLowerCase();
      const nameLower = (station.name || '').toLowerCase();
      const tagsLower = (station.tags || '').toLowerCase();

      return (
        stateLower.includes('london') ||
        stateLower.includes('kent') ||
        nameLower.includes('london') ||
        nameLower.includes('kent') ||
        tagsLower.includes('london') ||
        tagsLower.includes('kent')
      );
    });

    console.log(`Found ${prioritized.length} London/Kent stations out of ${converted.length} total UK stations`);

    // If we have London/Kent stations, use those; otherwise use all UK stations
    let filtered = prioritized.length > 0 ? prioritized : converted;

    // Remove duplicates by name and URL
    const seen = new Set<string>();
    filtered = filtered.filter(station => {
      const key = `${station.name.toLowerCase()}_${station.url}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    console.log(`Final result: ${filtered.length} stations after deduplication`);

    // Cache the result
    stationsCache = filtered;
    cacheTimestamp = now;

    return filtered;
  } catch (error) {
    console.error('Error fetching UK stations:', error);
    throw error;
  }
}

