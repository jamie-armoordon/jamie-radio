import { VercelRequest, VercelResponse } from '@vercel/node';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';

// --- CONFIGURATION & MAPPINGS ---

// 1. Bauer Station Codes (for Planet Radio Events API)
const BAUER_MAP: Record<string, string> = {
  'kiss_uk': 'kiss',
  'kisstory_uk': 'kisstory',
  'kisstory': 'kisstory',
  'magic_radio_uk': 'magic',
  'absolute_radio': 'absoluteradio',
  'absolute_radio_80s': 'absolute80s',
  'absolute_radio_90s': 'absolute90s',
  'absolute_radio_70s': 'absolute70s',
  'absolute_radio_60s': 'absolute60s',
  'planet_rock': 'planetrock',
  'greatest_hits_radio_uk': 'ghrlondon',
  'kerrang_radio': 'kerrang',
  'jazz_fm_uk': 'jazzfm',
  'scala_radio': 'scala',
  // Legacy aliases for backward compatibility
  'kiss_london': 'kiss',
  'kiss': 'kiss',
  'magic_london': 'magic',
  'magic': 'magic',
  'absolute_80s': 'absolute80s',
  'absolute_90s': 'absolute90s',
  'greatest_hits': 'ghrlondon',
  'kerrang': 'kerrang',
  'jazz_fm': 'jazzfm',
  'scala': 'scala'
};

// 2. RadioBrowser Configuration
const RADIOBROWSER_SERVERS = [
  'de1.api.radio-browser.info',
  'all.api.radio-browser.info'
];

const SEARCH_ALIASES: Record<string, string> = {
  'capital_xtra_reloaded': 'Capital XTRA Reloaded',
  'capital_xtra': 'Capital XTRA',
  'heart_00s': 'Heart 00s',
  'smooth_chill': 'Smooth Chill'
};

interface TrackInfo {
  station_id: string;
  title: string;
  artist: string;
  artwork_url: string;
  is_song: boolean;
}

// --- FETCH HELPERS ---

/**
 * Resolve stream URL from RadioBrowser API
 * Queries RadioBrowser to find the live url_resolved for a given station
 */
async function resolveStreamUrl(searchTerm: string, stationId?: string): Promise<string | null> {
  const searchTerms: string[] = [];
  if (stationId && SEARCH_ALIASES[stationId]) searchTerms.push(SEARCH_ALIASES[stationId]);
  if (!searchTerms.includes(searchTerm)) searchTerms.push(searchTerm);

  for (const term of searchTerms) {
    for (const server of RADIOBROWSER_SERVERS) {
      try {
        const url = `https://${server}/json/stations/search?name=${encodeURIComponent(term)}&limit=1&order=clickcount&reverse=true&hidebroken=true`;
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!response.ok) continue;
        
        const stations: any[] = await response.json();
        if (!stations.length) continue;

        const station = stations[0];
        const streamUrl = station.url_resolved || station.url;
        
        if (streamUrl) {
          console.log(`[StreamResolver] Found URL for ${term}: ${streamUrl}`);
          return streamUrl;
        }
      } catch (e) {
        continue;
      }
    }
  }
  
  return null;
}

/**
 * 1. BBC Strategy: RMS API (Working)
 */
async function fetchBBCMetadata(stationId: string): Promise<Partial<TrackInfo>> {
  const url = `https://rms.api.bbc.co.uk/v2/services/${stationId}/segments/latest?experience=domestic&limit=1`;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(response.statusText);
    const data: any = await response.json();
    const segment = data?.data?.[0];
    if (!segment) return {};

    const isMusic = segment.segment_type === 'music';
    let title = isMusic ? (segment.titles?.secondary || '') : (segment.titles?.primary || 'On Air');
    let artist = isMusic ? (segment.titles?.primary || '') : '';
    
    // Fix for 6 Music DJ shows
    if (stationId.includes('6music') && !isMusic && segment.titles?.secondary) {
        artist = segment.titles.primary || ''; 
        title = segment.titles.secondary;
    }

    return {
      title,
      artist,
      artwork_url: segment.image_url ? segment.image_url.replace('{recipe}', '640x640') : '',
      is_song: isMusic
    };
  } catch (error) {
    console.error(`[BBC] Error:`, error);
    return {};
  }
}

/**
 * 2. Bauer Strategy: Planet Radio HTTP (Bypasses SSL errors)
 */
