# Continuous Recording Implementation Plan

## Approach: 2-Minute Ring Buffer with Timestamp Extraction

**Concept**: Always record to a 2-minute ring buffer. When wake word detected, mark start timestamp. When VAD ends, mark end timestamp. Extract segment between timestamps and send to server.

## Key Changes Needed

### 1. VoiceControl Class Structure

**Add to class properties:**
```typescript
// Continuous recording ring buffer (2 minutes)
private continuousRecorder: MediaRecorder | null = null;
private ringBuffer: TimestampedChunk[] = [];
private continuousRecordingStartTime: number = 0;
private readonly RING_BUFFER_DURATION_MS = 120000; // 2 minutes
private readonly CHUNK_INTERVAL_MS = 100; // Request chunks every 100ms
private isContinuousRecording = false;
private wakeWordTimestamp: number | null = null; // Timestamp when wake word detected
```

**Interface:**
```typescript
interface TimestampedChunk {
  blob: Blob;
  timestamp: number; // Relative to continuousRecordingStartTime
}
```

### 2. Initialize Continuous Recording

**New method: `initializeContinuousRecording()`**
- Called once when voice control starts (or on first wake word detection)
- Creates MediaRecorder with 100ms timeslice
- Maintains ring buffer (removes chunks older than 2 minutes)
- Never stops - runs continuously

### 3. Start Command Recording (Modified)

**`startCommandRecording()` now:**
- Ensures continuous recording is running
- Marks wake word timestamp: `this.wakeWordTimestamp = Date.now() - this.continuousRecordingStartTime`
- Sets up VAD to detect speech end
- Does NOT create new MediaRecorder

### 4. Extract and Send Segment (New)

**`extractAndSendSegment()`:**
- Gets current timestamp (end of speech)
- Filters ring buffer: chunks between `wakeWordTimestamp - 500ms` and `endTimestamp + 250ms`
- Combines chunks into single Blob
- Calls `processAudioBlob()` to send to API

### 5. Stop Command Recording (Modified)

**`stopCommandRecording()` now:**
- Calls `extractAndSendSegment()` instead of stopping MediaRecorder
- Cleans up VAD resources
- Does NOT stop continuous recorder

### 6. Setup VAD (Keep Existing)

**`setupVAD()` remains the same** - used to detect when speech ends

## Flow Diagram

```
1. App starts → initializeContinuousRecording() → MediaRecorder running, ring buffer filling
2. User says "hey jarvis play bbc radio one"
3. Wake word detected → startCommandRecording() → marks wakeWordTimestamp
4. VAD detects speech end → stopCommandRecording() → extractAndSendSegment()
5. Extract chunks from ring buffer (wakeWordTimestamp to endTimestamp)
6. Send extracted segment to API
7. Continuous recording continues (never stops)
```

## Benefits

- ✅ Captures wake word (it's in the ring buffer)
- ✅ No complex audio format conversion
- ✅ Minimal latency (just extraction, no encoding)
- ✅ Simple implementation (MediaRecorder handles encoding)
- ✅ Works with existing VAD pipeline

## Implementation Notes

1. **Ring buffer cleanup**: Remove chunks older than 2 minutes on each new chunk
2. **Timestamp precision**: 100ms timeslice gives good precision for extraction
3. **Memory**: 2 minutes @ 24kbps ≈ 360KB (negligible)
4. **Initialization**: Can be lazy (initialize on first wake word) or eager (on app start)

## Testing Checklist

- [ ] Continuous recording starts and maintains ring buffer
- [ ] Wake word timestamp is marked correctly
- [ ] VAD end triggers extraction
- [ ] Extracted segment includes wake word
- [ ] Extracted segment includes full command
- [ ] Ring buffer doesn't grow beyond 2 minutes
- [ ] Multiple commands work (ring buffer continues)

