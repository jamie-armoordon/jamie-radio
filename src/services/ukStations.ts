import type { RadioStation } from '../types/station';
import { streamUrlManager } from './streamManager';
import type { StationMetadata } from '../config/stations';
import { getStationsByLocation } from '../config/stations';
import { fetchStations, searchStationByName } from './radioBrowser';

/**
 * Create RadioStation from StationMetadata
 * Transforms the new metadata format to the RadioStation interface expected by UI components
 * @param metadata - Station config metadata
 * @param index - Station index for UUID generation
 * @param resolvedUrl - Resolved stream URL
 * @param homepage - Discovered homepage URL from RadioBrowser
 * @param favicon - Discovered favicon URL from RadioBrowser
 */
function createStationFromMetadata(
  metadata: StationMetadata, 
  index: number, 
  resolvedUrl: string,
  homepage?: string,
  favicon?: string
): RadioStation {
  // Determine bitrate from URL or default to 320
  let bitrate = 320;
  if (resolvedUrl) {
    // Try to extract bitrate from URL if present
    const bitrateMatch = resolvedUrl.match(/bitrate[=:](\d+)/i);
    if (bitrateMatch) {
      bitrate = parseInt(bitrateMatch[1], 10);
    }
  }

  // Determine codec from URL
  let codec = 'MP3';
  if (resolvedUrl.includes('.m3u8')) {
    codec = 'HLS';
  } else if (resolvedUrl.includes('.aac')) {
    codec = 'AAC';
  } else if (resolvedUrl.includes('.mp3')) {
    codec = 'MP3';
  }

  // Convert genre to tags format (comma-separated)
  const tags = metadata.genre
    ? metadata.genre
        .toLowerCase()
        .replace(/[()]/g, '')
        .replace(/\s*\/\s*/g, ',')
        .replace(/\s+/g, ' ')
        .trim()
    : '';

  // Get coordinates based on location
  let geo_lat = '';
  let geo_long = '';
  if (metadata.location === 'London') {
    geo_lat = '51.5074';
    geo_long = '-0.1278';
  } else if (metadata.location === 'Kent') {
    geo_lat = '51.2787';
    geo_long = '0.5217';
  }

  // Use discovered homepage/favicon from RadioBrowser, fallback to domain-based construction
  // Filter out stream URLs - RadioBrowser sometimes returns stream URLs in homepage field
  let finalHomepage = homepage || '';
  
  // Validate homepage is not a stream URL
  if (finalHomepage) {
    const lower = finalHomepage.toLowerCase();
    const isStream = /\.(mp3|m3u8?|pls|aac|ogg|wav|flac|wma)(\?|$)/i.test(lower) ||
                     /\/stream/i.test(lower) ||
                     /\/listen/i.test(lower) ||
                     /icecast|shoutcast|streaming|edge-|cdn-|media-/i.test(lower);
    if (isStream) {
      finalHomepage = ''; // Clear invalid stream URL
    }
  }
  
  // Use discovered favicon from RadioBrowser (or empty - backend /api/logo endpoint handles all logo resolution)
  const finalFavicon = favicon || '';

  // Always use unique UUIDs based on metadata.id and index to avoid React key conflicts
  // RadioBrowser UUIDs might be shared across multiple stations, so we generate our own
  const uniqueId = metadata.id || `station-${index}`;
  const stationuuid = `uk-station-${uniqueId}-${index}`;
  const changeuuid = `uk-change-${uniqueId}-${index}`;

  return {
    id: metadata.id, // Include internal station ID for metadata lookup
    changeuuid,
    stationuuid,
    name: metadata.name,
    url: resolvedUrl || '',
    url_resolved: resolvedUrl || '',
    homepage: finalHomepage, // From RadioBrowser discovery (backend /api/logo will discover if empty)
    favicon: finalFavicon, // From RadioBrowser discovery or empty (backend /api/logo handles logo resolution)
    tags,
    country: 'United Kingdom',
    countrycode: 'GB',
    state: metadata.location,
    language: 'en',
    languagecodes: 'en',
    votes: 0,
    lastchangetime: new Date().toISOString(),
    codec,
    bitrate,
    hls: resolvedUrl.includes('.m3u8') ? 1 : 0,
    lastcheckok: resolvedUrl ? 1 : 0,
    lastchecktime: new Date().toISOString(),
    lastcheckoktime: resolvedUrl ? new Date().toISOString() : '',
    lastlocalchecktime: new Date().toISOString(),
    clicktimestamp: '',
    clickcount: 0,
    clicktrend: 0,
    ssl_error: 0,
    geo_lat,
    geo_long,
    has_extended_info: true,
  };
}