async function fetchBauerMetadata(stationCode: string): Promise<Partial<TrackInfo>> {
  const url = `http://listenapi.planetradio.co.uk/api9.2/events/now/${stationCode}`;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    if (!response.ok) {
      console.log(`[Bauer] API returned ${response.status} for ${stationCode}, falling back to other strategies`);
      return {};
    }
    const data: any = await response.json();
    const event = Array.isArray(data) ? data[0] : data;
    if (!event) return {};

    if (event.nowPlaying) {
      return {
        title: event.nowPlaying.title || '',
        artist: event.nowPlaying.artist || '',
        artwork_url: event.nowPlaying.artwork || event.imageUrl || '',
        is_song: true
      };
    }
    return {
      title: event.name || '',
      artist: '',
      artwork_url: event.imageUrl || '',
      is_song: false
    };
  } catch (error) {
    console.error(`[Bauer] Error:`, error);
    return {};
  }
}

/**
 * 3. Global Strategy: ICY Metadata Extraction
 * Uses strict byte-counting state machine to discard audio bytes and only read metadata.
 * This prevents buffer overflow by never accumulating audio data - only metadata bytes are buffered.
 * Uses native Node.js http/https modules to ensure Icy-MetaData header is properly sent.
 * Handles redirects (301, 302, 307) recursively while preserving Icy-MetaData header.
 */
