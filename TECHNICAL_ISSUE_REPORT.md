# Radio Stream Playback Issue - Technical Report

## Problem Summary

Radio stations are not playing in the browser. All stations are failing with `NotSupportedError: Failed to load because no supported source was found`. The application successfully discovers stream URLs, but playback fails due to multiple issues.

## Architecture Context

We have a React/TypeScript internet radio app with a dynamic discovery system:
- **StreamUrlManager**: Orchestrates multi-source URL discovery with caching
- **Network-based routing**: Routes stations by network (BBC, Bauer, Global, Other)
- **Discovery sources**: BBC streams, Planet Radio patterns, RadioBrowser API
- **No hardcoded URLs**: All URLs resolved at runtime

## Observed Issues

### 1. Planet Radio URLs Returning 404
```
GET http://stream-mz.planetradio.co.uk/absoluteradio80s.aac 404 (Not Found)
GET http://stream-mz.planetradio.co.uk/kisstory.aac 404 (Not Found)
GET http://stream-mz.planetradio.co.uk/planetrock.aac 500 (Internal Server Error)
```

**Root Cause**: The Planet Radio URL pattern `http://stream-mz.planetradio.co.uk/{discovery_id}.aac` appears to be incorrect or the station codes don't match actual endpoints. Many Bauer stations are falling back to Planet Radio URLs when RadioBrowser doesn't have them.

### 2. CORS Policy Blocking
```
Access to audio at 'http://stream-mz.planetradio.co.uk/planetrock.aac' from origin 'http://localhost:3000' 
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

**Root Cause**: Planet Radio streams don't have CORS headers, so browser blocks cross-origin audio requests. This is a fundamental limitation of browser-based audio playback.

### 3. RadioBrowser Fallback Not Working
The code attempts to use RadioBrowser first for Bauer stations, but appears to be falling back to Planet Radio URLs. This suggests:
- RadioBrowser search may be failing silently
- Search matching may not be finding stations
- The fallback logic is executing even when RadioBrowser should have results

## What We've Tried

### Attempted Fixes

1. **Changed Planet Radio URLs from HTTPS to HTTP**
   - Issue: SSL protocol errors
   - Result: Still getting 404s and CORS errors

2. **Removed strict verification**
   - Issue: Browser verification doesn't work due to CORS
   - Result: URLs are accepted but still fail at playback

3. **Added RadioBrowser fallback for Bauer stations**
   - Issue: Still falling back to Planet Radio when RadioBrowser should work
   - Result: Mixed - some stations work, many don't

4. **Removed `resolveStreamUrl` calls**
   - Issue: HEAD requests causing 400/500 errors
   - Result: Cleaner logs but playback still fails

5. **Improved search matching**
   - Issue: Stations not found due to name variations
   - Result: Better matching but still gaps

## Current Code Flow (Bauer Stations)

```typescript
case 'bauer': {
  try {
    const matching = await searchStationByName(stationName);
    if (matching && matching.url_resolved) {
      streamUrl = matching.url_resolved || matching.url;
      source = 'radio-browser';
    } else {
      // Falls back to Planet Radio (which fails)
      const planetUrl = `http://stream-mz.planetradio.co.uk/${metadata.discovery_id}.aac`;
      streamUrl = planetUrl;
      source = 'planet-radio';
    }
  } catch (error) {
    // Also falls back to Planet Radio on error
    const planetUrl = `http://stream-mz.planetradio.co.uk/${metadata.discovery_id}.aac`;
    streamUrl = planetUrl;
    source = 'planet-radio';
  }
}
```

## Core Problems

1. **Planet Radio URL pattern is incorrect or outdated**
   - The `{discovery_id}.aac` pattern doesn't match actual endpoints
   - Need to verify actual Planet Radio stream URL structure

2. **CORS blocking is fundamental**
   - Browser cannot play streams without CORS headers
   - Requires either:
     - Backend proxy server
     - Streams that support CORS
     - Alternative playback method

3. **RadioBrowser search may be failing**
   - Need to verify `searchStationByName()` is actually finding stations
   - May need to check if RadioBrowser has these stations at all
   - Search matching logic may need refinement

4. **No validation of discovered URLs**
   - URLs are cached and used without verification
   - Bad URLs propagate through the system

## Questions for Investigation

1. **What is the correct Planet Radio URL structure?**
   - Do these streams actually exist at `stream-mz.planetradio.co.uk`?
   - What is the actual endpoint pattern for Bauer stations?
   - Are there alternative Planet Radio domains/patterns?

2. **Why is RadioBrowser fallback not working?**
   - Is `searchStationByName()` actually being called?
   - Are stations found but `url_resolved` is empty?
   - Is the search query matching correctly?

3. **CORS Solution**
   - Do any of the discovered streams support CORS?
   - Should we implement a backend proxy?
   - Are there alternative stream sources that support CORS?

4. **URL Validation**
   - Should we validate URLs before caching?
   - How can we detect bad URLs without triggering CORS errors?
   - Should we implement a retry mechanism with alternative sources?

## Suggested Next Steps

1. **Debug RadioBrowser search**
   - Add logging to see if searches are finding results
   - Verify RadioBrowser actually has these stations
   - Check if `url_resolved` is populated

2. **Investigate Planet Radio**
   - Test actual Planet Radio URLs manually
   - Verify correct endpoint structure
   - Check if streams require authentication/headers

3. **CORS Solution**
   - Implement backend proxy for streams
   - Or find CORS-friendly stream sources
   - Consider using a service like `lstn.lv` (used for BBC) for other stations

4. **Add URL validation**
   - Implement pre-playback validation
   - Cache validation results
   - Fallback chain with multiple sources

5. **Error handling**
   - Better error messages for users
   - Retry logic with alternative sources
   - Graceful degradation when streams fail

## Technical Stack

- React 18 with TypeScript
- Vite build tool
- HTML5 Audio API (no hls.js currently)
- Dynamic stream discovery (no hardcoded URLs)
- In-memory caching (4-hour TTL)

## Environment

- Development: `http://localhost:3000`
- Browser: Chrome/Edge (based on errors)
- No backend proxy currently

---

**Status**: Critical - No stations are playing. Discovery works but playback fails due to 404s, CORS, and potentially incorrect URL patterns.