/**
 * Check if a station is seasonal (christmas, xmas, holiday)
 */
function isSeasonalStation(station: RadioStation): boolean {
  const nameLower = (station.name || '').toLowerCase();
  const tagsLower = (station.tags || '').toLowerCase();
  return (
    nameLower.includes('christmas') ||
    nameLower.includes('xmas') ||
    nameLower.includes('holiday') ||
    tagsLower.includes('christmas') ||
    tagsLower.includes('xmas') ||
    tagsLower.includes('holiday')
  );
}

/**
 * Check if a station matches London/Kent/National location
 */
function matchesLocation(station: RadioStation): boolean {
  const stateLower = (station.state || '').toLowerCase();
  const nameLower = (station.name || '').toLowerCase();
  const tagsLower = (station.tags || '').toLowerCase();
  
  return (
    stateLower.includes('london') ||
    stateLower.includes('kent') ||
    stateLower.includes('national') ||
    nameLower.includes('london') ||
    nameLower.includes('kent') ||
    nameLower.includes('national') ||
    tagsLower.includes('london') ||
    tagsLower.includes('kent') ||
    tagsLower.includes('national')
  );
}

/**
 * Get UK stations from RadioBrowser API and local DAB registry
 * Includes all GB stations with relaxed filters (bitrate >= 64)
 * Prioritizes London/Kent/National and seasonal stations
 * @returns Array of RadioStation objects ready for UI display
 */