async function fetchIcyMetadata(streamUrl: string, maxRedirects: number = 5): Promise<Partial<TrackInfo>> {
  if (maxRedirects <= 0) {
    console.warn('[ICY] Max redirects reached');
    return {};
  }

  console.log(`[ICY] Connecting to: ${streamUrl} (${maxRedirects} redirects remaining)`);
  
  return new Promise((resolve) => {
    // Parse URL to determine protocol
    const url = new URL(streamUrl);
    const isHttps = url.protocol === 'https:';
    const get = isHttps ? httpsGet : httpGet;
    const defaultPort = isHttps ? 443 : 80;
    const path = url.pathname + (url.search || '');
    
    // Timeout: 4 seconds to kill connections that hang
    let timeout: NodeJS.Timeout;
    let req: ReturnType<typeof get>;

    timeout = setTimeout(() => {
      if (req) req.destroy();
      resolve({});
    }, 4000);

    req = get({
      hostname: url.hostname,
      port: url.port || defaultPort,
      path: path,
      headers: {
        'Icy-MetaData': '1',
        'User-Agent': 'VLC/3.0.0' // Pretend to be a media player
      }
    }, (res) => {
      clearTimeout(timeout);

      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        const location = res.headers.location;
        if (location) {
          // Handle both string and string[] location headers
          const locationStr = Array.isArray(location) ? location[0] : location;
          
          // Resolve relative URLs
          const redirectUrl = locationStr.startsWith('http') 
            ? locationStr 
            : `${url.protocol}//${url.host}${locationStr.startsWith('/') ? locationStr : '/' + locationStr}`;
          
          console.log(`[ICY] Redirect ${res.statusCode} to: ${redirectUrl}`);
          res.destroy();
          if (req) req.destroy();
          
          // Recursively follow redirect
          fetchIcyMetadata(redirectUrl, maxRedirects - 1).then(resolve);
          return;
        }
      }

      // Only process 200 OK responses
      if (res.statusCode !== 200) {
        console.warn(`[ICY] Unexpected status code: ${res.statusCode}`);
        res.destroy();
        resolve({});
        return;
      }

      // Check for icy-metaint header to verify metadata support
      const metaIntHeader = res.headers['icy-metaint'];
      console.log(`[ICY] Connected. Meta-Int: ${metaIntHeader || 'not present'}`);
      
      if (!metaIntHeader) {
        console.warn('[ICY] No icy-metaint header. Server ignoring metadata request?');
        res.destroy();
        resolve({});
        return;
      }

      // Parse metaInt as integer
      const metaint = Number.parseInt(metaIntHeader as string, 10);
      if (Number.isNaN(metaint) || metaint <= 0) {
        console.warn(`[ICY] Invalid metaInt value: ${metaIntHeader}`);
        res.destroy();
        resolve({});
        return;
      }

      // State Machine Variables
      let byteCounter = 0;        // Count audio bytes (discarded)
      let isMetadata = false;     // false = audio mode, true = metadata mode
      let metaLength = 0;          // 0 = waiting for length byte, >0 = reading payload
      let metaBuffer: number[] = []; // Only buffer metadata bytes (max 4080 bytes)

      // Helper function to parse metadata and resolve
      const parseAndResolve = (metadataStr: string) => {
        // Look for StreamTitle='...'
        const match = metadataStr.match(/StreamTitle='([^']*)'/);
        
        if (match && match[1]) {
          const rawTitle = match[1];
          console.log(`[ICY] Found Title: ${rawTitle}`);
          
          // Clean up title: Remove [Clean], (Radio Edit), etc. for better search results
          const cleanTitle = (text: string): string => {
            return text
              .replace(/\s*\[Clean\]\s*/gi, '')
              .replace(/\s*\(Radio Edit\)\s*/gi, '')
              .replace(/\s*\(Explicit\)\s*/gi, '')
              .replace(/\s*\[Explicit\]\s*/gi, '')
              .trim();
          };
          
          // Parse Artist - Title format
          const parts = rawTitle.split(' - ');
          if (parts.length >= 2) {
            const artist = parts[0].trim();
            const title = cleanTitle(parts.slice(1).join(' - ').trim()); // Handle titles with dashes
            
            res.destroy();
            if (req) req.destroy();
            clearTimeout(timeout);
            resolve({
              artist,
              title,
              is_song: true,
              artwork_url: '' // ICY doesn't provide artwork, will be fetched via iTunes API
            });
            return true;
          } else {
            // Probably a DJ name or show title
            res.destroy();
            if (req) req.destroy();
            clearTimeout(timeout);
            resolve({
              title: cleanTitle(rawTitle.trim()),
              artist: '',
              is_song: false,
              artwork_url: ''
            });
            return true;
          }
        }
        return false;
      };

      res.on('data', (chunk: Buffer) => {
        // Iterate through chunk byte by byte
        for (let i = 0; i < chunk.length; i++) {
          const byte = chunk[i];

          if (!isMetadata) {
            // Audio Mode: Count bytes and discard
            byteCounter++;
            
            // When we reach metaint, switch to metadata mode
            if (byteCounter === metaint) {
              byteCounter = 0;      // Reset for next audio cycle
              isMetadata = true;    // Switch to metadata mode
              metaLength = 0;       // Waiting for length byte
            }
            // Audio bytes are discarded - we don't buffer them
          } else {
            // Metadata Mode
            if (metaLength === 0) {
              // Phase A: Reading the length byte
              const realLength = byte * 16;
              
              if (realLength === 0) {
                // No metadata, switch back to audio mode immediately
                isMetadata = false;
                byteCounter = 0;
              } else {
                // Sanity check: metadata should never exceed 4080 bytes (255 * 16)
                if (realLength > 4080) {
                  console.warn(`[ICY] Metadata length exceeds max (${realLength} > 4080), aborting`);
                  res.destroy();
                  if (req) req.destroy();
                  clearTimeout(timeout);
                  resolve({});
                  return;
                }
                
                metaLength = realLength;
                metaBuffer = []; // Initialize metadata buffer
              }
            } else {
              // Phase B: Reading metadata payload
              metaBuffer.push(byte);
              
              // When we've read all metadata bytes, parse and resolve
              if (metaBuffer.length === metaLength) {
                // Convert buffer to UTF-8 string
                const metadataStr = Buffer.from(metaBuffer).toString('utf-8');
                
                // Try to parse and resolve
                if (parseAndResolve(metadataStr)) {
                  return; // Successfully resolved, exit
                }
                
                // Not found or empty, reset and continue with audio
                isMetadata = false;
                byteCounter = 0;
                metaLength = 0;
                metaBuffer = [];
              }
            }
          }
        }
      });

      res.on('end', () => {
        clearTimeout(timeout);
        resolve({});
      });

      res.on('error', (error) => {
        clearTimeout(timeout);
        console.error(`[ICY] Response error:`, error);
        resolve({});
      });
    });

    req.on('error', (error) => {
      clearTimeout(timeout);
      console.error(`[ICY] Request error:`, error);
      resolve({});
    });
  });
}

/**
 * 4. Artwork Resolution: iTunes Search API
 * Fetches artwork URL from iTunes Search API (public, no auth required)
 */
