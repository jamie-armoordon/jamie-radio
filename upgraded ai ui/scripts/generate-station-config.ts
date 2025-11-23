/**
 * Generator script to fetch RadioBrowser UUIDs for target stations
 * Run with: npx tsx scripts/generate-station-config.ts
 */

interface StationSearchResult {
  stationuuid: string;
  name: string;
  favicon: string;
}

interface StationConfig {
  id: string;
  name: string;
  uuid: string;
  network: 'bbc' | 'bauer' | 'global' | 'other';
  location: 'London' | 'Kent' | 'National';
}

// Stations to find with alternative search terms
const STATIONS_TO_FIND: Array<{
  name: string;
  alternatives?: string[];
  network: 'bbc' | 'bauer' | 'global' | 'other';
  location: 'London' | 'Kent' | 'National';
  filter?: (result: StationSearchResult) => boolean;
}> = [
  // BBC
  { name: 'BBC Radio 1', network: 'bbc', location: 'National' },
  { name: 'BBC Radio 2', network: 'bbc', location: 'National' },
  { name: 'BBC Radio 1Xtra', network: 'bbc', location: 'National' },
  { name: 'BBC Radio 6 Music', network: 'bbc', location: 'National' },
  { name: 'BBC Radio London', network: 'bbc', location: 'London' },
  { name: 'BBC Radio Kent', alternatives: ['BBC Radio Kent', 'BBC Kent'], network: 'bbc', location: 'Kent' },
  
  // Global
  { name: 'Capital UK', network: 'global', location: 'National' },
  { name: 'Capital XTRA UK', alternatives: ['Capital XTRA', 'Capital Xtra UK'], network: 'global', location: 'National' },
  { name: 'Heart UK', network: 'global', location: 'National' },
  { name: 'Heart London', network: 'global', location: 'London' },
  { name: 'Heart Kent', network: 'global', location: 'Kent' },
  { name: 'LBC UK', network: 'global', location: 'National' },
  { name: 'LBC News UK', alternatives: ['LBC News', 'LBC News 1152'], network: 'global', location: 'National' },
  { name: 'Gold UK', alternatives: ['Gold', 'Gold Radio UK'], network: 'global', location: 'National', filter: (r) => !r.name.toLowerCase().includes('ukraine') },
  { name: 'Radio X UK', alternatives: ['Radio X', 'XFM UK'], network: 'global', location: 'National' },
  { name: 'Smooth UK', alternatives: ['Smooth Radio UK', 'Smooth Radio'], network: 'global', location: 'National' },
  { name: 'Classic FM UK', network: 'global', location: 'National' },
  
  // Bauer
  { name: 'Kiss UK', network: 'bauer', location: 'National' },
  { name: 'Kisstory', network: 'bauer', location: 'National' },
  { name: 'Magic Radio UK', network: 'bauer', location: 'National' },
  { name: 'Absolute Radio', network: 'bauer', location: 'National' },
  { name: 'Planet Rock', network: 'bauer', location: 'National' },
  { name: 'Greatest Hits Radio UK', alternatives: ['Greatest Hits Radio', 'GHR UK'], network: 'bauer', location: 'National' },
  { name: 'Kerrang! Radio', network: 'bauer', location: 'National' },
  { name: 'Jazz FM UK', alternatives: ['Jazz FM', 'Jazz FM London'], network: 'bauer', location: 'National', filter: (r) => !r.name.toLowerCase().includes('ukraine') },
  { name: 'Scala Radio', network: 'bauer', location: 'National' },
];

/**
 * Generate station ID from name and location
 */