export async function getUKStations(): Promise<RadioStation[]> {
  // Step 1: Fetch stations from RadioBrowser API
  let radioBrowserStations: RadioStation[] = [];
  let manualStations: RadioStation[] = []; // Track manual stations for merge logic
  try {
    const allRadioBrowserStations = await fetchStations({
      countrycode: 'GB',
    });
    console.log(`Fetched ${allRadioBrowserStations.length} stations from RadioBrowser`);

    // Explicitly filter for UK stations only - check both countrycode AND country name
    // RadioBrowser API sometimes returns stations with incorrect country codes
    let filtered = allRadioBrowserStations.filter(station => {
      const countrycode = (station.countrycode || '').toUpperCase();
      const country = (station.country || '').toLowerCase();
      
      // Must have GB countrycode
      if (countrycode !== 'GB') return false;
      
      // Reject stations with explicit non-UK country names (even if countrycode is GB)
      // This catches cases where RadioBrowser has incorrect countrycode but correct country name
      const nonUKCountries = [
        'romania', 'switzerland', 'swiss', 'bangla', 'bangladesh', 'germany', 'france',
        'spain', 'italy', 'poland', 'netherlands', 'belgium', 'portugal', 'greece',
        'czech', 'hungary', 'austria', 'sweden', 'norway', 'denmark', 'finland',
        'ireland', 'eire' // Ireland is separate from UK
      ];
      if (nonUKCountries.some(nonUK => country.includes(nonUK))) {
        return false;
      }
      
      // If countrycode is GB, accept it by default (trust the countrycode)
      // Only reject if country name explicitly says it's not UK
      return true;
    });
    console.log(`After UK-only filter: ${filtered.length} stations`);

    // Filter for live stations only
    filtered = filtered.filter(station => station.lastcheckok === 1);
    console.log(`After live filter: ${filtered.length} stations`);

    // Separate seasonal and regular stations for different filtering rules
    const seasonalStations: RadioStation[] = [];
    const regularStations: RadioStation[] = [];
    
    filtered.forEach(station => {
      if (isSeasonalStation(station)) {
        seasonalStations.push(station);
      } else {
        regularStations.push(station);
      }
    });

    // For regular stations: apply strict bitrate filter (64kbps+)
    const filteredRegular = regularStations.filter(station => station.bitrate >= 64);
    
    // For seasonal stations: allow lower bitrates (0+ to handle missing/unknown bitrates)
    // Seasonal stations often have incomplete metadata
    const filteredSeasonal = seasonalStations.filter(station => (station.bitrate || 0) >= 0);
    
    console.log(`Regular stations after bitrate filter (64+): ${filteredRegular.length}`);
    console.log(`Seasonal stations (bitrate relaxed): ${filteredSeasonal.length}`);

    // For regular stations: require minimum votes (5+)
    const votedRegular = filteredRegular.filter(station => (station.votes || 0) >= 5);
    
    // For seasonal stations: lower vote threshold (1+) or no threshold
    // Seasonal stations may be new or have fewer votes
    const votedSeasonal = filteredSeasonal.filter(station => (station.votes || 0) >= 1);
    
    console.log(`Regular stations after votes filter (5+): ${votedRegular.length}`);
    console.log(`Seasonal stations after votes filter (1+): ${votedSeasonal.length}`);

    // Sort regular stations by votes and limit to top 1000
    votedRegular.sort((a, b) => (b.votes || 0) - (a.votes || 0));
    const limitedRegular = votedRegular.slice(0, 1000);
    
    // Sort seasonal stations by votes (but don't limit - include all seasonal)
    votedSeasonal.sort((a, b) => (b.votes || 0) - (a.votes || 0));
    
    // Combine: seasonal stations first (they're prioritized), then regular stations
    filtered = [...votedSeasonal, ...limitedRegular];
    console.log(`Final: ${votedSeasonal.length} seasonal + ${limitedRegular.length} regular = ${filtered.length} stations`);

    // Manually search for specific seasonal stations that might be missed
    const manualSearches = ['Heart Xmas', 'Heart Christmas', 'Capital Xmas', 'Capital Christmas'];
    
    for (const searchTerm of manualSearches) {
      try {
        const found = await searchStationByName(searchTerm);
        if (found && found.countrycode === 'GB' && found.lastcheckok === 1) {
          // Check if already in filtered list
          const alreadyExists = filtered.some(s => 
            s.stationuuid === found.stationuuid || 
            (s.name.toLowerCase() === found.name.toLowerCase() && s.url === found.url)
          );
          if (!alreadyExists) {
            // Ensure manual stations have an ID (fallback to name-based ID if missing)
            if (!found.id) {
              found.id = found.name.toLowerCase()
                .replace(/\s+/g, '_')
                .replace(/[^a-z0-9_]/g, '')
                .replace(/_+/g, '_')
                .replace(/^_|_$/g, '');
            }
            manualStations.push(found);
            console.log(`Manually found: ${found.name} (ID: ${found.id})`);
          }
        }
      } catch (error) {
        // Silent fail for manual searches
      }
    }

    // Add manually found stations to the list (prioritize them)
    radioBrowserStations = [...manualStations, ...filtered];
    console.log(`Total RadioBrowser stations: ${radioBrowserStations.length} (${manualStations.length} manual + ${filtered.length} filtered)`);
  } catch (error) {
    console.warn('Failed to fetch stations from RadioBrowser:', error);
    // Continue with local registry only if RadioBrowser fails
  }

  // Step 2: Get stations from local DAB registry
  const allLocalStations = getStationsByLocation();
  
  // Filter to focus on London/Kent/National (all receivable in South East London)
  const relevantLocalStations = allLocalStations.filter(
    station => station.location === 'London' || 
               station.location === 'Kent' || 
               station.location === 'National'
  );

  // Resolve stream URLs using dynamic discovery
  // Process in batches to avoid rate limiting
  const BATCH_SIZE = 10;
  const DELAY_BETWEEN_BATCHES = 500; // 500ms delay between batches
  
  const localStationsWithUrls: RadioStation[] = [];
  
  for (let i = 0; i < relevantLocalStations.length; i += BATCH_SIZE) {
    const batch = relevantLocalStations.slice(i, i + BATCH_SIZE);
    
    const batchResults = await Promise.all(
      batch.map(async (metadata, batchIndex) => {
        const index = i + batchIndex;
        let resolvedUrl: string | null = null;
        let homepage: string | undefined;
        let favicon: string | undefined;

        try {
          // Use network-based discovery via StreamUrlManager
          // Pass StationMetadata object for proper routing
          const streamResult = await streamUrlManager.getStreamUrl(metadata);
          if (streamResult) {
            resolvedUrl = streamResult.url;
            homepage = streamResult.homepage;
            favicon = streamResult.favicon;
          }
        } catch (error) {
          console.warn(`Failed to discover stream for ${metadata.name}:`, error);
        }

        // Create station with discovered metadata - logo resolution is handled by backend /api/logo endpoint
        return createStationFromMetadata(metadata, index, resolvedUrl || '', homepage, favicon);
      })
    );
    
    localStationsWithUrls.push(...batchResults);
    
    // Add delay between batches to avoid rate limiting (except for last batch)
    if (i + BATCH_SIZE < relevantLocalStations.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }

  console.log(`Loaded ${localStationsWithUrls.length} stations from DAB registry with dynamic URLs`);

  // Step 3: Merge local registry with RadioBrowser stations
  // Create a map of local stations by UUID for quick lookup
  const localStationsByUuid = new Map<string, RadioStation>();
  localStationsWithUrls.forEach(station => {
    if (station.stationuuid) {
      localStationsByUuid.set(station.stationuuid, station);
    }
  });

  // Combine stations: local registry takes precedence if UUID matches
  const combinedStations: RadioStation[] = [];
  const seenUuids = new Set<string>();

  // First, add all local registry stations (they take precedence)
  localStationsWithUrls.forEach(station => {
    if (station.stationuuid && !seenUuids.has(station.stationuuid)) {
      combinedStations.push(station);
      seenUuids.add(station.stationuuid);
    }
  });

  // Then, add RadioBrowser stations that aren't already in local registry
  radioBrowserStations.forEach(station => {
    // For manual stations, be more lenient - include even without UUID if name doesn't match
    const isManual = manualStations.some(m => m.stationuuid === station.stationuuid || m.name === station.name);
    
    if (station.stationuuid && !seenUuids.has(station.stationuuid)) {
      // Only add if not already present in local registry
      if (!localStationsByUuid.has(station.stationuuid)) {
        combinedStations.push(station);
        seenUuids.add(station.stationuuid);
        if (isManual) {
          console.log(`[Merge] Added manual station: ${station.name} (UUID: ${station.stationuuid})`);
        }
      } else if (isManual) {
        console.log(`[Merge] Manual station ${station.name} skipped - already in local registry`);
      }
    } else if (isManual && !station.stationuuid) {
      // Manual station without UUID - check by name+URL
      const existsByName = combinedStations.some(s => 
        s.name.toLowerCase() === station.name.toLowerCase() && s.url === station.url
      );
      if (!existsByName) {
        combinedStations.push(station);
        console.log(`[Merge] Added manual station without UUID: ${station.name}`);
      }
    } else if (isManual) {
      // Manual station with UUID but was skipped - log it
      console.log(`[Merge] Manual station ${station.name} (UUID: ${station.stationuuid}) was skipped`);
    }
  });

  console.log(`Combined ${combinedStations.length} stations from local registry and RadioBrowser`);

  // Step 4: Prioritize and sort stations
  // Priority order:
  // 1. Stations matching London/Kent/National location
  // 2. Seasonal stations (christmas, xmas, holiday)
  // 3. All other GB stations
  const prioritized = combinedStations.map(station => {
    const matchesLoc = matchesLocation(station);
    const isSeasonal = isSeasonalStation(station);
    
    // Priority score: higher = more important
    let priority = 0;
    if (matchesLoc) priority += 100;
    if (isSeasonal) priority += 50;
    
    return { station, priority };
  });

  // Sort by priority (descending), then by votes (descending)
  prioritized.sort((a, b) => {
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }
    return (b.station.votes || 0) - (a.station.votes || 0);
  });

  const sortedStations = prioritized.map(p => p.station);

  // Step 5: Final deduplication by UUID (most important for React keys)
  const finalSeenUuids = new Set<string>();
  const finalSeenNameUrl = new Set<string>();
  const uniqueStations = sortedStations.filter(station => {
    // Check for duplicate UUIDs (critical for React keys)
    if (station.stationuuid && finalSeenUuids.has(station.stationuuid)) {
      console.warn(`[Deduplication] Duplicate UUID detected: ${station.stationuuid} for ${station.name}`);
      return false;
    }
    if (station.stationuuid) {
      finalSeenUuids.add(station.stationuuid);
    }
    
    // Also check for duplicate name+URL combinations (fallback for stations without UUIDs)
    const nameUrlKey = `${station.name.toLowerCase()}_${station.url}`;
    if (finalSeenNameUrl.has(nameUrlKey)) {
      return false;
    }
    finalSeenNameUrl.add(nameUrlKey);
    
    // Log manual stations that pass deduplication
    if (manualStations.some(m => m.stationuuid === station.stationuuid || m.name === station.name)) {
      console.log(`[Deduplication] Manual station ${station.name} passed deduplication`);
    }
    
    return true;
  });

  console.log(`Final result: ${uniqueStations.length} unique stations after deduplication`);
  console.log(`[Logo] All logos will be resolved by backend /api/logo endpoint`);

  return uniqueStations;
}

