# iRadio - Developer Guide

## Overview

This is an internet radio application built with React, TypeScript, Vite, Tailwind CSS, and Framer Motion. The app dynamically discovers and plays UK radio station streams without using hardcoded URLs.

## Architecture

### Core Components

1. **Player Component** (`src/components/Player.tsx`) - Main audio player
2. **Stream Discovery Services** - Dynamic URL resolution
3. **Station List/Card Components** - UI for browsing stations

---

## Player Component Architecture

### Location
`src/components/Player.tsx`

### How It Works

The Player component is a React functional component that manages audio playback using the HTML5 `<audio>` element. Here's how it works:

#### 1. **State Management**

```typescript
const audioRef = useRef<HTMLAudioElement>(null);  // Reference to <audio> element
const [volume, setVolume] = useState(1);          // Volume level (0-1)
const [error, setError] = useState<string | null>(null);  // Error messages
const [isLoading, setIsLoading] = useState(false); // Loading state
```

#### 2. **Audio Event Handlers**

The component sets up event listeners for the audio element to handle different playback states:

- **`error`** - Fired when stream fails to load
- **`loadstart`** - Fired when browser starts loading the stream
- **`canplay`** - Fired when enough data is loaded to start playing
- **`stalled`** - Fired when stream stalls (buffering issues)
- **`waiting`** - Fired when playback is waiting for more data
- **`playing`** - Fired when playback actually starts

These handlers update the UI state (`isLoading`, `error`) to provide user feedback.

#### 3. **Playback Control**

The main playback logic is in a `useEffect` hook that watches `isPlaying` and `station`:

```typescript
useEffect(() => {
  if (isPlaying && station) {
    const streamUrl = station.url_resolved || station.url;
    audio.src = streamUrl;
    audio.crossOrigin = 'anonymous'; // For CORS
    audio.play().catch((err) => {
      // Handle playback errors
    });
  } else {
    audio.pause();
  }
}, [isPlaying, station]);
```

**Key Points:**
- Sets the audio source from `station.url_resolved` or `station.url`
- Sets `crossOrigin = 'anonymous'` to handle CORS (though many stations still block this)
- Uses `.play()` which returns a Promise that can be rejected
- Automatically pauses when `isPlaying` becomes false

#### 4. **CORS Limitations**

**IMPORTANT:** Many radio stations block cross-origin requests (CORS policy). This means:
- The browser cannot directly play streams from many commercial stations
- You'll see CORS errors in the console for blocked stations
- Only stations that allow CORS (like BBC via lstn.lv) will work

**Solutions:**
- Use a backend proxy server to bypass CORS
- Focus on stations that allow CORS (BBC stations work well)
- Consider using a service like hls.js for better HLS stream handling

#### 5. **HLS Stream Support**

The player supports HLS streams (`.m3u8` files) natively in modern browsers:
- Safari: Full native support
- Chrome/Edge: Native support (may need hls.js for older versions)
- Firefox: Limited support (may need hls.js)

The code detects HLS by checking if the URL contains `.m3u8`:
```typescript
codec: resolvedUrl.includes('.m3u8') ? 'HLS' : ...
hls: resolvedUrl.includes('.m3u8') ? 1 : 0
```

#### 6. **Error Handling**

The player has comprehensive error handling:
- Catches playback errors and shows user-friendly messages
- Handles stream stalling and waiting states
- Displays loading indicators during buffering
- Automatically pauses on error

---

## Stream Discovery System

### Overview

The app uses a **multi-source dynamic discovery system** to find stream URLs. There are NO hardcoded URLs in the codebase.

### Services

#### 1. **StreamUrlManager** (`src/services/streamManager.ts`)

The main orchestrator that:
- Caches discovered URLs for 4 hours (URLs change frequently)
- Tries multiple sources in priority order
- Handles redirects and URL resolution

**Priority Order:**
1. BBC stations (via `BBCRadioStreamer`)
2. Planet Radio pattern matching (for Smooth, Magic, etc.)
3. RadioBrowser API (open-source database)
4. Returns null if nothing found

#### 2. **BBCRadioStreamer** (`src/services/bbcStreams.ts`)

Handles BBC radio stations:
- Uses `lstn.lv` proxy (primary) - CORS-friendly
- Falls back to direct Akamai CDN URLs
- Supports multiple bitrates (96kbps worldwide, 320kbps UK-only)

**Example:**
```typescript
BBCRadioStreamer.getLstnUrl('radio1', 96000, false)
// Returns: http://lsn.lv/bbcradio.m3u8?station=bbc_radio_one&bitrate=96000
```

#### 3. **RadioFeedsDiscovery** (`src/services/radioFeeds.ts`)

For commercial stations:
- Planet Radio URL pattern matching
- RadioFeeds query support (requires backend proxy due to CORS)

#### 4. **RadioBrowser Service** (`src/services/radioBrowser.ts`)

