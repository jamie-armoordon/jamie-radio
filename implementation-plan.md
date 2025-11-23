# Implementation Plan: Wake Word Audio Capture

Based on Perplexity research, here's a practical implementation plan that fits our current architecture.

## Current State Analysis

**What We Have:**
- ✅ Wake word detector via WebSocket (ScriptProcessorNode → server)
- ✅ MediaRecorder for command capture (WebM/Opus)
- ✅ Server-side VAD pipeline (WebM → PCM16 → VAD → WAV → Gemini)
- ✅ Ring buffer infrastructure (Float32Array, ~1s) - not yet used

**What's Missing:**
- ❌ Wake word audio in transcript (spoken before MediaRecorder starts)
- ❌ AudioWorklet (still using deprecated ScriptProcessorNode)

## Recommended Approach: Hybrid Solution

**Why not full server-side streaming?**
- Major architectural change (would require rewriting wake word detector + command capture)
- Current pipeline works well for command transcription
- Wake word in transcript is nice-to-have, not critical

**Better approach: Enhance current system with minimal changes**

### Option 1: Server-Side Wake Word Context (EASIEST - Recommended)

**Implementation:**
1. When wake word detected, server sends timestamp back to client
2. Client includes "wake word detected at Xms" in API request
3. Server includes this context in Gemini transcription prompt

**Pros:**
- Minimal code changes
- No audio format conversion needed
- Works with current architecture
- Low latency (no additional processing)

**Cons:**
- Wake word might not be in actual audio (if spoken before recording)
- Relies on Gemini to infer wake word from context

**Code Changes:**
```typescript
// In api/ai-audio.ts - add wake word context to transcription prompt
const wakeWordContext = req.body.wakeWordDetectedAt 
  ? "This audio contains a voice command. The user said 'hey jarvis' at the beginning. Include 'hey jarvis' in the transcript if you hear it."
  : "";

const transcribePrompt = `${wakeWordContext} Transcribe this audio. Output only the transcribed text...`;
```

### Option 2: Use Wake Word Detector's Stream for Command (MODERATE)

**Implementation:**
1. When wake word detected, get buffered audio from wake word detector
2. Continue using wake word detector's stream for command capture
3. Send both buffered + live audio to server
4. Server processes as single continuous stream

**Pros:**
- Captures actual wake word audio
- Reuses existing WebSocket infrastructure
- No MediaRecorder needed for commands

**Cons:**
- Requires server-side changes to handle continuous stream
- Need to merge wake word buffer with command audio
- More complex state management

**Code Changes:**
- Modify `useWakeWordDetector` to expose buffered audio
- Modify `voiceControl.startCommandRecording` to use wake word stream
- Server needs to handle "wake word buffer + command stream" as one audio

### Option 3: Migrate to AudioWorklet (FUTURE - Not Urgent)

**Implementation:**
1. Replace ScriptProcessorNode with AudioWorklet
2. Implement continuous ring buffer in AudioWorklet
3. When wake word detected, flush buffer + continue recording
4. Send full audio (buffer + live) to server

**Pros:**
- Modern API (ScriptProcessorNode is deprecated)
- Better performance
- More control over audio processing

**Cons:**
- Significant refactoring
- AudioWorklet requires separate file (public/audio-worklet.js)
- More complex error handling
- Not urgent (ScriptProcessorNode still works)

**When to do this:**
- If browser deprecation warnings appear
- If performance issues arise
- If we need more advanced audio processing

## Immediate Action Plan

### Phase 1: Quick Win (30 minutes)
**Implement Option 1: Server-side wake word context**

1. Modify `Player.tsx` to pass wake word detection timestamp:
```typescript
// In onDetection callback
const wakeWordDetectedAt = Date.now();
voiceControl.startCommandRecording(sharedStream, wakeWordDetectedAt);
```

2. Modify `voiceControl.ts` to include timestamp in API request:
```typescript
body: JSON.stringify({
  audio: base64Audio,
  mimeType: this.mediaRecorder?.mimeType || 'audio/webm',
  stations: this.stationList,
  location: location,
  wakeWordDetectedAt: wakeWordDetectedAt, // NEW
}),
```

3. Modify `api/ai-audio.ts` to use context in transcription:
```typescript
const wakeWordContext = req.body.wakeWordDetectedAt 
  ? "This audio contains a voice command preceded by 'hey jarvis'. Include 'hey jarvis' in the transcript if you hear it at the beginning."
  : "";

const transcribePrompt = `${wakeWordContext} Transcribe this audio. Output only the transcribed text, nothing else...`;
```

**Expected Result:**
- Gemini will include "hey jarvis" in transcript when it's actually in the audio
- If wake word is missing from audio, Gemini might still infer it from context
- Zero latency impact, minimal code changes

### Phase 2: Enhanced Capture (2-3 hours)
**Implement Option 2: Use wake word stream for commands**

1. Modify `useWakeWordDetector` to:
   - Return buffered audio chunks when wake word detected
   - Continue streaming after detection (don't pause)
   - Add method: `getBufferedAudioSince(timestamp)`

2. Modify `voiceControl.startCommandRecording` to:
   - Get buffered audio from wake word detector
   - Continue using wake word detector's stream (not MediaRecorder)
   - Send buffered + live audio to server as single stream

3. Modify server to:
   - Accept continuous audio stream (not just WebM blob)
   - Process wake word buffer + command as one audio file
   - Run VAD on full stream

**Expected Result:**
- Actual wake word audio captured in transcript
- Slightly lower latency (no MediaRecorder encoding)
- More complex but more accurate

### Phase 3: Future Migration (When Needed)
**Migrate to AudioWorklet**

- Only if ScriptProcessorNode shows deprecation warnings
- Or if we need advanced audio processing features
- Follow Perplexity research guide for AudioWorklet implementation

## Decision Matrix

| Approach | Complexity | Accuracy | Latency | Code Changes |
|----------|-----------|----------|---------|--------------|
| **Option 1: Context** | ⭐ Low | ⭐⭐ Medium | ✅ No impact | ~50 lines |
| **Option 2: Stream** | ⭐⭐⭐ High | ✅✅ High | ✅ Slightly better | ~300 lines |
| **Option 3: AudioWorklet** | ⭐⭐⭐⭐ Very High | ✅✅ High | ✅ Better | ~500+ lines |

## Recommendation

**Start with Option 1** (server-side context). It's the quickest win with minimal risk.

**Consider Option 2** if:
- Option 1 doesn't produce good results
- You need actual wake word audio (not just context)
- You have time for the refactor

**Defer Option 3** until:
- Browser deprecation warnings appear
- Performance issues arise
- You need advanced audio features

## Testing Checklist

After implementing Option 1:
- [ ] Test with wake word at start of recording
- [ ] Test with wake word before recording starts
- [ ] Verify transcript includes "hey jarvis" when present
- [ ] Check latency impact (should be zero)
- [ ] Test with various accents/background noise

After implementing Option 2:
- [ ] Test buffered audio capture
- [ ] Verify wake word in transcript
- [ ] Check stream continuity (no gaps)
- [ ] Measure latency improvement
- [ ] Test error handling (connection drops, etc.)

