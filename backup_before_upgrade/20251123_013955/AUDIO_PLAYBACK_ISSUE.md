# Audio Playback Issue - No Sound When Playing Station

## Problem
When clicking to play a station, no audio plays despite the audio pipeline being set up correctly.

## Context
This issue appeared after implementing volume ducking for TTS (text-to-speech) functionality. The changes involved:
1. Decoupling the audio pipeline setup from volume control
2. Making the ducking effect the single source of truth for volume
3. Removing `volume` and `isMuted` from the pipeline setup dependencies
4. Using `setTargetAtTime()` for smooth volume transitions

## Current State

### What's Working
- Gain node is created successfully: `[Player] Gain node created, initial volume: 1`
- Audio pipeline setup effect runs when audio element is available
- TTS state change callback is registered
- No errors in console

### What's Not Working
- **No audio plays when station is selected**
- The volume ducking effect shows "Gain node not ready yet, will retry..." initially, but then the gain node is created
- No "RESTORED volume" log appears after gain node creation (suggesting the ducking effect might not be running after the gain node is ready)

## Console Logs
```
[Player] Audio pipeline setup: audio element available, creating gain node
[Player] Gain node created, initial volume: 1
[App] Loaded 135 stations from API
```

**Notably missing:**
- No `[Player] RESTORED volume to: 1` log after gain node creation
- No indication that the volume ducking effect ran after the gain node became available

## Code Changes Made

### 1. Audio Pipeline Setup (`Player.tsx` ~line 150-250)
- Removed `volume` and `isMuted` from dependencies
- Removed the `else` block that was updating volume on every render
- Only sets initial volume when gain node is first created
- Sets `audio.volume = 1.0` when using Web Audio API

### 2. Volume Ducking Effect (`Player.tsx` ~line 277-320)
- Made this the single source of truth for volume control
- Uses `setTargetAtTime()` for smooth transitions
- Has retry logic if gain node isn't ready
- Dependencies: `[volume, isMuted, isTTSSpeaking, station]`

### 3. Disabled Old Volume Effect
- Commented out the old `audio.volume` effect that was conflicting with Web Audio API

## Potential Causes

### 1. Race Condition
The volume ducking effect might not be running after the gain node is created. The retry logic uses `setInterval` but might not catch the moment when the gain node becomes available.

### 2. Volume Not Being Set
The gain node is created with initial volume 1, but the ducking effect might not be applying the volume correctly, or it might be setting it to 0.

### 3. Audio Context State
The AudioContext might be in a suspended state and needs to be resumed.

### 4. Pipeline Connection Issue
The audio pipeline might not be connected correctly, or the gain node might not be connected to the destination.

### 5. setTargetAtTime Issue
Using `setTargetAtTime()` might be causing issues if the audio context time isn't synced properly, or if there's a scheduling conflict.

## Files Involved
- `src/components/Player.tsx` - Main player component with audio pipeline and volume ducking
- `src/services/voiceFeedback.ts` - TTS audio playback (working correctly)

## Expected Behavior
1. User clicks to play a station
2. Audio pipeline setup effect runs → creates gain node with volume 1
3. Volume ducking effect runs → sets gain node volume to 1 (or current volume)
4. Audio plays through the Web Audio API pipeline

## Actual Behavior
1. User clicks to play a station
2. Audio pipeline setup effect runs → creates gain node with volume 1
3. Volume ducking effect might not be running or might be setting volume incorrectly
4. **No audio plays**

## Debugging Steps Needed

1. **Check if volume ducking effect runs after gain node creation**
   - Add more logging to see if the effect runs
   - Check if the retry interval is catching the gain node creation

2. **Verify gain node volume value**
   - Log the actual gain node value after it's set
   - Check if it's being set to 0 or an unexpected value

3. **Check AudioContext state**
   - Verify the AudioContext is in "running" state
   - May need to call `audioContext.resume()` if suspended

4. **Verify pipeline connections**
   - Check that source → compressor/EQ → gain → destination is connected
   - Verify no disconnections are happening

5. **Test with direct volume assignment**
   - Temporarily use `gainNode.gain.value = volume` instead of `setTargetAtTime()` to rule out scheduling issues

6. **Check if audio element is actually playing**
   - Verify `audioRef.current.paused` is false
   - Check `audioRef.current.readyState`
   - Verify the audio source URL is set correctly

## Quick Fix to Try

In the volume ducking effect, after the gain node is created, immediately set the volume using direct assignment instead of `setTargetAtTime()`:

```typescript
// In applyDucking function, for the "else" case (normal volume):
if (currentValue === 0 || currentValue < 0.1 || !gainNode.gain.value) {
  // Coming from muted or very low, or initial setup - set immediately
  gainNode.gain.value = volume;
  console.log('[Player] RESTORED volume to:', volume, '(immediate)');
} else {
  // Smooth transition
  gainNode.gain.setTargetAtTime(volume, currentTime, 0.2);
  console.log('[Player] RESTORED volume to:', volume, '(smooth transition)');
}
```

Or, for initial setup, always use direct assignment:

```typescript
// Check if this is the first time (gain node was just created)
const isInitialSetup = gainNode.gain.value === 1 && volume === 1;
if (isInitialSetup) {
  gainNode.gain.value = volume; // Direct assignment for immediate effect
} else {
  gainNode.gain.setTargetAtTime(volume, currentTime, 0.2);
}
```

## Related Code Sections

### Audio Pipeline Setup Effect
```typescript
// Line ~150-250
useEffect(() => {
  // Creates gain node with initial volume
  if (!gainNodeRef.current) {
    gainNodeRef.current = audioContext.createGain();
    gainNodeRef.current.gain.value = isMuted ? 0 : volume;
    audio.volume = 1.0; // Set audio element volume to 1.0 for Web Audio API
  }
  // ... pipeline connections ...
}, [audioSettings.eqPreset, audioSettings.normalizationEnabled, station]);
```

### Volume Ducking Effect
```typescript
// Line ~277-320
useEffect(() => {
  const applyDucking = () => {
    // ... volume control logic ...
  };
  
  if (!gainNodeRef.current) {
    // Retry logic
  } else {
    applyDucking();
  }
}, [volume, isMuted, isTTSSpeaking, station]);
```

