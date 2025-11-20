# Metadata Feature - Current Status & Issues

## ✅ What's Working

### BBC Music Stations
The BBC RMS API is **fully functional** and returning metadata for music stations:

- **BBC Radio 1** ✅ - Returns track title, artist, artwork
- **BBC Radio 2** ✅ - Returns track title, artist, artwork  
- **BBC Radio 3** ✅ - Returns track title, artist, artwork
- **BBC Radio 1Xtra** ✅ - Returns track title, artist, artwork

**Example successful response:**
```json
{
  "station_id": "bbc_radio_one",
  "title": "This Ain't a Scene, It's an Arms Race",
  "artist": "Fall Out Boy",
  "artwork_url": "https://ichef.bbci.co.uk/images/ic/640x640/p01bqmkn.jpg",
  "is_song": true
}
```

**API Endpoint:** `https://rms.api.bbc.co.uk/v2/services/{stationId}/segments/latest?experience=domestic&limit=1`

**Status:** Working perfectly with proper User-Agent header and response parsing.

---

## ❌ What's Not Working

### 1. Global Radio WebSocket API

**Issue:** WebSocket connection opens and subscription message is sent, but **no messages are received** before timeout.

**Symptoms:**
- WebSocket opens successfully: `[Global] WebSocket opened for service 622`
- Subscription sent: `{"actions":[{"type":"subscribe","service":"622"}]}`
- **No messages received** - connection times out after 10 seconds
- WebSocket closes with code `1006` (abnormal closure)

**Affected Stations:**
- Capital XTRA (service ID: 622)
- Capital Dance (service ID: 1067)
- Heart London (service ID: 821)
- Heart Kent (service ID: 833)
- LBC (service ID: 1395)
- Gold (service ID: 1032)
- Radio X (service ID: 1054)
- Smooth London (service ID: 941)
- All other Global stations

**WebSocket Endpoint:** `wss://metadata.musicradio.com/v2/now-playing`

**Current Headers:**
```javascript
{
  'Origin': 'https://www.globalplayer.com',
  'User-Agent': 'Mozilla/5.0'
}
```

**Possible Causes:**
1. API requires authentication/token
2. Subscription message format is incorrect
3. Service IDs are wrong or outdated
4. API has changed and no longer uses WebSocket
5. Requires additional headers or handshake
6. Server is blocking connections without proper client identification

**Attempted Fixes:**
- ✅ Added Origin header
- ✅ Increased timeout from 5s to 10s
- ✅ Improved message parsing for multiple response structures
- ❌ Still not receiving any messages

**Next Steps:**
1. Research if Global has a REST API alternative
2. Check if authentication is required
3. Inspect network traffic from Global's official web player
4. Try different subscription message formats
5. Check if service IDs need to be different format (string vs number)

---

### 2. Bauer Planet Radio API

**Issue:** API returns HTTP 200 OK but with **empty array `[]`** in response body.

**Symptoms:**
```
[Bauer] Response status: 200
[Bauer] Response data: []
[Bauer] No station data found for code kiss
```

**Affected Stations:**
- KISS (code: `kiss`)
- KISSTORY (code: `kisstory`)
- Magic (code: `magic`)
- Absolute Radio (code: `absoluteradio`)
- All other Bauer stations

**API Endpoint:** `https://listenapi.planetradio.co.uk/api9.2/stations_nowplaying/UK?StationCode[]={code}&premium=1`

**Current Implementation:**
- Sends GET request with station code in query parameter
- Expects object with station data or array
- Currently returns empty array

**Possible Causes:**
1. Station codes are incorrect or outdated
2. API requires authentication/API key
3. API structure has changed
4. `premium=1` parameter might require subscription
5. Station codes need different format (case-sensitive, different naming)
6. API endpoint or version has changed

**Attempted Fixes:**
- ✅ Improved parsing to handle arrays, objects, nested structures
- ✅ Added multiple field name variations (title, track, track_title, etc.)
- ❌ Still receiving empty arrays

**Next Steps:**
1. Test with different station code formats
2. Check if API key is required
3. Try without `premium=1` parameter
4. Research correct station codes from Bauer's documentation
5. Check if API version `9.2` is still current
6. Inspect actual API responses from Bauer's official apps/website

---

### 3. BBC Speech/Talk Stations

**Issue:** Some BBC stations return empty data arrays (expected behavior for speech stations).

**Affected Stations:**
- BBC Radio 4 (`bbc_radio_fourfm`) - Returns `{"total":0,"data":[]}`
- BBC Radio 4 Extra (`bbc_radio_four_extra`) - Returns `{"total":0,"data":[]}`
- BBC Radio 5 Live (`bbc_radio_five_live`) - Returns `{"total":0,"data":[]}`
- BBC Radio 5 Live Sports Extra (`bbc_radio_five_live_sports_extra`) - Returns `{"total":0,"data":[]}`
- BBC Radio 6 Music (`bbc_6music`) - Returns `{"total":0,"data":[]}` (unexpected - should have music)

