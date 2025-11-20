# Metadata Feature Implementation Issues

## Overview
Implementing a "Now Playing" metadata feature that fetches track information (title, artist, artwork) from BBC, Global, and Bauer radio station APIs. The feature uses a Vercel serverless function proxy to avoid CORS issues.

## Current Status
- ✅ API server structure created (`api/metadata.ts`)
- ✅ React hook created (`src/hooks/useStationMetadata.ts`)
- ✅ Player component updated to display metadata
- ✅ Station ID mapping system implemented
- ❌ **Metadata not displaying in UI**
- ❌ **API returning null/empty responses**
- ❌ **Some stations returning 404 errors**

## Architecture

### Files Created/Modified
1. `api/metadata.ts` - Vercel serverless function (runs via `api-server.ts` in dev)
2. `api-server.ts` - Local development server wrapper
3. `src/hooks/useStationMetadata.ts` - SWR hook for fetching metadata
4. `src/components/Player.tsx` - Updated to display metadata
5. `src/types/station.ts` - Added `id` field to RadioStation
6. `src/services/ukStations.ts` - Updated to include station IDs
7. `src/config/stations.ts` - Fixed BBC station ID generation

### API Endpoints
- **BBC**: `https://rms.api.bbc.co.uk/v2/services/{stationId}/segments/latest`
- **Global**: WebSocket `wss://metadata.musicradio.com/v2/now-playing`
- **Bauer**: `https://listenapi.planetradio.co.uk/api9.2/stations_nowplaying/UK?StationCode[]={code}&premium=1`

## Issues Identified

### Issue 1: BBC API Returning Null Data
**Symptom**: BBC stations (e.g., `bbc_radio_one`) return `{title: null, artist: null, artwork_url: null, is_song: false}`

**Expected**: Should return track title and artist from BBC RMS API

**Debug Info**:
- Station ID format: `bbc_radio_one`, `bbc_radio_four_extra`, etc.
- API endpoint: `https://rms.api.bbc.co.uk/v2/services/{stationId}/segments/latest`
- Response structure unknown (need to inspect actual API response)

**Possible Causes**:
1. Incorrect API response parsing (structure may differ from expected)
2. Wrong station ID format for BBC API
3. API requires authentication/headers
4. API endpoint or structure has changed

**Next Steps**:
- Inspect actual BBC API response structure
- Test with curl/Postman to verify API works
- Check BBC API documentation for correct endpoint format
- Verify station IDs match BBC's service identifiers

### Issue 2: Unmapped Stations Returning 404
**Symptom**: Stations like `talkradio` return 404 errors

**Expected**: Should attempt inference or return empty metadata gracefully

**Current Behavior**:
- Direct mapped stations work (if in GLOBAL_MAP/BAUER_MAP)
- Unmapped stations return 404 (should return 200 with empty data)
- Inference system implemented but may not be working correctly

**Debug Info**:
- Station ID: `talkradio`
- Station Name: `talkRADIO`
- Provider inference should detect Global (has "talk" in name)
- Should try to infer Global service ID

**Possible Causes**:
1. Inference logic not matching station names correctly
2. Global WebSocket API not responding correctly
3. Station name not being passed correctly to API

**Next Steps**:
- Verify station name is being passed to API
- Test inference functions with actual station names
- Check Global WebSocket connection/response format
- Add more comprehensive logging

### Issue 3: API Server Not Running in Development
**Symptom**: 404 errors when accessing `/api/metadata`

**Solution Implemented**:
- Created `api-server.ts` to run API locally
- Added Vite proxy configuration
- Created npm scripts: `dev:api`, `dev:all`

**Current Setup**:
```json
"scripts": {
  "dev:api": "tsx api-server.ts",
  "dev:all": "concurrently \"npm run dev:api\" \"npm run dev\""
}
```

**Vite Proxy**:
```typescript
proxy: {
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
}
```

**Status**: Should work if both servers are running, but needs verification

## Code Structure

### API Handler (`api/metadata.ts`)
```typescript
// Three-tier strategy:
// 1. Direct mapping (GLOBAL_MAP, BAUER_MAP, BBC prefix)
// 2. Name-based inference (detect provider from station name)
// 3. Pattern matching (infer service IDs/codes from patterns)
```

**Key Functions**:
- `fetchBBCMetadata(stationId)` - Fetches from BBC RMS API
- `fetchGlobalMetadata(serviceId)` - WebSocket connection to Global
- `fetchBauerMetadata(stationCode)` - REST API call to Bauer
- `inferProvider(stationId, stationName)` - Detects provider from name
- `inferGlobalServiceId(stationName)` - Maps name to Global service ID
- `inferBauerCode(stationName)` - Maps name to Bauer code

