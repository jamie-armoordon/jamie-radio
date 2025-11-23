import type { RadioStation } from '../types/station';
import { streamUrlManager } from './streamManager';
import type { StationMetadata } from '../config/stations';
import { getStationsByLocation } from '../config/stations';
import { fetchStations, searchStationByName } from './radioBrowser';

/**
 * Universal HTTPS upgrade - upgrades ALL HTTP URLs to HTTPS
 * This ensures mixed content compliance on HTTPS sites
 */
function upgradeToHttps(url: string): string {
  if (!url || url.startsWith('https://')) {
    return url;
  }
  if (url.startsWith('http://')) {
    // Global Radio: Special handling for media-ssl endpoint
    if (url.includes('media-the.musicradio.com') || url.includes('vis.media-ice.musicradio.com')) {
      return url
        .replace(/http:\/\/(media-the|vis\.media-ice)\.musicradio\.com/, 'https://media-ssl.musicradio.com')
        .replace(/^http:/, 'https:');
    }
    // Universal upgrade: ALL HTTP URLs -> HTTPS
    return url.replace(/^http:/, 'https:');
  }
  return url;
}

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
  // Upgrade URL to HTTPS for mixed content compliance
  resolvedUrl = upgradeToHttps(resolvedUrl);
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
    // Explicitly filter for UK stations only - check both countrycode AND country name
    // RadioBrowser API sometimes returns stations with incorrect country codes
    // Make this filter VERY strict - require explicit UK indicators
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
        'ireland', 'eire', 'usa', 'united states', 'canada', 'australia', 'new zealand'
      ];
      if (nonUKCountries.some(nonUK => country.includes(nonUK))) {
        return false;
      }
      
      // Additional strictness: require explicit UK indicators in country name
      // This prevents accepting stations that just happen to have GB countrycode but aren't actually UK
      const ukIndicators = [
        'united kingdom', 'uk', 'great britain', 'england', 'scotland', 'wales', 
        'northern ireland', 'british'
      ];
      const hasUKIndicator = ukIndicators.some(indicator => country.includes(indicator));
      
      // STRICT: Require explicit UK country name OR empty country (trust countrycode only if country is missing)
      // This matches the working version which filters out all RadioBrowser stations
      // We rely primarily on the local DAB registry instead
      if (country && country !== '' && !hasUKIndicator) {
        return false; // Reject if country is specified but not UK
      }
      
      // Only accept if:
      // 1. Country name is empty/unknown (trust countrycode) - but this should be rare
      // 2. Has explicit UK indicators in country name
      // In practice, this will filter out most RadioBrowser stations, matching the working version
      return true;
    });

    // Filter for live stations only
    filtered = filtered.filter(station => station.lastcheckok === 1);

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

    // For regular stations: require minimum votes (5+)
    const votedRegular = filteredRegular.filter(station => (station.votes || 0) >= 5);
    
    // For seasonal stations: lower vote threshold (1+) or no threshold
    // Seasonal stations may be new or have fewer votes
    const votedSeasonal = filteredSeasonal.filter(station => (station.votes || 0) >= 1);

    // Sort regular stations by votes and limit to top 1000
    votedRegular.sort((a, b) => (b.votes || 0) - (a.votes || 0));
    const limitedRegular = votedRegular.slice(0, 1000);
    
    // Sort seasonal stations by votes (but don't limit - include all seasonal)
    votedSeasonal.sort((a, b) => (b.votes || 0) - (a.votes || 0));
    
    // Combine: seasonal stations first (they're prioritized), then regular stations
    filtered = [...votedSeasonal, ...limitedRegular];

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
          }
        }
      } catch (error) {
        // Silent fail for manual searches
      }
    }

    // Add manually found stations to the list (prioritize them)
    radioBrowserStations = [...manualStations, ...filtered];
    
    console.log(`[getUKStations] RadioBrowser stations after filtering: ${radioBrowserStations.length}`);
    
    // Upgrade ALL URLs to HTTPS for mixed content compliance
    radioBrowserStations = radioBrowserStations.map(station => ({
      ...station,
      url: upgradeToHttps(station.url || ''),
      url_resolved: upgradeToHttps(station.url_resolved || station.url || ''),
    }));
    
  } catch (error) {
    console.error('[getUKStations] Failed to fetch stations from RadioBrowser:', error);
    // Continue with local registry only if RadioBrowser fails
    radioBrowserStations = []; // Ensure it's initialized even on error
  }
  
  // Ensure radioBrowserStations is initialized
  if (!radioBrowserStations || radioBrowserStations.length === 0) {
    console.warn('[getUKStations] No RadioBrowser stations available, will use local stations only');
  } else {
    console.log(`[getUKStations] RadioBrowser stations ready: ${radioBrowserStations.length}`);
  }

  // Step 2: Get stations from local DAB registry
  // Wrap in timeout to prevent hanging - if it takes too long, skip local stations
  const LOCAL_STATION_TIMEOUT = 10000; // 10 second total timeout for all local station resolution
  
  let localStationsWithUrls: RadioStation[] = [];
  
  try {
    const localStationPromise = (async () => {
      const allLocalStations = getStationsByLocation();
      
      // Filter to focus on London/Kent/National (all receivable in South East London)
      const relevantLocalStations = allLocalStations.filter(
        station => station.location === 'London' || 
                   station.location === 'Kent' || 
                   station.location === 'National'
      );

      // Resolve stream URLs using dynamic discovery
      // Process in smaller batches to avoid rate limiting and improve reliability
      // Prioritize stations with UUIDs (faster resolution) vs discovery_id (slower search)
      const BATCH_SIZE = 3; // Very small batch size to avoid rate limiting and timeouts
      const DELAY_BETWEEN_BATCHES = 200; // 200ms delay between batches
      const STREAM_RESOLUTION_TIMEOUT = 10000; // 10 second timeout per station (increased for reliability)
      
      // Helper to add timeout to promises
      const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
        return Promise.race([
          promise,
          new Promise<T>((_, reject) => 
            setTimeout(() => reject(new Error('Stream resolution timeout')), timeoutMs)
          )
        ]);
      };
      
      // Separate stations with UUIDs (faster) from those without (slower search)
      const stationsWithUuid = relevantLocalStations.filter(s => s.uuid);
      const stationsWithoutUuid = relevantLocalStations.filter(s => !s.uuid);
      
      // Process UUID stations first (faster resolution), then search-based stations
      const prioritizedStations = [...stationsWithUuid, ...stationsWithoutUuid];
      
      const results: RadioStation[] = [];
      let resolvedCount = 0;
      let failedCount = 0;
      
      for (let i = 0; i < prioritizedStations.length; i += BATCH_SIZE) {
        const batch = prioritizedStations.slice(i, i + BATCH_SIZE);
        
        const batchResults = await Promise.all(
          batch.map(async (metadata, batchIndex) => {
            const index = i + batchIndex;
            let resolvedUrl: string | null = null;
            let homepage: string | undefined;
            let favicon: string | undefined;

            try {
              // Use network-based discovery via StreamUrlManager with timeout
              // Pass StationMetadata object for proper routing
              const streamResult = await withTimeout(
                streamUrlManager.getStreamUrl(metadata),
                STREAM_RESOLUTION_TIMEOUT
              );
              if (streamResult && streamResult.url) {
                resolvedUrl = streamResult.url;
                homepage = streamResult.homepage;
                favicon = streamResult.favicon;
                resolvedCount++;
                console.log(`[getUKStations] Resolved stream for ${metadata.name}: ${resolvedUrl.substring(0, 50)}...`);
              } else {
                failedCount++;
                console.warn(`[getUKStations] No stream URL returned for ${metadata.name}`);
              }
            } catch (error) {
              // Timeout or other error - continue without stream URL
              failedCount++;
              console.warn(`[getUKStations] Failed to discover stream for ${metadata.name}:`, error instanceof Error ? error.message : error);
            }

            // Create station with discovered metadata - logo resolution is handled by backend /api/logo endpoint
            return createStationFromMetadata(metadata, index, resolvedUrl || '', homepage, favicon);
          })
        );
        
        results.push(...batchResults);
        
        // Add delay between batches to avoid rate limiting (except for last batch)
        if (i + BATCH_SIZE < prioritizedStations.length) {
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
        }
      }
      
      console.log(`[getUKStations] Stream resolution complete: ${resolvedCount} resolved, ${failedCount} failed, ${prioritizedStations.length - resolvedCount - failedCount} skipped`);
      
      return results;
    })();
    
    // Race against timeout - if local station resolution takes too long, skip it
    localStationsWithUrls = await Promise.race([
      localStationPromise,
      new Promise<RadioStation[]>((resolve) => {
        setTimeout(() => {
          console.warn('[getUKStations] Local station resolution timed out, continuing with RadioBrowser stations only');
          resolve([]);
        }, LOCAL_STATION_TIMEOUT);
      })
    ]);
    
  } catch (error) {
    console.error('[getUKStations] Error loading local stations, continuing with RadioBrowser stations only:', error);
    localStationsWithUrls = [];
  }

  // Step 3: Merge local registry with RadioBrowser stations
  console.log(`[getUKStations] Merging: ${localStationsWithUrls.length} local, ${radioBrowserStations.length} RadioBrowser stations`);
  
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
  let addedFromRadioBrowser = 0;
  radioBrowserStations.forEach(station => {
    if (station.stationuuid && !seenUuids.has(station.stationuuid)) {
      // Only add if not already present in local registry
      if (!localStationsByUuid.has(station.stationuuid)) {
        combinedStations.push(station);
        seenUuids.add(station.stationuuid);
        addedFromRadioBrowser++;
      }
    }
  });
  console.log(`[getUKStations] Combined: ${combinedStations.length} total (${localStationsWithUrls.length} local, ${addedFromRadioBrowser} from RadioBrowser)`);

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
    
    return true;
  });

  console.log(`[getUKStations] Final unique stations: ${uniqueStations.length} (${localStationsWithUrls.length} local, ${radioBrowserStations.length} RadioBrowser)`);
  
  return uniqueStations;
}