Uses the open-source RadioBrowser API:
- Free, no authentication required
- Limited UK station coverage
- Good for international stations

### Caching Strategy

- **Cache Duration:** 4 hours (stream URLs typically change every 4-6 hours)
- **Cache Key:** Station name (lowercase)
- **Cache Storage:** In-memory Map (cleared on page refresh)

---

## Data Flow

### Station Loading Flow

```
1. App.tsx calls getUKStations()
   ↓
2. ukStations.ts filters stations by location (London/Kent)
   ↓
3. For each station, calls streamUrlManager.getStreamUrl()
   ↓
4. StreamUrlManager checks cache first
   ↓
5. If not cached, tries discovery sources in priority order:
   - BBC streams (if BBC station)
   - Planet Radio patterns
   - RadioBrowser API
   ↓
6. Caches successful URL for 4 hours
   ↓
7. Returns RadioStation object with resolved URL
   ↓
8. StationList displays stations
   ↓
9. User clicks station → Player receives station object
   ↓
10. Player sets audio.src and calls audio.play()
```

### Playback Flow

```
1. User clicks play button
   ↓
2. App.tsx sets currentStation and isPlaying=true
   ↓
3. Player component receives props
   ↓
4. useEffect detects isPlaying change
   ↓
5. Sets audio.src = station.url_resolved
   ↓
6. Calls audio.play()
   ↓
7. Browser attempts to load stream
   ↓
8. Events fire: loadstart → canplay → playing
   ↓
9. If error: error event → shows error message → pauses
```

---

## Key Files

### Components
- `src/components/Player.tsx` - Audio player component
- `src/components/StationList.tsx` - Grid of station cards
- `src/components/StationCard.tsx` - Individual station card
- `src/App.tsx` - Main app component

### Services
- `src/services/ukStations.ts` - Station metadata and loading
- `src/services/streamManager.ts` - URL discovery and caching
- `src/services/bbcStreams.ts` - BBC stream URL generation
- `src/services/radioFeeds.ts` - Commercial station discovery
- `src/services/radioBrowser.ts` - RadioBrowser API client

### Types
- `src/types/station.ts` - RadioStation interface

---

## Common Issues & Solutions

### Issue: CORS Errors

**Symptom:** Console shows "Access to audio blocked by CORS policy"

**Cause:** Radio station doesn't allow cross-origin requests

**Solutions:**
1. Use a backend proxy server
2. Focus on CORS-friendly stations (BBC works well)
3. Use browser extensions (not recommended for production)

### Issue: Stream Not Playing

**Symptom:** No audio, no error message

**Possible Causes:**
- Stream URL is invalid or expired
- Browser doesn't support the codec
- Network issues

**Debug:**
- Check browser console for errors
- Verify URL in `station.url_resolved`
- Try URL directly in browser or VLC

### Issue: HLS Streams Not Working

**Symptom:** `.m3u8` streams fail to play

**Solutions:**
1. Install `hls.js` library for better compatibility
2. Check browser support (Safari has best native support)
3. Verify the HLS stream URL is accessible

---

## Adding New Stations

To add a new station:

1. Add station metadata to `UK_STATIONS` array in `ukStations.ts`:
```typescript
{
  name: 'Station Name',
  bitrate: 320,
  location: 'London', // or 'Kent'
  tags: 'genre,music',
}
```

2. The discovery system will automatically try to find a stream URL
3. If the station has a known pattern, add it to the appropriate service:
   - BBC stations: Add to `BBCRadioStreamer.stations`
   - Planet Radio: Add to `RadioFeedsDiscovery.planetRadioStations`

---

## Future Improvements

1. **Backend Proxy:** Add a Node.js/Express backend to bypass CORS
2. **hls.js Integration:** Better HLS stream support across browsers
3. **Stream Verification:** Pre-verify streams before showing in list
4. **Favorites System:** Allow users to save favorite stations
5. **Now Playing Info:** Display current track information (requires API)
6. **Better Error Recovery:** Auto-retry failed streams with alternative URLs

---

## Testing

### Manual Testing Checklist

- [ ] BBC stations play correctly
- [ ] Play/pause controls work
- [ ] Volume control works
- [ ] Error messages display for failed streams
- [ ] Loading states show during buffering
- [ ] Station list displays correctly
- [ ] Switching stations works smoothly

### Debug Tips

1. Open browser DevTools → Network tab → Filter by "Media"
2. Check which requests succeed/fail
3. Look for CORS errors in console
4. Verify stream URLs are valid by testing in VLC or browser directly

---

## Contact & Support

If you're taking over this project and have questions:
1. Check the code comments in each service file
2. Review the console logs (they're verbose for debugging)
3. Test with BBC stations first (most reliable)

---

**Last Updated:** November 2024
**Architecture:** Dynamic stream discovery with no hardcoded URLs