### React Hook (`src/hooks/useStationMetadata.ts`)
```typescript
useStationMetadata(stationId, stationName)
// Returns: { data, loading, error }
// Polls every 30 seconds
```

### Player Component
- Displays metadata above station name
- Shows "Live Radio" when `is_song === false`
- Shows album artwork if available
- Blurred background effect for artwork

## Debugging Information

### Console Logs Added
- Station ID being used
- Station name
- Metadata received
- Loading state
- Errors

### Example Log Output
```
Player - Station ID: bbc_radio_one
Player - Station Name: BBC Radio 1
Player - Metadata: {title: null, artist: null, artwork_url: null, is_song: false}
Player - Metadata Loading: false
Player - Metadata Error: null
```

## Testing Checklist

### What Works
- ✅ API server starts and runs on port 3001
- ✅ Vite proxy configured
- ✅ Station IDs are being generated correctly
- ✅ Hook is calling API endpoint
- ✅ API is receiving requests

### What Doesn't Work
- ❌ BBC API returning null data
- ❌ Unmapped stations getting 404
- ❌ Metadata not displaying in UI (likely because API returns null)

## Next Steps for Advanced Developer

### Priority 1: Fix BBC API Integration
1. **Test BBC API directly**:
   ```bash
   curl "https://rms.api.bbc.co.uk/v2/services/bbc_radio_one/segments/latest"
   ```
2. **Inspect response structure** - May need to adjust parsing logic
3. **Verify station IDs** - Ensure IDs match BBC's service identifiers
4. **Check for required headers** - API may need User-Agent or other headers

### Priority 2: Fix Global WebSocket
1. **Test WebSocket connection** manually
2. **Verify message format** - Check if subscription message is correct
3. **Inspect response structure** - May need different parsing
4. **Add timeout/retry logic** - WebSocket may need multiple attempts

### Priority 3: Improve Inference System
1. **Add comprehensive logging** to inference functions
2. **Test with real station names** to verify pattern matching
3. **Expand mapping dictionaries** with more stations
4. **Add fallback to RadioBrowser API** if available

### Priority 4: Error Handling
1. **Ensure all errors return 200 with empty data** (not 404/500)
2. **Add retry logic** for transient failures
3. **Cache successful responses** to reduce API calls
4. **Add rate limiting** to prevent API abuse

## API Response Examples Needed

To fix the parsing, we need to see actual API responses:

### BBC API
```bash
# Test these endpoints:
curl "https://rms.api.bbc.co.uk/v2/services/bbc_radio_one/segments/latest"
curl "https://rms.api.bbc.co.uk/v2/services/bbc_radio_two/segments/latest"
curl "https://rms.api.bbc.co.uk/v2/services/bbc_6music/segments/latest"
```

### Global WebSocket
- Need to capture actual WebSocket messages
- Verify subscription message format
- Check response structure

### Bauer API
```bash
curl "https://listenapi.planetradio.co.uk/api9.2/stations_nowplaying/UK?StationCode[]=kiss&premium=1"
```

## Dependencies
- `swr` - Data fetching with polling
- `ws` - WebSocket support (for Global API)
- `tsx` - TypeScript execution (for api-server.ts)
- `concurrently` - Run multiple dev servers

## Environment Setup
```bash
# Install dependencies
npm install

# Run both API server and Vite dev server
npm run dev:all

# Or run separately:
# Terminal 1:
npm run dev:api

# Terminal 2:
npm run dev
```

## Files to Review
1. `api/metadata.ts` - Main API logic (391 lines)
2. `api-server.ts` - Local dev server wrapper
3. `src/hooks/useStationMetadata.ts` - React hook
4. `src/components/Player.tsx` - UI integration
5. `src/config/stations.ts` - Station ID generation

## Known Limitations
- BBC API response structure is unknown
- Global WebSocket may have connection issues
- Not all stations are mapped
- No caching implemented
- No rate limiting

## Questions to Answer
1. What is the actual structure of BBC RMS API responses?
2. Are the station IDs correct for BBC API?
3. Does Global WebSocket require authentication?
4. What is the correct message format for Global WebSocket subscription?
5. Are there alternative metadata sources we can use as fallback?

## Contact Information
- Original implementation: See git history
- Station registry: `src/config/stations.ts`
- API mappings: `api/metadata.ts` lines 14-30