async function fetchItunesArtwork(artist: string, title: string): Promise<string> {
  try {
    // Sanitize query: Remove "feat.", "ft.", "&" and clean up extra spaces
    const sanitizeQuery = (text: string): string => {
      return text
        .replace(/\s*feat\.?\s*/gi, ' ')
        .replace(/\s*ft\.?\s*/gi, ' ')
        .replace(/\s*&\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const query = `${sanitizeQuery(artist)} ${sanitizeQuery(title)}`;
    const encodedQuery = encodeURIComponent(query);
    const url = `https://itunes.apple.com/search?term=${encodedQuery}&media=music&entity=song&limit=1`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    if (!response.ok) return '';

    const data: any = await response.json();
    
    if (data.results && data.results.length > 0) {
      const artworkUrl = data.results[0].artworkUrl100;
      if (artworkUrl) {
        // High-Res Hack: Replace '100x100bb' with '600x600bb' to get HD version
        const hdArtworkUrl = artworkUrl.replace('100x100bb', '600x600bb');
        console.log(`[Artwork] Found artwork for ${artist} - ${title}`);
        return hdArtworkUrl;
      }
    }

    return '';
  } catch (error) {
    console.error(`[Artwork] Error fetching artwork:`, error);
    return '';
  }
}

/**
 * 5. Fallback: RadioBrowser Metadata (from playing field)
 */
async function fetchRadioBrowserMetadata(searchTerm: string, stationId?: string): Promise<Partial<TrackInfo>> {
  const searchTerms: string[] = [];
  if (stationId && SEARCH_ALIASES[stationId]) searchTerms.push(SEARCH_ALIASES[stationId]);
  if (!searchTerms.includes(searchTerm)) searchTerms.push(searchTerm);

  for (const term of searchTerms) {
    for (const server of RADIOBROWSER_SERVERS) {
      try {
        const url = `https://${server}/json/stations/search?name=${encodeURIComponent(term)}&limit=1&order=clickcount&reverse=true&hidebroken=true`;
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!response.ok) continue;
        
        const stations: any[] = await response.json();
        if (!stations.length) continue;

        const station = stations[0];
        const playing = station.playing || '';
        
        if (!playing) return { title: station.name, is_song: false };

        const parts = playing.split(' - ');
        if (parts.length >= 2) {
            return {
                artist: parts[0].trim(),
                title: parts.slice(1).join(' - ').trim(),
                is_song: true,
                artwork_url: station.favicon || ''
            };
        }
        return { title: playing, is_song: !!playing, artwork_url: station.favicon || '' };
      } catch (e) { continue; }
    }
  }
  return {};
}

// --- MAIN HANDLER ---

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const stationId = (req.query?.stationId as string) || '';
  const stationName = (req.query?.stationName as string) || '';

  const result: TrackInfo = {
    station_id: stationId,
    title: '',
    artist: '',
    artwork_url: '',
    is_song: false
  };

  if (!stationId) return res.status(200).json(result);

  try {
    console.log('[Handler] Strategy Lookup:', { 
      stationId, 
      stationName,
      isBauer: !!BAUER_MAP[stationId], 
      isBBC: stationId.startsWith('bbc_') 
    });
    
    let fetchedData: Partial<TrackInfo> = {};

    // Strategy Selection
    if (stationId.startsWith('bbc_')) {
        fetchedData = await fetchBBCMetadata(stationId);
    } else if (BAUER_MAP[stationId]) {
        fetchedData = await fetchBauerMetadata(BAUER_MAP[stationId]);
    } else {
        // Global / Others: Try ICY metadata via RadioBrowser stream URL
        const searchTerm = stationName || stationId;
        const streamUrl = await resolveStreamUrl(searchTerm, stationId);
        
        if (streamUrl) {
          fetchedData = await fetchIcyMetadata(streamUrl);
        }
    }

    // Fallback: RadioBrowser metadata (from playing field)
    if (!fetchedData.title && !fetchedData.artist) {
        const fallback = await fetchRadioBrowserMetadata(stationName || stationId, stationId);
        if (fallback.title || fallback.artist) fetchedData = fallback;
    }

    // If we have title/artist but missing artwork_url, fetch from iTunes
    if ((fetchedData.title || fetchedData.artist) && !fetchedData.artwork_url && fetchedData.artist && fetchedData.title) {
      fetchedData.artwork_url = await fetchItunesArtwork(fetchedData.artist, fetchedData.title);
    }

    return res.status(200).json({ ...result, ...fetchedData });
  } catch (error) {
    console.error(`[Handler] Error:`, error);
    return res.status(200).json(result);
  }
}