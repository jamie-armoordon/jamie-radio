/**
 * Station Registry
 * Comprehensive metadata registry derived from DAB_Stations_2025.md
 * All stations are London/Kent focused with network-based discovery routing
 */

export type StationNetwork = 'bbc' | 'bauer' | 'global' | 'other';

export type StationLocation = 'London' | 'Kent' | 'National';

export interface StationMetadata {
  id: string;           // unique internal ID (e.g., 'kiss_london')
  name: string;         // Display Name from the Markdown file
  uuid?: string;        // RadioBrowser UUID (stable identifier for stream lookup)
  network: StationNetwork; // Derived from the 'Owner' column
  discovery_id?: string; // The slug/key used by our discovery services (primarily for BBC lsn.lv)
  location: StationLocation;
  genre?: string;        // From the 'Format/Genre' column (optional for UUID-based stations)
  domain?: string;       // Domain for Clearbit logo lookup
  logo_url?: string;    // Legacy logo URL (deprecated, use API logo endpoint)
}

/**
 * Helper function to generate station ID from name and location
 * For BBC stations, preserves bbc_ prefix and uses proper format for API
 */
function generateStationId(name: string, location: StationLocation, network: StationNetwork): string {
  const nameLower = name.toLowerCase();
  
  // For BBC stations, use the discovery_id format (which matches API expectations)
  if (network === 'bbc') {
    // Use the same logic as generateDiscoveryId for BBC stations
    if (nameLower.includes('radio 1') && nameLower.includes('anthems')) {
      return location === 'London' ? 'bbc_radio_one_anthems_london' : 'bbc_radio_one_anthems';
    }
    if (nameLower.includes('radio 1') && nameLower.includes('dance')) {
      return location === 'London' ? 'bbc_radio_one_dance_london' : 'bbc_radio_one_dance';
    }
    if (nameLower.includes('radio 3') && nameLower.includes('unwind')) {
      return location === 'London' ? 'bbc_radio_three_unwind_london' : 'bbc_radio_three_unwind';
    }
    if (nameLower.includes('radio 1') && !nameLower.includes('xtra') && !nameLower.includes('anthems') && !nameLower.includes('dance')) {
      return location === 'London' ? 'bbc_radio_one_london' : 'bbc_radio_one';
    }
    if (nameLower.includes('radio 2')) {
      return location === 'London' ? 'bbc_radio_two_london' : 'bbc_radio_two';
    }
    if (nameLower.includes('radio 3') && !nameLower.includes('unwind')) {
      return location === 'London' ? 'bbc_radio_three_london' : 'bbc_radio_three';
    }
    if (nameLower.includes('radio 4') && nameLower.includes('extra')) {
      return location === 'London' ? 'bbc_radio_four_extra_london' : 'bbc_radio_four_extra';
    }
    if (nameLower.includes('radio 4')) {
      return location === 'London' ? 'bbc_radio_fourfm_london' : 'bbc_radio_fourfm';
    }
    if (nameLower.includes('radio 5') && nameLower.includes('sports extra')) {
      return location === 'London' ? 'bbc_radio_five_live_sports_extra_london' : 'bbc_radio_five_live_sports_extra';
    }
    if (nameLower.includes('radio 5')) {
      return location === 'London' ? 'bbc_radio_five_live_london' : 'bbc_radio_five_live';
    }
    if (nameLower.includes('radio 6') || nameLower.includes('6 music')) {
      return location === 'London' ? 'bbc_6music_london' : 'bbc_6music';
    }
    if (nameLower.includes('1xtra') || nameLower.includes('radio 1xtra')) {
      return location === 'London' ? 'bbc_1xtra_london' : 'bbc_1xtra';
    }
    if (nameLower.includes('asian network')) {
      return location === 'London' ? 'bbc_asian_network_london' : 'bbc_asian_network';
    }
    if (nameLower.includes('world service')) {
      return location === 'London' ? 'bbc_world_service_london' : 'bbc_world_service';
    }
    if (nameLower.includes('london')) {
      return 'bbc_london';
    }
    // Fallback for other BBC stations
    const baseId = nameLower.replace(/bbc\s+/gi, 'bbc_').replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    return location === 'London' ? `${baseId}_london` : baseId;
  }
  
  // For non-BBC stations, use the original logic
  const baseId = name
    .toLowerCase()
    .replace(/bbc\s+/gi, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  
  if (location === 'London') {
    return `${baseId}_london`;
  } else if (location === 'Kent') {
    return `${baseId}_kent`;
  }
  return baseId;
}

/**
 * Map owner to network
 * Note: Some stations in the markdown have incorrect ownership.
 * We override based on actual network ownership.
 */
function mapOwnerToNetwork(owner: string, stationName: string): StationNetwork {
  const ownerLower = owner.toLowerCase();
  const nameLower = stationName.toLowerCase();
  
  // Override incorrect ownership from markdown
  // Capital, Heart, LBC, Gold, Radio X are Global Media (not Bauer)
  if (nameLower.includes('capital') || 
      nameLower.includes('heart') || 
      nameLower.includes('lbc') ||
      (nameLower.includes('gold') && !nameLower.includes('greatest hits')) ||
      nameLower.includes('radio x') ||
      nameLower.includes('xfm')) {
    return 'global';
  }
  
  // BBC stations
  if (ownerLower.includes('bbc') || nameLower.includes('bbc')) return 'bbc';
  
  // Bauer stations (Smooth, Kiss, Magic, Absolute, Planet Rock, Greatest Hits, etc.)
  if (ownerLower.includes('bauer') || 
      nameLower.includes('smooth') ||
      nameLower.includes('kiss') ||
      nameLower.includes('magic') ||
      nameLower.includes('absolute') ||
      nameLower.includes('planet rock') ||
      nameLower.includes('greatest hits') ||
      nameLower.includes('hits radio') ||
      nameLower.includes('jazz fm') ||
      nameLower.includes('kerrang')) {
    return 'bauer';
  }
  
  if (ownerLower.includes('global')) return 'global';
  return 'other';
}

/**
 * Generate discovery_id based on network and station name
 */
function generateDiscoveryId(name: string, network: StationNetwork, location: StationLocation): string {
  const nameLower = name.toLowerCase().trim();
  
  if (network === 'bbc') {
    // BBC discovery IDs follow pattern: bbc_radio_one, bbc_radio_fourfm, etc.
    if (nameLower.includes('radio 1') && nameLower.includes('anthems')) return 'bbc_radio_one_anthems';
    if (nameLower.includes('radio 1') && nameLower.includes('dance')) return 'bbc_radio_one_dance';
    if (nameLower.includes('radio 3') && nameLower.includes('unwind')) return 'bbc_radio_three_unwind';
    if (nameLower.includes('radio 1') && !nameLower.includes('xtra') && !nameLower.includes('anthems') && !nameLower.includes('dance')) return 'bbc_radio_one';
    if (nameLower.includes('radio 2')) return 'bbc_radio_two';
    if (nameLower.includes('radio 3') && !nameLower.includes('unwind')) return 'bbc_radio_three';
    if (nameLower.includes('radio 4') && nameLower.includes('extra')) return 'bbc_radio_four_extra';
    if (nameLower.includes('radio 4')) return 'bbc_radio_fourfm';
    if (nameLower.includes('radio 5') && nameLower.includes('sports extra')) return 'bbc_radio_five_live_sports_extra';
    if (nameLower.includes('radio 5')) return 'bbc_radio_five_live';
    if (nameLower.includes('radio 6') || nameLower.includes('6 music')) return 'bbc_6music';
    if (nameLower.includes('1xtra') || nameLower.includes('radio 1xtra')) return 'bbc_1xtra';
    if (nameLower.includes('asian network')) return 'bbc_asian_network';
    if (nameLower.includes('world service')) return 'bbc_world_service';
    if (nameLower.includes('london')) return 'bbc_london';
    // Fallback: generate from name
    return nameLower.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  }
  
  if (network === 'bauer') {
    // Bauer Planet Radio slugs
    if (nameLower.includes('absolute radio') && nameLower.includes('80s')) return 'absoluteradio80s';
    if (nameLower.includes('absolute radio') && nameLower.includes('90s')) return 'absoluteradio90s';
    if (nameLower.includes('absolute radio') && nameLower.includes('70s')) return 'absoluteradio70s';
    if (nameLower.includes('absolute radio') && nameLower.includes('00s')) return 'absoluteradio00s';
    if (nameLower.includes('absolute radio') && nameLower.includes('60s')) return 'absoluteradio60s';
    if (nameLower.includes('absolute radio') && nameLower.includes('classic rock')) return 'absoluteradioclassicrock';
    if (nameLower.includes('absolute radio')) return 'absoluteradio';
    if (nameLower.includes('kiss') && nameLower.includes('fresh')) return 'kissfresh';
    if (nameLower.includes('kiss') && nameLower.includes('story') || nameLower.includes('kisstory')) return 'kisstory';
    if (nameLower.includes('kiss')) return 'kissfm';
    if (nameLower.includes('magic') && nameLower.includes('soul')) return 'magicsoul';
    if (nameLower.includes('magic') && nameLower.includes('mellow')) return 'mellowmagic';
    if (nameLower.includes('magic')) return 'magicfm';
    if (nameLower.includes('planet rock')) return 'planetrock';
    if (nameLower.includes('jazz fm')) return 'jazzfm';
    if (nameLower.includes('kerrang')) return 'kerrang';
    if (nameLower.includes('heat radio')) return 'heatradio';
    if (nameLower.includes('hits radio') && nameLower.includes('90s')) return 'hitsradio90s';
    if (nameLower.includes('hits radio') && nameLower.includes('00s')) return 'hitsradio00s';
    if (nameLower.includes('hits radio')) return 'hitsradio';
    if (nameLower.includes('greatest hits radio') && nameLower.includes('70s')) return 'greatesthitsradio70s';
    if (nameLower.includes('greatest hits radio') && nameLower.includes('80s')) return 'greatesthitsradio80s';
    if (nameLower.includes('greatest hits radio')) return 'greatesthitsradio';
    if (nameLower.includes('radio x')) return 'radiox';
    if (nameLower.includes('smooth') && nameLower.includes('chill')) return 'smoothchill';
    if (nameLower.includes('smooth') && nameLower.includes('relax')) return 'smoothrelax';
    if (nameLower.includes('smooth') && nameLower.includes('country')) return 'smoothcountry';
    // Smooth Radio uses 'smoothuk' or 'smoothradio' for Bauer streams
    if (nameLower.includes('smooth') && (location === 'London' || location === 'National')) return 'smoothuk';
    if (nameLower.includes('smooth')) return 'smoothuk';
    if (nameLower.includes('gold')) return 'gold';
    if (nameLower.includes('boom radio')) return 'boomradio';
    if (nameLower.includes('scala radio')) return 'scalaradio';
    if (nameLower.includes('gaydio')) return 'gaydio';
    if (nameLower.includes('team rock')) return 'teamrock';
    // Fallback: lowercase, no spaces
    return nameLower.replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
  }
  
  if (network === 'global') {
    // Global stations: use exact search terms for RadioBrowser/RadioFeeds
    if (location === 'London' && nameLower.includes('capital')) return 'Capital London';
    if (location === 'Kent' && nameLower.includes('heart')) return 'Heart Kent';
    if (location === 'Kent' && nameLower.includes('heart') && nameLower.includes('south')) return 'Heart South';
    if (nameLower.includes('lbc') && nameLower.includes('news')) return 'LBC News';
    if (nameLower.includes('lbc')) return 'LBC';
    if (nameLower.includes('classic fm')) return 'Classic FM';
    if (nameLower.includes('heart') && nameLower.includes('70s')) return 'Heart 70s';
    if (nameLower.includes('heart') && nameLower.includes('80s')) return 'Heart 80s';
    if (nameLower.includes('heart') && nameLower.includes('90s')) return 'Heart 90s';
    if (nameLower.includes('heart') && nameLower.includes('dance')) return 'Heart Dance';
    if (nameLower.includes('heart')) return 'Heart';
    if (nameLower.includes('capital') && nameLower.includes('dance')) return 'Capital Dance';
    if (nameLower.includes('capital') && nameLower.includes('xtra') && nameLower.includes('reloaded')) return 'Capital XTRA Reloaded';
    if (nameLower.includes('capital') && nameLower.includes('xtra')) return 'Capital XTRA';
    if (nameLower.includes('capital')) return 'Capital';
    if (nameLower.includes('smooth')) return 'Smooth Radio';
    if (nameLower.includes('xfm')) return 'XFM London';
    if (nameLower.includes('talksport') && nameLower.includes('2')) return 'talkSPORT 2';
    if (nameLower.includes('talksport')) return 'talkSPORT';
    // Fallback: use name as-is
    return name;
  }
  
  // Other networks: use station name as discovery_id
  return name;
}

/**
 * Create station metadata from raw data
 */
function createStation(
  name: string,
  genre: string,
  owner: string,
  location: StationLocation
): StationMetadata {
  const network = mapOwnerToNetwork(owner, name);
  const id = generateStationId(name, location, network);
  const discovery_id = generateDiscoveryId(name, network, location);
  
  return {
    id,
    name,
    network,
    discovery_id,
    location,
    genre,
  };
}

/**
 * Station Registry - All stations from DAB_Stations_2025.md
 * Deduplicated with preference for London local versions
 */
export const STATION_REGISTRY: StationMetadata[] = [
  // BBC National DAB
  createStation('BBC Radio 1', 'Youth Popular Music (CHR)', 'BBC', 'National'),
  createStation('BBC Radio 2', 'Adult Contemporary Music', 'BBC', 'National'),
  createStation('BBC Radio 3', 'Classical/Serious Music', 'BBC', 'National'),
  createStation('BBC Radio 4', 'Speech/News/Current Affairs', 'BBC', 'National'),
  createStation('BBC Radio 4 Extra', 'Comedy/Drama/Archive', 'BBC', 'National'),
  createStation('BBC Radio 5 Live', 'News/Sport/Talk', 'BBC', 'National'),
  createStation('BBC Radio 5 Live Sports Extra', 'Sport Coverage (Part-time)', 'BBC', 'National'),
  createStation('BBC Radio 1Xtra', 'Black Music/Hip-Hop', 'BBC', 'National'),
  createStation('BBC Radio 6 Music', 'Alternative/Indie Rock', 'BBC', 'National'),
  createStation('BBC Asian Network', 'South Asian Music/Speech', 'BBC', 'National'),
  createStation('BBC World Service', 'International News/Talk', 'BBC', 'National'),
  createStation('BBC Radio 1 Anthems', '2000s/2010s Pop Hits', 'BBC', 'National'),
  createStation('BBC Radio 1 Dance', '24/7 Dance Music', 'BBC', 'National'),
  createStation('BBC Radio 3 Unwind', 'Classical/Meditation/Wellbeing', 'BBC', 'National'),

  // Digital One National
  createStation('Absolute Radio', 'Adult Alternative Rock', 'Bauer Media', 'National'),
  createStation('Absolute Radio 80s', '1980s Rock Hits', 'Bauer Media', 'National'),
  createStation('Absolute Radio 90s', '1990s Rock Hits', 'Bauer Media', 'National'),
  createStation('Classic FM', 'Classical Music', 'Global Media', 'National'),
  createStation('KISS', 'Hip-Hop/R&B/Dance', 'Bauer Media', 'National'),
  createStation('KISSTORY', 'Old Skool/Anthems', 'Bauer Media', 'National'),
  createStation('Magic', 'Melodic Adult Contemporary', 'Bauer Media', 'National'),
  createStation('Planet Rock', 'Rock Music', 'Bauer Media', 'National'),
  createStation('Capital XTRA', 'Urban/Dance Music', 'Bauer Media', 'National'),
  createStation('Capital Dance', 'Dance Music', 'Bauer Media', 'National'),
  createStation('Capital XTRA Reloaded', 'Urban Music Archive', 'Bauer Media', 'National'),
  createStation('Gold UK', 'Classic Hits', 'Bauer Media', 'National'),
  createStation('Heart UK', 'Adult Contemporary', 'Bauer Media', 'National'),
  createStation('Heart 70s', '1970s Music', 'Bauer Media', 'National'),
  createStation('Heart 80s', '1980s Music', 'Bauer Media', 'National'),
  createStation('Heart 90s', '1990s Music', 'Bauer Media', 'National'),
  createStation('Heart Dance', 'Rhythmic Adult Contemporary', 'Bauer Media', 'National'),
  createStation('Hits Radio 90s', '1990s Hits', 'Bauer Media', 'National'),
  createStation('Hits Radio 00s', '2000s Hits', 'Bauer Media', 'National'),
  createStation('Greatest Hits Radio 70s', '1970s Greatest Hits', 'Bauer Media', 'National'),
  createStation('Greatest Hits Radio 80s', '1980s Greatest Hits', 'Bauer Media', 'National'),
  createStation('Radio X', 'Alternative/Indie Rock', 'Bauer Media', 'National'),
  createStation('Smooth UK', 'Soft Adult Contemporary', 'Bauer Media', 'National'),
  createStation('Smooth Chill', 'Chill/Ambient/Trip-Hop', 'Bauer Media', 'National'),
  createStation('Smooth Relax', 'Relaxation/Meditation', 'Bauer Media', 'National'),
  createStation('LBC', 'Talk/Phone-in', 'Global Media', 'National'),
  createStation('LBC News', '24-hour Rolling News', 'Global Media', 'National'),
  createStation('talkSPORT', 'Sports Talk', 'Global Media', 'National'),
  createStation('UCB 1', 'Christian Music', 'United Christian Broadcasting', 'National'),
  createStation('UCB 2', 'Christian Music (Varied)', 'United Christian Broadcasting', 'National'),
  createStation('Premier Christian Radio', 'Christian Talk/Music', 'Premier Christian', 'National'),
  createStation('BFBS Radio', 'Forces Network', 'BFBS', 'National'),
  createStation('Jazz FM', 'Jazz Music', 'Bauer Media', 'National'),
  createStation('Kerrang!', 'Rock Music', 'Bauer Media', 'National'),
  createStation('Team Rock', 'Rock Music (Varied Styles)', 'Bauer Media', 'National'),

  // Sound Digital National
  createStation('BFBS UK', 'Forces Network', 'BFBS', 'National'),
  createStation('Boom Radio UK', 'Indie/Alternative Rock', 'Bauer Media', 'National'),
  createStation('Fun Kids UK', 'Children\'s Music/Talk', 'Children\'s Radio UK Ltd', 'National'),
  createStation('Mellow Magic', 'Soft Adult Contemporary', 'Bauer Media', 'National'),
  createStation('Premier Praise', 'Christian Music (Gospel)', 'Premier Christian', 'National'),
  createStation('Scala Radio', 'Classical at Home Music', 'Bauer Media', 'National'),
  createStation('Sunrise National', 'Spiritual Music/Talk', 'Nation Broadcasting', 'National'),
  createStation('talkRADIO', 'Talk/Current Affairs', 'Wireless Group', 'National'),
  createStation('talkSPORT 2', 'Sports Talk', 'Global Media', 'National'),
  createStation('Times Radio', 'News/Current Affairs', 'Times Radio Ltd', 'National'),
  createStation('Union Jack', 'Pop/Dance/Variety', 'Wireless Group', 'National'),
  createStation('Union JACK Dance', 'Dance Music', 'Wireless Group', 'National'),
  createStation('Union Jack Rock', 'Rock Music', 'Wireless Group', 'National'),
  createStation('Virgin Anthems', 'Pop Hits', 'Virgin Radio', 'National'),
  createStation('Virgin Chilled', 'Chill/Lounge', 'Virgin Radio', 'National'),
  createStation('Virgin Radio', 'Rock/Pop Hits', 'Virgin Radio', 'National'),

  // London 1 (prefer London local versions)
  createStation('Capital London', 'Contemporary Hit Radio (CHR)', 'Global Media', 'London'),
  createStation('Capital XTRA London', 'Urban/Dance Music', 'Bauer Media', 'London'),
  createStation('Heart London', 'Adult Contemporary', 'Global Media', 'London'),
  createStation('Kiss London', 'Urban/Dance Music', 'Bauer Media', 'London'),
  createStation('Kiss Fresh', 'Dance/Electronic', 'Bauer Media', 'London'),
  createStation('Magic London', 'Soft Adult Contemporary', 'Bauer Media', 'London'),
  createStation('Magic Soul', 'Soul/Smooth Hits', 'Bauer Media', 'London'),
  createStation('Smooth London', 'Soft Adult Contemporary Hits', 'Bauer Media', 'London'),
  createStation('LBC 97.3', 'Talk/Phone-in', 'Global Media', 'London'),
  createStation('LBC News 1152', '24-hour Rolling News', 'Global Media', 'London'),
  createStation('The Hits Radio', 'Contemporary Hits', 'Bauer Media', 'London'),
  createStation('Heat Radio', 'Urban/Pop/Lifestyle', 'Bauer Media', 'London'),
  createStation('Kerrang! Radio', 'Rock Music', 'Bauer Media', 'London'),
  createStation('Sunrise Radio', 'South Asian Music/Talk', 'Nation Broadcasting', 'London'),

  // London 2
  createStation('BBC London', 'Regional Speech/News', 'BBC', 'London'),
  createStation('XFM London', 'Alternative/Indie Rock', 'Global Media', 'London'),
  createStation('Gold London', 'Classic Hits', 'Bauer Media', 'London'),
  createStation('Absolute Radio 70s', '1970s Rock Hits', 'Bauer Media', 'London'),
  createStation('Absolute Radio 00s', '2000s Rock Hits', 'Bauer Media', 'London'),
  createStation('Jazz FM London', 'Jazz Music', 'Bauer Media', 'London'),
  createStation('Amazing Radio', 'Indie/Alternative/Original Music', 'Amazing Radio', 'London'),
  createStation('Spectrum Radio', 'Community/Ethnic/Multi-cultural', 'Spectrum Radio', 'London'),
  createStation('French Radio London', 'French Language/Music', 'French Radio London', 'London'),
  createStation('Voice of Russia', 'Russian Language/Talk', 'RT', 'London'),
  createStation('UCB Inspirational', 'Christian Music/Talk', 'United Christian Broadcasting', 'London'),
  createStation('talkSPORT London', 'Sports Talk', 'Global Media', 'London'),
  createStation('Nation Radio', 'Mainstream Music', 'Nation Broadcasting', 'London'),
  createStation('Hits Radio London', 'Mainstream Hits', 'Bauer Media', 'London'),
  createStation('Kerrang! London', 'Rock Music', 'Bauer Media', 'London'),
  createStation('FIX Radio', 'Alternative/Indie/Electronic', 'FIX Radio', 'London'),
  createStation('Asian FX Radio', 'Asian Music/Talk', 'Asian FX', 'London'),
  createStation('Centreforce 883', 'Dance/Electronic Music', 'Centreforce', 'London'),
  createStation('CountryLine Radio', 'Country Music', 'CountryLine Radio', 'London'),
  createStation('Mi-Soul Radio', 'Soul/R&B/Funk', 'Mi-Soul Radio', 'London'),
  createStation('Radio Maria England', 'Catholic/Christian Talk/Music', 'Radio Maria', 'London'),
  createStation('Smooth Country', 'Country Hits', 'Bauer Media', 'London'),
  createStation('Virgin Radio Groove', 'Dance/Electronic Groove', 'Virgin Radio', 'London'),
  createStation('Adventist Radio', 'Religious/Christian', 'Seventh-day Adventist Church', 'London'),

  // London 3
  createStation('Gaydio London', 'LGBT/Dance/Pop', 'Bauer Media', 'London'),
  createStation('Fun Kids', 'Children\'s Music/Talk', 'Children\'s Radio UK Ltd', 'London'),
  createStation('Absolute Classic Rock', 'Classic Rock Hits', 'Bauer Media', 'London'),
  createStation('Absolute Radio 60s', '1960s Rock Hits', 'Bauer Media', 'London'),
  createStation('Panjab Radio', 'Punjabi Music/South Asian', 'Panjab Radio', 'London'),
  createStation('Kismat Radio', 'South Asian Music', 'Kismat Radio', 'London'),
  createStation('Desi Radio', 'South Asian Music/Culture', 'Desi Radio', 'London'),
  createStation('IBC Tamil', 'Tamil Language/Music', 'IBC Tamil', 'London'),
  createStation('Chill Radio', 'Ambient/Chill/Lounge', 'Chill Radio', 'London'),
  createStation('Rainbow Radio', 'Community/Multicultural', 'Rainbow Radio', 'London'),
  createStation('Premier Gospel', 'Gospel Music', 'Premier Christian', 'London'),
  createStation('Polish Radio London', 'Polish Language/Music', 'Polish Radio London', 'London'),
  createStation('The Arrow', 'Rock Music (Album Rock)', 'The Arrow', 'London'),
  createStation('The Wireless', 'Digital/Underground Music', 'The Wireless', 'London'),
  createStation('Colourful Radio', 'LGBT Community/Music', 'Colourful Radio', 'London'),
  createStation('ABN Radio UK', 'Bangladeshi/Bengali/Asian', 'ABN Radio UK', 'London'),
  createStation('Bloomberg Radio', 'Business/Financial News/Talk', 'Bloomberg', 'London'),
  createStation('GN Radio', 'Greek Language/Music', 'GN Radio', 'London'),
  createStation('Matryoshka Radio', 'Russian/Eastern European', 'Matryoshka Radio', 'London'),
  createStation('Radio 1035', 'Community/Multicultural', 'Radio 1035', 'London'),
  createStation('Radio 1458', 'Asian/Urdu Language', 'Radio 1458', 'London'),
  createStation('Voice of Islam', 'Islamic/Muslim Community', 'Voice of Islam', 'London'),

  // Kent
  createStation('KMFM', 'Contemporary Hit Radio (CHR)', 'KM Group', 'Kent'),
  createStation('Heart Kent', 'Adult Contemporary', 'Global Media', 'Kent'),
  createStation('Heart South', 'Adult Contemporary (South Kent)', 'Global Media', 'Kent'),
];

/**
 * UUID-based Station List (refactored stations using RadioBrowser UUIDs)
 * These stations use UUIDs for stable stream URL resolution
 */
export const STATION_LIST: StationMetadata[] = [
  {
    id: 'bbc_radio_one',
    name: 'BBC Radio 1',
    uuid: 'fdbdc2b0-c184-437b-8643-9a5bfa45c253',
    network: 'bbc',
    location: 'National',
    discovery_id: 'bbc_radio_one',
    // logo_url removed - will use API logo from homepage
  },
  {
    id: 'bbc_radio_two',
    name: 'BBC Radio 2',
    uuid: '3606ef8c-cd58-4440-8c47-dbf1e0cacdac',
    network: 'bbc',
    location: 'National',
    discovery_id: 'bbc_radio_two',
    // logo_url removed - will use API logo from homepage
  },
  {
    id: 'bbc_1xtra',
    name: 'BBC Radio 1Xtra',
    uuid: '308d38c6-e8a4-41e9-8ffe-9be2623826a4',
    network: 'bbc',
    location: 'National',
    discovery_id: 'bbc_1xtra',
    // logo_url removed - will use API logo from homepage
  },
  {
    id: 'bbc_6music',
    name: 'BBC Radio 6 Music',
    uuid: '1c6dcd6f-88c6-4fd4-8191-078435168e85',
    network: 'bbc',
    location: 'National',
    discovery_id: 'bbc_6music',
    // logo_url removed - will use API logo from homepage
  },
  {
    id: 'bbc_london',
    name: 'BBC Radio London',
    uuid: '7202a916-7f90-4e7f-8470-155a36d97681',
    network: 'bbc',
    location: 'London',
    discovery_id: 'bbc_london',
    // logo_url removed - will use API logo from homepage
  },
  {
    id: 'capital_uk',
    name: 'Capital UK',
    uuid: '7dfc847f-bf1b-11e8-aaf2-52543be04c81',
    network: 'global',
    location: 'National',
    discovery_id: 'Capital UK',
  },
  {
    id: 'capital_xtra_uk',
    name: 'Capital XTRA',
    uuid: '11d4d77d-603c-43b5-b9a3-9f7deb75c8da',
    network: 'global',
    location: 'National',
    discovery_id: 'Capital XTRA',
  },
  {
    id: 'heart_uk',
    name: 'Heart UK',
    uuid: '283402b5-dc2e-11e9-a8ba-52543be04c81',
    network: 'global',
    location: 'National',
    discovery_id: 'Heart UK',
  },
  {
    id: 'heart_london',
    name: 'Heart London',
    uuid: '9608ade8-0601-11e8-ae97-52543be04c81',
    network: 'global',
    location: 'London',
    discovery_id: 'Heart London',
  },
  {
    id: 'heart_kent',
    name: 'Heart Kent',
    uuid: '961c014a-0601-11e8-ae97-52543be04c81',
    network: 'global',
    location: 'Kent',
    discovery_id: 'Heart Kent',
  },
  {
    id: 'lbc_uk',
    name: 'LBC UK',
    uuid: '6efe216d-bf7e-11e9-8502-52543be04c81',
    network: 'global',
    location: 'National',
    discovery_id: 'LBC UK',
  },
  {
    id: 'lbc_news_uk',
    name: 'LBC News',
    uuid: '8e32c763-b926-4e57-9b8f-d60f1c5b48e3',
    network: 'global',
    location: 'National',
    discovery_id: 'LBC News',
  },
  {
    id: 'gold_uk',
    name: 'Gold',
    uuid: '0a1e0bb0-dc37-11e9-a8ba-52543be04c81',
    network: 'global',
    location: 'National',
    discovery_id: 'Gold UK',
  },
  {
    id: 'radio_x_uk',
    name: 'Radio X',
    uuid: '9617bbd8-0601-11e8-ae97-52543be04c81',
    network: 'global',
    location: 'National',
    discovery_id: 'Radio X UK',
  },
  {
    id: 'smooth_uk',
    name: 'Smooth Radio',
    uuid: '962b27a3-0601-11e8-ae97-52543be04c81',
    network: 'global',
    location: 'National',
    discovery_id: 'Smooth UK',
  },
  {
    id: 'classic_fm_uk',
    name: 'Classic FM UK',
    uuid: '96063f25-0601-11e8-ae97-52543be04c81',
    network: 'global',
    location: 'National',
    discovery_id: 'Classic FM UK',
  },
  {
    id: 'kiss_uk',
    name: 'KISS UK',
    uuid: '5984167a-b25e-4eec-a878-ff9253ee0c4a',
    network: 'bauer',
    location: 'National',
    discovery_id: 'Kiss UK',
  },
  {
    id: 'kisstory',
    name: 'Kisstory',
    uuid: '9610ab94-0601-11e8-ae97-52543be04c81',
    network: 'bauer',
    location: 'National',
    discovery_id: 'Kisstory',
  },
  {
    id: 'magic_radio_uk',
    name: 'Magic Radio UK',
    uuid: '172d8c95-fecd-40b7-af6f-9cdf4e8829e4',
    network: 'bauer',
    location: 'National',
    discovery_id: 'Magic Radio UK',
  },
  {
    id: 'absolute_radio',
    name: 'Absolute Radio',
    uuid: '0123993c-730c-48f2-a2bd-cc9a590ab804',
    network: 'bauer',
    location: 'National',
    discovery_id: 'Absolute Radio',
  },
  {
    id: 'planet_rock',
    name: 'Planet Rock',
    uuid: 'd9c36b10-a09b-4551-838d-875cb44a5629',
    network: 'bauer',
    location: 'National',
    discovery_id: 'Planet Rock',
    // logo_url removed - will use API logo from homepage
  },
  {
    id: 'greatest_hits_radio_uk',
    name: 'Greatest Hits Radio',
    uuid: 'c8f8ce5c-8d6b-4e72-9eb6-a07e1706a949',
    network: 'bauer',
    location: 'National',
    discovery_id: 'Greatest Hits Radio',
  },
  {
    id: 'kerrang_radio',
    name: 'Kerrang! Radio',
    uuid: '04e5c964-d5f3-45bb-a61d-f8896b97c137',
    network: 'bauer',
    location: 'National',
    discovery_id: 'Kerrang Radio',
  },
  {
    id: 'jazz_fm_uk',
    name: 'Jazz FM UK',
    uuid: 'ba6280e7-8c72-420d-a20b-2fdd6988b353',
    network: 'bauer',
    location: 'National',
    discovery_id: 'Jazz FM UK',
  },
  {
    id: 'scala_radio',
    name: 'Scala Radio',
    uuid: '7235335e-131f-4a3b-8b5b-c8bcec9bc215',
    network: 'bauer',
    location: 'National',
    discovery_id: 'Scala Radio',
  },
];

/**
 * Get all stations (combines UUID-based list with legacy registry)
 * UUID-based stations take precedence
 */
export function getAllStations(): StationMetadata[] {
  const uuidMap = new Map<string, StationMetadata>();
  
  // First, add all UUID-based stations
  STATION_LIST.forEach(station => {
    uuidMap.set(station.id, station);
  });
  
  // Then add legacy stations that aren't in UUID list
  STATION_REGISTRY.forEach(station => {
    if (!uuidMap.has(station.id)) {
      uuidMap.set(station.id, station);
    }
  });
  
  return Array.from(uuidMap.values());
}

/**
 * Get all stations filtered by location
 */
export function getStationsByLocation(location?: StationLocation): StationMetadata[] {
  const allStations = getAllStations();
  if (!location) return allStations;
  return allStations.filter(station => station.location === location);
}

/**
 * Get stations by network
 */
export function getStationsByNetwork(network: StationNetwork): StationMetadata[] {
  return getAllStations().filter(station => station.network === network);
}

/**
 * Find station by ID
 */
export function getStationById(id: string): StationMetadata | undefined {
  // Check UUID list first
  const uuidStation = STATION_LIST.find(station => station.id === id);
  if (uuidStation) return uuidStation;
  
  // Fallback to legacy registry
  return STATION_REGISTRY.find(station => station.id === id);
}

/**
 * Find station by name (fuzzy match)
 */
export function getStationByName(name: string): StationMetadata | undefined {
  const nameLower = name.toLowerCase().trim();
  
  // Check UUID list first
  const uuidStation = STATION_LIST.find(station => 
    station.name.toLowerCase() === nameLower ||
    station.name.toLowerCase().includes(nameLower) ||
    nameLower.includes(station.name.toLowerCase())
  );
  if (uuidStation) return uuidStation;
  
  // Fallback to legacy registry
  return STATION_REGISTRY.find(station => 
    station.name.toLowerCase() === nameLower ||
    station.name.toLowerCase().includes(nameLower) ||
    nameLower.includes(station.name.toLowerCase())
  );
}

/**
 * Find station by UUID
 */
export function getStationByUUID(uuid: string): StationMetadata | undefined {
  return STATION_LIST.find(station => station.uuid === uuid);
}

