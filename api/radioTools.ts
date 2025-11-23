// api/radioTools.ts

// Shared Gemini function calling tools + implementations for radio control.

export type ToolCall = { name: string; args?: any };
export type ToolResult = { name: string; args: any; result: any };

export type CommandType =
  | 'play'
  | 'pause'
  | 'stop'
  | 'next_station'
  | 'previous_station'
  | 'set_volume'
  | 'volume_up'
  | 'volume_down'
  | 'mute'
  | 'unmute'
  | 'whats_playing'
  | 'weather'
  | 'unknown';

export type Command = {
  type: CommandType;
  stationName?: string | null;
  stationId?: string | null;
  level?: number | null;
};

// --- Search helpers ---
type Station = {
  stationId?: string;
  stationName?: string;
  id?: string;
  name?: string;
  url?: string;
  tags?: string | string[];
  country?: string;
  countrycode?: string;
  language?: string;
  score?: number;
  reason?: string;
};

export type SearchStationsResult = {
  query: string;
  localMatches: Station[];
  radioBrowserMatches: Station[];
  matches: (Station & { score: number; reason: string })[];
  bestMatch: (Station & { score: number; reason: string }) | null;
  confidence: number; // 0..1
  reason: string; // top-level reason
};

// normalize text for fuzzy matching
const norm = (s: string) =>
  (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalize = (s: string) => (s || '').toLowerCase();

const SYNONYMS: Record<string, string[]> = {
  christmas: ['xmas', 'holiday', 'holidays', 'noel', 'festive'],
  lofi: ['lo-fi', 'chillhop', 'study beats'],
  relaxing: ['chill', 'calm', 'ambient'],
};

const expandQueryTerms = (q: string) => {
  const base = norm(q).split(' ').filter(Boolean);
  const expanded = new Set(base);
  for (const t of base) {
    if (SYNONYMS[t]) SYNONYMS[t].forEach((x) => expanded.add(norm(x)));
  }
  return [...expanded];
};

const scoreStation = (st: Station, terms: string[]) => {
  const name = norm(st.stationName || st.name || '');
  const tags = norm(
    Array.isArray(st.tags) ? st.tags.join(' ') : String(st.tags || '')
  );
  const country = norm(st.country || st.countrycode || '');

  let score = 0;
  const hits: string[] = [];

  for (const t of terms) {
    if (!t) continue;
    if (name.includes(t)) {
      score += 3;
      hits.push(`name:${t}`);
    }
    if (tags.includes(t)) {
      score += 2;
      hits.push(`tags:${t}`);
    }
    if (
      country === 'gb' ||
      country.includes('united kingdom') ||
      country.includes('uk')
    ) {
      score += 0.5;
      hits.push('country:gb');
    }
  }

  return { score, reason: hits.join(', ') || 'no direct term hits' };
};

// --- RadioBrowser search cache ---
const rbCache = new Map<
  string,
  { ts: number; data: Station[] }
>();
const RB_TTL_MS = 10 * 60 * 1000;

// --- Geocode cache ---
const geoCache = new Map<
  string,
  { ts: number; lat: number; lon: number; name: string; country?: string }
>();
const GEO_TTL_MS = 24 * 60 * 60 * 1000;

async function geocodeCity(city: string, origin: string) {
  const key = norm(city);
  const now = Date.now();
  const cached = geoCache.get(key);
  if (cached && now - cached.ts < GEO_TTL_MS) return cached;

  try {
    const url = `${origin}/api/geocode?name=${encodeURIComponent(city)}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const res = await r.json();

    const best = res?.results?.[0];
    if (!best) return null;

    const out = {
      ts: now,
      lat: best.latitude,
      lon: best.longitude,
      name: best.name,
      country: best.country_code,
    };
    geoCache.set(key, out);
    return out;
  } catch {
    return null;
  }
}

async function cachedRadioBrowserSearch(
  query: string,
  origin: string
): Promise<Station[]> {
  const key = norm(query);
  const now = Date.now();
  const cached = rbCache.get(key);
  if (cached && now - cached.ts < RB_TTL_MS) return cached.data;

  const url = `${origin}/api/radiobrowser?action=search&name=${encodeURIComponent(
    query
  )}&countrycode=GB&limit=5`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const data = await r.json();
  if (!Array.isArray(data)) return [];

  const stations: Station[] = data.map((s: any) => ({
    id: s.stationuuid || s.id || s.name,
    name: s.name,
    stationId: s.stationuuid || s.id,
    stationName: s.name,
    url: s.url_resolved || s.url,
    tags: s.tags ? String(s.tags).split(',') : [],
    country: s.country,
    countrycode: s.countrycode,
  }));

  rbCache.set(key, { ts: now, data: stations });
  return stations;
}

/** Function declarations (Gemini tools) */
export const RADIO_FUNCTION_DECLARATIONS: any[] = [
  // --- Controls ---
  {
    name: 'play_station',
    description:
      'Switch the radio to a specific station. Provide stationName if known, or stationId if selected from list/search.',
    parameters: {
      type: 'object',
      properties: {
        stationName: { type: 'string', description: 'Human readable station name.' },
        stationId: { type: 'string', description: 'Station UUID/id if available.' },
      },
    },
  },
  { name: 'pause', description: 'Pause radio playback.', parameters: { type: 'object', properties: {} } },
  { name: 'stop', description: 'Stop radio playback.', parameters: { type: 'object', properties: {} } },
  { name: 'next_station', description: 'Go to next station in app list.', parameters: { type: 'object', properties: {} } },
  { name: 'previous_station', description: 'Go to previous station in app list.', parameters: { type: 'object', properties: {} } },
  {
    name: 'set_volume',
    description: 'Set volume to an absolute level 0–100.',
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'integer', description: '0–100 volume percent.' },
      },
      required: ['level'],
    },
  },
  { name: 'volume_up', description: 'Increase volume by a small step.', parameters: { type: 'object', properties: {} } },
  { name: 'volume_down', description: 'Decrease volume by a small step.', parameters: { type: 'object', properties: {} } },
  { name: 'mute', description: 'Mute audio.', parameters: { type: 'object', properties: {} } },
  { name: 'unmute', description: 'Unmute audio.', parameters: { type: 'object', properties: {} } },

  // --- Augment knowledge ---
  {
    name: 'list_stations',
    description:
      'Augment knowledge: return a list of radios. Use for genre/mood queries like "rap", "dance", "relaxing", etc.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text to filter by name or tags.' },
        genre: { type: 'string', description: 'Genre like rap, rock, pop, jazz, classical.' },
        mood: { type: 'string', description: 'Mood like chill, energetic, workout.' },
        countrycode: { type: 'string', description: 'ISO country code. Default GB.' },
        limit: { type: 'integer', description: 'Max results. Default 10.' },
        includeNowPlaying: {
          type: 'boolean',
          description:
            'If true, also fetch now-playing for top results to improve genre match.',
        },
      },
    },
  },
  {
    name: 'search_stations',
    description:
      'Search stations by a user phrase (name/alias/partial). Falls back to RadioBrowser if not in local list.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'User phrase, e.g. "Capital Xtra" or "rap radio".' },
        genre: { type: 'string', description: 'Optional genre hint.' },
        countrycode: { type: 'string', description: 'ISO country code. Default GB.' },
        limit: { type: 'integer', description: 'Max results. Default 5.' },
      },
      required: ['query'],
    },
  },

  // --- Now playing ---
  {
    name: 'get_now_playing',
    description:
      'Get current track on a given station. Use for "what song is playing" or to verify genre.',
    parameters: {
      type: 'object',
      properties: {
        stationId: { type: 'string', description: 'Station UUID/id.' },
        stationName: { type: 'string', description: 'Optional station name.' },
      },
      required: ['stationId'],
    },
  },

  // --- Weather ---
  {
    name: 'get_weather',
    description: 'Get current weather. Prefer lat/lon if provided. If only city is provided, the tool will geocode it.',
    parameters: {
      type: 'object',
      properties: {
        lat: { type: 'number', description: 'Latitude.' },
        lon: { type: 'number', description: 'Longitude.' },
        city: { type: 'string', description: 'City name (will be geocoded if lat/lon not provided).' },
      },
    },
  },
];

export const TOOLS: any[] = [{ functionDeclarations: RADIO_FUNCTION_DECLARATIONS }];

/** System prompt generator */
export function getSystemInstruction(stationNames: string[] = []): string {
  return `
You are Jarvis, the AI assistant inside JamieRadio.

CRITICAL: This is Pass-1 (tool routing stage). You MUST NOT respond with natural language. Your ONLY valid output is calling tool(s). Do NOT greet, do NOT introduce yourself, do NOT ask questions. Only call tools.

You can control playback AND use tools.
Never guess stations if unsure — look them up with list_stations/search_stations.

Tool use rules:

1) Direct control:

   - "play X" / "switch to X" => play_station

   - "pause/stop/be quiet" => pause or stop

   - "next/previous station" => next_station / previous_station

   - "turn it up/down" => volume_up / volume_down

   - "set volume to 30%" => set_volume(level=30)

   - "mute" => mute, "unmute" => unmute

2) Genre/mood/era requests:

   - e.g. "play rap", "something chill", "dance music", "christmas music", "80s":

     STEP 1: Call list_stations or search_stations with the user phrase.

     STEP 2: If any matches are returned, pick the bestMatch and IMMEDIATELY call play_station(bestMatch.stationId or bestMatch.id).

     STEP 3: Only apologize if matches is empty or confidence is very low.

   - If the user says a specific station name, prefer search_stations with exact bias, then play_station on bestMatch.

   - Never stop after search/list if you have a clear bestMatch. Always chain to play_station.

   - If unsure, call list_stations/search_stations first, then play_station.

   Example:
   User: "play christmas music"
   Tools:
   - search_stations({query:"christmas music"})
   - play_station({stationId:"<bestMatch.stationId>"})

3) "What's playing on X?":

   - resolve station via search_stations or list_stations,

     THEN call get_now_playing.