function generateStationId(originalName: string, location: 'London' | 'Kent' | 'National', network: 'bbc' | 'bauer' | 'global' | 'other'): string {
  const nameLower = originalName.toLowerCase();
  
  // For BBC stations, use the discovery_id format
  if (network === 'bbc') {
    if (nameLower.includes('radio 1') && !nameLower.includes('xtra')) {
      return location === 'London' ? 'bbc_radio_one_london' : 'bbc_radio_one';
    }
    if (nameLower.includes('radio 2')) {
      return location === 'London' ? 'bbc_radio_two_london' : 'bbc_radio_two';
    }
    if (nameLower.includes('1xtra') || nameLower.includes('radio 1xtra')) {
      return location === 'London' ? 'bbc_1xtra_london' : 'bbc_1xtra';
    }
    if (nameLower.includes('radio 6') || nameLower.includes('6 music')) {
      return location === 'London' ? 'bbc_6music_london' : 'bbc_6music';
    }
    if (nameLower.includes('london')) {
      return 'bbc_london';
    }
    if (nameLower.includes('kent')) {
      return 'bbc_kent';
    }
  }
  
  // For non-BBC stations - use original name, not the matched name
  const baseId = originalName
    .toLowerCase()
    .replace(/bbc\s+/gi, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  
  // Avoid double location suffix
  if (location === 'London' && !baseId.endsWith('_london')) {
    return `${baseId}_london`;
  } else if (location === 'Kent' && !baseId.endsWith('_kent')) {
    return `${baseId}_kent`;
  }
  return baseId;
}

/**
 * Fetch station UUID from RadioBrowser with alternative search terms
 */
async function fetchStationUUID(
  stationName: string,
  alternatives?: string[],
  filter?: (result: StationSearchResult) => boolean
): Promise<StationSearchResult | null> {
  const searchTerms = [stationName, ...(alternatives || [])];
  
  for (const term of searchTerms) {
    try {
      const searchName = encodeURIComponent(term);
      const url = `https://de1.api.radio-browser.info/json/stations/search?name=${searchName}&limit=5&order=clickcount&reverse=true&countrycode=GB`;
      
      const response = await fetch(url);
      if (!response.ok) {
        continue;
      }
      
      const results: StationSearchResult[] = await response.json();
      if (results.length === 0) {
        continue;
      }
      
      // Apply filter if provided
      const filtered = filter ? results.filter(filter) : results;
      if (filtered.length > 0) {
        return filtered[0];
      }
      
      // If no filter or filter didn't match, return first result
      if (results.length > 0) {
        return results[0];
      }
    } catch (error) {
      continue;
    }
  }
  
  return null;
}

/**
 * Main function
 */
async function main() {
  console.log('Fetching UUIDs for target stations...\n');
  
  const stationConfigs: StationConfig[] = [];
  
  for (const station of STATIONS_TO_FIND) {
    console.log(`Fetching: ${station.name}...`);
    const result = await fetchStationUUID(station.name, station.alternatives, station.filter);
    
    if (result) {
      const id = generateStationId(station.name, station.location, station.network);
      stationConfigs.push({
        id,
        name: result.name,
        uuid: result.stationuuid,
        network: station.network,
        location: station.location,
      });
      console.log(`  ✓ Found: ${result.name} (UUID: ${result.stationuuid.substring(0, 8)}...)`);
    } else {
      console.log(`  ✗ Not found: ${station.name}`);
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  console.log(`\n\nFound ${stationConfigs.length} out of ${STATIONS_TO_FIND.length} stations\n`);
  console.log('// Generated STATION_LIST array:\n');
  console.log('export const STATION_LIST: StationMetadata[] = [');
  
  stationConfigs.forEach((station, index) => {
    const comma = index < stationConfigs.length - 1 ? ',' : '';
    console.log(`  {`);
    console.log(`    id: '${station.id}',`);
    console.log(`    name: '${station.name.replace(/'/g, "\\'")}',`);
    console.log(`    uuid: '${station.uuid}',`);
    console.log(`    network: '${station.network}',`);
    console.log(`    location: '${station.location}',`);
    console.log(`  }${comma}`);
  });
  
  console.log('];');
}

main().catch(console.error);