**Status:** This is **expected behavior** for speech/talk stations (Radio 4, 5 Live) as they don't have music segments. However, Radio 6 Music should have music segments but is also returning empty.

**Possible Causes for Radio 6 Music:**
1. Station ID might be incorrect (`bbc_6music` vs `bbc_radio_6music`)
2. API might not have current segment data
3. Station might be off-air or between segments

**Current Behavior:**
- Returns empty metadata gracefully
- UI shows "Live Radio" instead of track info
- No errors thrown

---

## 🔧 Technical Details

### API Server Setup
- **Local Dev Server:** `api-server.ts` running on port 3001
- **Vite Proxy:** Configured to forward `/api/*` to `http://localhost:3001`
- **Handler:** `api/metadata.ts` - Vercel serverless function format

### Response Format
All APIs return standardized format:
```typescript
{
  station_id: string;
  title: string;
  artist: string;
  artwork_url: string;
  is_song: boolean;
}
```

### Error Handling
- All errors return **200 OK** with empty data (prevents UI crashes)
- Logs are comprehensive for debugging
- Graceful fallbacks for all failure scenarios

---

## 📊 Success Rate

| Provider | Status | Success Rate |
|----------|--------|--------------|
| BBC Music Stations | ✅ Working | ~80% (4/5 music stations) |
| BBC Speech Stations | ⚠️ Expected Empty | N/A (talk shows) |
| Global Radio | ❌ Not Working | 0% (WebSocket timeout) |
| Bauer Radio | ❌ Not Working | 0% (Empty API responses) |

---

## 🎯 Priority Fixes

### High Priority
1. **Global WebSocket** - Critical for Capital, Heart, LBC stations
   - Research alternative REST API endpoints
   - Check if authentication required
   - Verify service IDs are correct

2. **Bauer API** - Critical for KISS, Magic, Absolute stations
   - Verify correct station codes
   - Check if API key required
   - Test different API versions

### Medium Priority
3. **BBC Radio 6 Music** - Should have metadata but returns empty
   - Verify station ID format
   - Check if different endpoint needed

### Low Priority
4. **BBC Speech Stations** - Expected to be empty, but could show show names
   - Consider parsing show names for talk stations
   - Display "Live Radio" or show name instead

---

## 🔍 Debugging Information

### Logs Location
All API calls are logged in the terminal running `npm run dev:api`:
- `[API Server]` - Server-level logs
- `[Handler]` - Request processing logs
- `[BBC]` - BBC API specific logs
- `[Global]` - Global WebSocket logs
- `[Bauer]` - Bauer API logs

### Test Commands
```bash
# Test BBC API directly
curl "https://rms.api.bbc.co.uk/v2/services/bbc_radio_one/segments/latest?experience=domestic&limit=1" \
  -H "User-Agent: Mozilla/5.0"

# Test Bauer API directly  
curl "https://listenapi.planetradio.co.uk/api9.2/stations_nowplaying/UK?StationCode[]=kiss&premium=1"

# Test via local API server
curl "http://localhost:3001/api/metadata?stationId=bbc_radio_one"
curl "http://localhost:3001/api/metadata?stationId=capital_xtra"
curl "http://localhost:3001/api/metadata?stationId=kiss"
```

---

## 💡 Potential Solutions

### For Global WebSocket
1. **Research REST API Alternative**
   - Check if Global has a REST endpoint for metadata
   - Look for public APIs or undocumented endpoints
   - Inspect network traffic from globalplayer.com

2. **WebSocket Authentication**
   - Check if token/auth required
   - Try connecting from browser and inspect headers
   - Look for authentication flow in Global's web player

3. **Different Message Format**
   - Try different subscription message structures
   - Check if service ID needs to be number vs string
   - Try multiple subscription attempts

### For Bauer API
1. **Verify Station Codes**
   - Check Bauer's official documentation
   - Test with different code formats (uppercase, lowercase, with/without suffix)
   - Try codes from their official apps

2. **API Authentication**
   - Check if API key required
   - Look for authentication headers
   - Test with/without `premium=1` parameter

3. **Alternative Endpoints**
   - Try different API versions
   - Check for different endpoint paths
   - Look for mobile app API endpoints

---

## 📝 Notes

- **BBC API is production-ready** - No changes needed
- **Global and Bauer need investigation** - May require reverse engineering or official API access
- **Error handling is robust** - UI won't crash on failures
- **Logging is comprehensive** - Easy to debug issues

---

## 🚀 Next Steps

1. **Immediate:** Document that BBC stations work, Global/Bauer need work
2. **Short-term:** Research Global and Bauer API alternatives
3. **Long-term:** Consider alternative metadata sources (RadioBrowser, Last.fm, etc.)

---

**Last Updated:** Based on logs from current testing session
**Status:** Partial success - BBC working, Global/Bauer need fixes