4) Weather queries:

   - For "weather/temperature/forecast" intents, call get_weather({ city }) or {} if none.

   - "what's the weather like?", "weather", "temperature", "forecast", "what's the temperature?", etc.:

     Call get_weather. If user mentions a city name, pass { city: "<name>" }.
     If no city mentioned, call get_weather({}) and the tool will use default location or geocode from req.body.location.

   Examples:
   User: "what's the weather like?"
   Tool: get_weather({})

   User: "temperature in London"
   Tool: get_weather({ city: "London" })

   User: "what's the forecast?"
   Tool: get_weather({})

5) Parallel tool calls are encouraged when independent.

Stations hinted by app: ${stationNames.join(', ')}

Now interpret user intent and call the right tool(s). Remember: NO natural language responses, ONLY tool calls.

`.trim();
}

/** Helpers */
export function getOrigin(req: any): string {
  // Handle both Express and Vercel request formats
  const headers = req.headers || {};
  const proto = (headers['x-forwarded-proto'] as string) || 
                (req.protocol) || 
                'http';
  const host = headers.host || 
               (typeof req.get === 'function' ? req.get('host') : null) ||
               'localhost:3001';
  return `${proto}://${host}`;
}

async function fetchStations(origin: string): Promise<any[]> {
  try {
    const r = await fetch(`${origin}/api/stations`);
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function listStationsImpl(args: any, origin: string): Promise<any> {
  const {
    query,
    genre,
    mood,
    countrycode = 'GB',
    limit = 10,
    includeNowPlaying = false,
  } = args || {};

  let stations = await fetchStations(origin);

  stations = stations.filter((s) =>
    !countrycode ? true : normalize(s.countrycode) === normalize(countrycode)
  );

  const q = normalize(query);
  const g = normalize(genre);
  const m = normalize(mood);

  if (q) {
    stations = stations.filter(
      (s) =>
        normalize(s.name).includes(q) ||
        normalize(s.tags || '').includes(q)
    );
  }
  if (g) {
    stations = stations.filter((s) =>
      normalize(s.tags || '').includes(g) ||
      normalize(s.name).includes(g)
    );
  }
  if (m) {
    stations = stations.filter((s) =>
      normalize(s.tags || '').includes(m) ||
      normalize(s.name).includes(m)
    );
  }

  const trimmed = stations.slice(0, limit).map((s) => ({
    stationId: s.stationuuid || s.id,
    stationName: s.name,
    tags: s.tags || '',
    countrycode: s.countrycode || '',
    language: s.language || '',
    url: s.url_resolved || s.url || '',
  }));

  if (includeNowPlaying) {
    const top = trimmed.slice(0, Math.min(5, trimmed.length));
    const nowPlaying = await Promise.all(
      top.map((st) =>
        getNowPlayingImpl(
          { stationId: st.stationId, stationName: st.stationName },
          origin
        )
      )
    );

    return trimmed.map((st, i) => ({
      ...st,
      nowPlaying: nowPlaying[i] || null,
    }));
  }

  return trimmed;
}

async function searchStationsImpl(args: any, origin: string): Promise<any> {
  const query = args?.query || args?.phrase || '';
  if (!query) {
    return {
      query: '',
      localMatches: [],
      radioBrowserMatches: [],
      matches: [],
      bestMatch: null,
      confidence: 0,
      reason: 'no query provided',
    };
  }

  const terms = expandQueryTerms(query);

  // 1) Fetch local stations
  const localStationsRaw = await fetchStations(origin);
  const localStations: Station[] = localStationsRaw.map((s: any) => ({
    stationId: s.stationuuid || s.id,
    stationName: s.name,
    id: s.stationuuid || s.id,
    name: s.name,
    url: s.url_resolved || s.url,
    tags: s.tags || '',
    countrycode: s.countrycode || '',
    language: s.language || '',
  }));

  // Score and rank local matches
  const localMatches = localStations
    .map((st) => ({ st, ...scoreStation(st, terms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => ({
      ...x.st,
      score: x.score,
      reason: x.reason,
    }));

  // 2) RadioBrowser fallback (only if no good local matches)
  let radioBrowserMatches: (Station & { score: number; reason: string })[] = [];
  if (localMatches.length === 0 || localMatches[0].score < 3) {
    const rbStations = await cachedRadioBrowserSearch(query, origin);
    radioBrowserMatches = rbStations
      .map((st) => ({ st, ...scoreStation(st, terms) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => ({
        ...x.st,
        score: x.score,
        reason: x.reason,
      }));
  }

  // Merge and rank all matches
  const merged = [...localMatches, ...radioBrowserMatches].sort(
    (a, b) => b.score - a.score
  );

  // Pick best match
  const bestMatch = merged[0] || null;
  const confidence =
    !bestMatch
      ? 0
      : merged.length === 1
        ? 0.95
        : bestMatch.score >= (merged[1]?.score || 0) + 2
          ? 0.85
          : 0.6;

  const result: SearchStationsResult = {
    query,
    localMatches,
    radioBrowserMatches,
    matches: merged,
    bestMatch,
    confidence,
    reason: bestMatch
      ? `best=${bestMatch.stationName || bestMatch.name} score=${bestMatch.score} (${bestMatch.reason})`
      : 'no matches found',
  };

  return result;
}

async function getNowPlayingImpl(args: any, origin: string): Promise<any> {
  const { stationId, stationName } = args || {};
  if (!stationId) return { error: 'missing_stationId' };

  const url =
    `${origin}/api/metadata?stationId=${encodeURIComponent(stationId)}` +
    (stationName
      ? `&stationName=${encodeURIComponent(stationName)}`
      : '');

  try {
    const r = await fetch(url);
    if (!r.ok) return { error: 'metadata_fetch_failed' };
    return await r.json();
  } catch (e: any) {
    return { error: e?.message || 'metadata_fetch_failed' };
  }
}

async function getWeatherImpl(args: any, origin: string, req: any): Promise<any> {
  const bodyLoc = req.body?.location || {};
  let lat = args?.lat ?? bodyLoc.lat;
  let lon = args?.lon ?? bodyLoc.lon;
  const city = args?.city ?? bodyLoc.city ?? 'Unknown Location';

  // Geocode city if coordinates missing
  if ((lat == null || lon == null) && city && city !== 'Unknown Location') {
    const geo = await geocodeCity(city, origin);
    if (geo?.lat != null && geo?.lon != null) {
      lat = geo.lat;
      lon = geo.lon;
    }
  }

  if (lat == null || lon == null) return { error: 'missing_coordinates' };

  const url = `${origin}/api/weather?lat=${lat}&lon=${lon}&city=${encodeURIComponent(
    city
  )}`;

  try {
    const r = await fetch(url);
    if (!r.ok) return { error: 'weather_fetch_failed' };
    return await r.json();
  } catch (e: any) {
    return { error: e?.message || 'weather_fetch_failed' };
  }
}

/** "Virtual" control tools: frontend performs action */
const TOOL_IMPLS: Record<
  string,
  (args: any, origin: string, req?: any) => Promise<any>
> = {
  play_station: async (args) => ({ ok: true, ...args }),
  pause: async () => ({ ok: true }),
  stop: async () => ({ ok: true }),
  next_station: async () => ({ ok: true }),
  previous_station: async () => ({ ok: true }),
  set_volume: async (args) => ({ ok: true, level: args.level }),
  volume_up: async () => ({ ok: true }),
  volume_down: async () => ({ ok: true }),
  mute: async () => ({ ok: true }),
  unmute: async () => ({ ok: true }),

  list_stations: async (args, origin) => listStationsImpl(args, origin),
  search_stations: async (args, origin) => searchStationsImpl(args, origin),
  get_now_playing: async (args, origin) => getNowPlayingImpl(args, origin),
  get_weather: async (args, origin, req) => getWeatherImpl(args, origin, req),
};

/** Execute tool calls in parallel */
export async function executeToolCalls(
  calls: ToolCall[],
  origin: string,
  req: any
): Promise<ToolResult[]> {
  return Promise.all(
    (calls || []).map(async (c) => {
      const impl = TOOL_IMPLS[c.name];
      if (!impl) {
        return {
          name: c.name,
          args: c.args || {},
          result: { error: 'unknown_tool' },
        };
      }
      try {
        const result = await impl(c.args || {}, origin, req);
        return { name: c.name, args: c.args || {}, result };
      } catch (e: any) {
        return {
          name: c.name,
          args: c.args || {},
          result: { error: e?.message || 'tool_failed' },
        };
      }
    })
  );
}

/** Map tool calls -> command JSON for frontend */
export function deriveCommand(
  calls: ToolCall[],
  toolResults?: ToolResult[]
): Command {
  if (!calls?.length) return { type: 'unknown' };

  const priority = [
    'play_station',
    'pause',
    'stop',
    'next_station',
    'previous_station',
    'set_volume',
    'volume_up',
    'volume_down',
    'mute',
    'unmute',
    'get_now_playing',
    'get_weather',
  ];

  for (const p of priority) {
    const call = calls.find((c) => c.name === p);
    if (!call) continue;

    switch (p) {
      case 'play_station':
        return {
          type: 'play',
          stationName: call.args?.stationName ?? null,
          stationId: call.args?.stationId ?? null,
        };
      case 'pause':
        return { type: 'pause' };
      case 'stop':
        return { type: 'stop' };
      case 'next_station':
        return { type: 'next_station' };
      case 'previous_station':
        return { type: 'previous_station' };
      case 'set_volume':
        return { type: 'set_volume', level: call.args?.level ?? null };
      case 'volume_up':
        return { type: 'volume_up' };
      case 'volume_down':
        return { type: 'volume_down' };
      case 'mute':
        return { type: 'mute' };
      case 'unmute':
        return { type: 'unmute' };
      case 'get_now_playing':
        return {
          type: 'whats_playing',
          stationName: call.args?.stationName ?? null,
          stationId: call.args?.stationId ?? null,
        };
      case 'get_weather':
        return { type: 'weather' };
    }
  }

  // Fallback: if only search/list_stations was called, try to derive play command
  // Lowered threshold from 0.75 to 0.6 for better reliability
  const searchCall = calls.find(
    (c) => c.name === 'search_stations' || c.name === 'list_stations'
  );
  const playCall = calls.find((c) => c.name === 'play_station');
  if (!playCall && searchCall && toolResults) {
    const searchRes = toolResults.find(
      (r) => r.name === searchCall.name
    )?.result as SearchStationsResult | undefined;
    // Lower confidence threshold from 0.75 to 0.6 for better fallback reliability
    if (searchRes?.bestMatch && searchRes.confidence >= 0.6) {
      // Use console.log since logger might not be imported
      console.log('[deriveCommand] Fallback to play bestMatch (confidence >= 0.6)', {
        best: searchRes.bestMatch.stationName || searchRes.bestMatch.name,
        confidence: searchRes.confidence,
        stationId: searchRes.bestMatch.stationId || searchRes.bestMatch.id,
        reason: 'no play_station call, using bestMatch from search/list_stations',
      });
      return {
        type: 'play',
        stationName:
          searchRes.bestMatch.stationName || searchRes.bestMatch.name || null,
        stationId:
          searchRes.bestMatch.stationId || searchRes.bestMatch.id || null,
      };
    } else if (searchRes?.bestMatch) {
      console.log('[deriveCommand] Fallback skipped - confidence too low', {
        best: searchRes.bestMatch.stationName || searchRes.bestMatch.name,
        confidence: searchRes.confidence,
        threshold: 0.6,
      });
    }
  }

  return { type: 'unknown' };
}

