# Function Calling Implementation Issues

## Context

The iRadio application has been upgraded to use Gemini function calling for AI voice commands. The implementation uses a two-pass approach:
1. **Pass 1**: Gemini analyzes the audio/text with tools enabled, makes function calls
2. **Pass 2**: Tools execute in parallel, then Gemini generates friendly spoken text without tools

## What Has Been Implemented

### 1. Shared Tools Module (`api/radioTools.ts`)
- Created comprehensive tool declarations for Gemini
- Radio control tools: `play_station`, `pause`, `stop`, `next_station`, `previous_station`, `set_volume`, `volume_up`, `volume_down`, `mute`, `unmute`
- Knowledge augmentation tools: `list_stations`, `search_stations`, `get_now_playing`, `get_weather`
- Tool implementations that call existing API endpoints (`/api/stations`, `/api/metadata`, `/api/weather`, `/api/radiobrowser`)
- `executeToolCalls()` for parallel execution
- `deriveCommand()` to map tool calls to frontend command JSON

### 2. Updated API Endpoints
- **`api/ai-audio.ts`**: Two-pass function calling with SSE streaming (speak_text → command → [DONE])
- **`api/ai.ts`**: Two-pass function calling returning `{text, command}` JSON

### 3. Frontend Updates
- Extended `VoiceCommand` type to support new command types
- Updated `voiceControl.ts` to map new command types
- Updated `Player.tsx` switch statement with backward compatibility

### 4. Bug Fixes
- Fixed `getOrigin()` to handle both Express and Vercel request formats
- Updated `createVercelRequest()` to include headers for origin detection

## Current Issues

### Issue 1: Christmas Music Station Search Fails

**User Request**: "play a station playing christmas music"

**Observed Behavior**:
- Tool call: `search_stations({ query: 'Christmas music' })`
- Tool execution flow:
  1. Calls `/api/stations` (local list) - finds 135 stations
  2. Filters by query "Christmas music" - no matches in local list
  3. Falls back to `/api/radiobrowser?action=search&name=Christmas%20music&countrycode=GB&limit=5`
  4. RadioBrowser search completes
- Result: AI says "I couldn't find any radio stations playing Christmas music, sorry about that."
- Command: `{type: 'unknown'}`

**Problem**: 
- The tool is finding stations (RadioBrowser search completes), but either:
  - The results aren't being returned properly
  - The results aren't being used by Pass 2 to call `play_station`
  - The tool result format isn't clear enough for the AI to understand

**Logs Show**:
```
[AI Audio API] Tool calls: [ { name: 'search_stations', args: { query: 'Christmas music' } } ]
[API Server] GET /api/radiobrowser?action=search&name=Christmas%20music&countrycode=GB&limit=5
[AI Audio API] Emitted speak_text: "I couldn't find any radio stations playing Christmas music, sorry about that."
[AI Audio API] Emitted command: {"type":"unknown"}
```

### Issue 2: Weather Query Fails Without Coordinates

**User Request**: "what is the temperature" or "what is the weather"

**Observed Behavior**:
- Tool call: `get_weather({ city: 'London' })`
- Tool execution: Returns error `{ error: 'missing_coordinates' }`
- Result: AI says "Ah, I couldn't quite grab the weather for London without the specific coordinates. Do you h..."
- Command: `{type: 'weather'}` (correctly derived, but no actual weather data)

**Problem**:
- `get_weather` tool requires `lat` and `lon` parameters
- Tool description says coordinates are "provided by app (or user)" but the app doesn't provide them
- The tool tries to get coordinates from `req.body?.location` but this isn't being sent
- The AI is calling the tool with just `city` name, which isn't sufficient

**Tool Implementation**:
```typescript
async function getWeatherImpl(args: any, origin: string, req: any): Promise<any> {
  const bodyLoc = req.body?.location || {};
  const lat = args?.lat ?? bodyLoc.lat;
  const lon = args?.lon ?? bodyLoc.lon;
  const city = args?.city ?? bodyLoc.city ?? 'Unknown Location';

  if (lat == null || lon == null) return { error: 'missing_coordinates' };
  // ...
}
```

**Logs Show**:
```
[AI Audio API] Tool calls: [ { name: 'get_weather', args: { city: 'London' } } ]
[Timer] Tools executed
[AI Audio API] Emitted speak_text: "Ah, I couldn't quite grab the weather for London without the specific coordinates. Do you h..."
[AI Audio API] Emitted command: {"type":"weather"}
```

## Technical Context

### Tool Execution Flow
1. Pass 1: Gemini calls tools based on user intent
2. Tools execute in parallel via `executeToolCalls()`
3. Tool results are formatted as: `toolName(args) => result`
4. Pass 2: Gemini receives tool summary and generates spoken text
5. Command is derived from tool calls via `deriveCommand()`

### Current Tool Descriptions
- `search_stations`: "Search stations by a user phrase (name/alias/partial). Falls back to RadioBrowser if not in local list."
- `list_stations`: "Augment knowledge: return a list of radios. Use for genre/mood queries like 'rap', 'dance', 'relaxing', etc."
- `get_weather`: "Get current weather for coordinates provided by app (or user)."

### System Instruction
The system instruction tells the AI:
- "Never guess stations if unsure — look them up with list_stations/search_stations"
- For genre/mood: "call list_stations(genre/mood), optionally includeNowPlaying=true, or call get_now_playing on top candidates in parallel, THEN call play_station(best option)"

## Questions to Consider

1. **Why isn't the AI calling `play_station` after `search_stations` finds results?**
   - Is the tool result format unclear?
   - Does the AI need the results in a different format?
   - Should the tool automatically call `play_station` if only one result?

2. **How should weather coordinates be obtained?**
   - Should the frontend send user location in the request?
   - Should the tool use a geocoding service to convert city names to coordinates?
   - Should the tool description be updated to indicate coordinates are required?

3. **Are the tool descriptions clear enough?**
   - Does the AI understand when to use `list_stations` vs `search_stations`?
   - Are the parameter descriptions sufficient?
   - Should examples be added to tool descriptions?

4. **Is the tool result format optimal?**
   - Current format: `toolName(args) => result` as text
   - Should results be formatted differently for Pass 2?
   - Should successful tool results be highlighted vs errors?

## Files Involved

- `api/radioTools.ts` - Tool declarations and implementations
- `api/ai-audio.ts` - Two-pass function calling for audio input
- `api/ai.ts` - Two-pass function calling for text input
- `api/weather.ts` - Weather API endpoint (requires lat/lon)
- `api/radiobrowser.ts` - RadioBrowser search endpoint
- `api/stations.ts` - Local stations list endpoint

## Environment

- Development server: Express on port 3001
- Production: Vercel serverless functions
- AI Model: `gemini-2.5-flash-preview-09-2025` (audio), `gemini-2.5-flash` (text)
- Tool calling mode: `AUTO` in Pass 1, `NONE` in Pass 2

