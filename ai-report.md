# VAD/Trim Pipeline Root Cause Analysis

## Current Implementation Overview

### Stage A: VAD + Trim
1. **Decode**: `decodeWebmToPcm16()` - ffmpeg decodes WebM/Opus → PCM16 mono @ 16kHz
2. **VAD**: `runVadOnPcm16()` - node-vad stream processes PCM16, detects speech segments
3. **Trim**: `trimPcm16ToSegments()` - extracts PCM samples for detected segments
4. **Encode**: `pcm16ToWav()` - converts trimmed PCM16 → WAV (base64)

### Stage B: Transcription
- Gemini transcribes trimmed WAV audio to text

### Stage C: Intent + Tools
- Gemini function calling on transcript text (two-pass: intent → spoken response)

## Observed Symptoms (from logs/ai-events.jsonl)

**Request**: `req_1763895585651_szspxyiq2`
- Input: 7.34KB WebM audio
- VAD reports: `speechDurationMs: 1960`, `speechRatio: 0.583`
- **BUG**: `trimmedAudioSizeKB: 0` (should be ~2-3KB for 1960ms @ 16kHz)
- VAD segment: `startMs: 779850, endMs: 781810` (~13 minutes, clearly wrong for tiny clip)
- Transcription: generic greeting "Hello, how are you doing today?" (hallucination from empty/corrupt audio)
- Intent: no tool calls (because transcript is generic greeting)

## Root Cause Analysis

### Primary Bug: VAD Timing Uses Absolute/Incorrect Times

**Location**: `api/utils/vad.ts:49,54-58`

The code prioritizes `speech.startTime`/`speech.endTime` from node-vad over sample-based calculation:

```typescript
const startMs = speech.startTime ? speech.startTime * 1000 : (totalSamplesWritten / sampleRate) * 1000;
const endMs = speech.endTime 
  ? speech.endTime * 1000 
  : speech.duration 
    ? currentSegment.startMs + speech.duration
    : (totalSamplesWritten / sampleRate) * 1000;
```

**Problem**: `speech.startTime`/`speech.endTime` from node-vad appear to be:
- Absolute stream times (if library maintains global state)
- OR in a different unit/format than expected
- Result: `startMs: 779850` (13 minutes) for a ~3 second clip

**Evidence**: Log shows segment times 400x larger than actual clip duration.

### Secondary Bug: No Bounds Checking in Trim

**Location**: `api/utils/wavEncoder.ts:68-75`

`trimPcm16ToSegments()` calculates sample indices from segment times without validating bounds:

```typescript
const startSample = Math.floor(seg.startMs * samplesPerMs);
const endSample = Math.ceil(seg.endMs * samplesPerMs);
const startByte = startSample * bytesPerSample;
const endByte = Math.min(endSample * bytesPerSample, pcm16.length);
```

**Problem**: When `startMs: 779850`, `startSample` becomes ~12.5M samples, `startByte` exceeds buffer length, `endByte <= startByte`, resulting in empty `chunks` array → empty trimmed buffer.

### Tertiary Bug: Empty Trimmed Buffer Still Sent to Transcription

**Location**: `api/ai-audio.ts:374-378`

No validation that `trimmedPcm16` is non-empty before encoding to WAV and sending to Gemini:

```typescript
const trimmedPcm16 = trimPcm16ToSegments(pcm16, vadResult.segments, 16000);
const trimmedAudioSizeKB = Math.round((trimmedPcm16.length / 1024) * 100) / 100;
trimmedWavBase64 = pcm16ToWav(trimmedPcm16, 16000);
```

**Problem**: Empty WAV sent to Gemini → hallucinated generic greeting transcript.

### Unit Conversion Verification

- Sample rate: consistently 16kHz across all stages ✓
- PCM16: 2 bytes per sample ✓
- ms → samples: `samplesPerMs = 16000/1000 = 16` ✓
- Conversion logic in `trimPcm16ToSegments()` is correct, but receives invalid segment times

### VAD Instance Lifecycle

**Finding**: VAD instances are created per-request (`VAD.createStream()` called in `runVadOnPcm16()`), so no shared state between requests. The issue is node-vad's internal `speech.startTime`/`speech.endTime` values, not instance reuse.

## Recommended Fixes

### Fix 1: Always Use Sample-Based Timing (High Priority)

**File**: `api/utils/vad.ts`

- Remove reliance on `speech.startTime`/`speech.endTime` from node-vad
- Always calculate times from `totalSamplesWritten` (relative to current clip)
- Track segment start/end using sample counts, convert to ms only for logging

**Tradeoff**: Slightly less accurate if node-vad's internal timing is better, but ensures clip-relative times.

### Fix 2: Add Segment Sanity Checks (High Priority)

**File**: `api/utils/vad.ts` (in `processSegments()` or before returning)

- Clamp segments to clip duration: `startMs >= 0`, `endMs <= totalDurationMs`
- Drop segments where `startMs >= endMs` or `endMs - startMs > totalDurationMs + 200ms`
- Recompute `speechDurationMs` from clamped segments

**Tradeoff**: May drop valid segments if VAD detects speech beyond clip end, but prevents empty trim.

### Fix 3: Validate Trimmed Buffer Before Transcription (High Priority)

**File**: `api/ai-audio.ts`

- Check `trimmedPcm16.length > 0` after trim
- If empty or `trimmedAudioSizeKB < 0.1`, log `vad_trim_empty` event
- Fall back to untrimmed audio (or return "didn't catch that" if `speechRatio < 0.1`)

**Tradeoff**: Untrimmed audio may include noise, but better than empty audio → hallucination.

### Fix 4: Add Diagnostic Logging (Medium Priority)

**Files**: `api/utils/vad.ts`, `api/utils/wavEncoder.ts`, `api/ai-audio.ts`

- Log `pcm16.length`, `totalDurationMs`, `totalSamplesWritten` at VAD end
- Log segment times before/after clamping
- Log `startSample`, `endSample`, `startByte`, `endByte` in trim function
- Log `trimmedPcm16.length` before encoding

**Tradeoff**: More log noise, but enables faster debugging of regressions.

## Implementation Plan

1. Fix VAD timing to use sample-based calculation only
2. Add segment bounds clamping in `processSegments()`
3. Add trimmed buffer validation in `ai-audio.ts` with fallback
4. Add diagnostic logging at key points
5. Test with the failing log case (segment times should be ~0-3000ms, not 779850ms)
