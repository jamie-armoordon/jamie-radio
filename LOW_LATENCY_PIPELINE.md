# Low-Latency Streaming Pipeline

## Overview

This document describes the low-latency streaming pipeline for the iRadio voice assistant. The pipeline is designed to minimize end-to-end latency by streaming at every stage: Gemini AI → TTS → Audio Playback.

## Architecture

```
┌─────────────┐
│   User      │
│  Speaks     │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│  Client: voiceControl.ts                                │
│  - Records audio                                        │
│  - Sends to /api/ai-audio (SSE stream)                 │
│  - Reads speak_text chunks progressively                │
│  - Feeds to Murf WS TTS                                 │
│  - Executes command after TTS finishes                  │
└──────┬──────────────────────────────────────────────────┘
       │ POST /api/ai-audio (SSE)
       ▼
┌─────────────────────────────────────────────────────────┐
│  Server: /api/ai-audio.ts                               │
│  - Receives audio                                       │
│  - Streams to Gemini (generateContentStream)            │
│  - Parses partial JSON for speak_text                   │
│  - Emits speak_text via SSE immediately                 │
│  - Emits command when stream completes                 │
└──────┬──────────────────────────────────────────────────┘
       │ SSE: data: {"type":"speak_text","text":"..."}
       │ SSE: data: {"type":"command","command":{...}}
       ▼
┌─────────────────────────────────────────────────────────┐
│  Client: voiceControl.ts (SSE reader)                  │
│  - Receives speak_text chunks                           │
│  - Accumulates text                                     │
│  - Calls speakWithWebSocket() with accumulated text     │
└──────┬──────────────────────────────────────────────────┘
       │ WebSocket: ws://localhost:3001/api/tts/murf-ws
       ▼
┌─────────────────────────────────────────────────────────┐
│  Server: api-server.ts (Murf WS Proxy)                  │
│  - Proxies to Murf AI WebSocket                         │
│  - Forwards text chunks                                 │
│  - Forwards audio chunks                                │
└──────┬──────────────────────────────────────────────────┘
       │ WebSocket: wss://global.api.murf.ai/...
       ▼
┌─────────────────────────────────────────────────────────┐
│  Murf AI WebSocket                                       │
│  - Receives text chunks                                 │
│  - Streams audio chunks (base64 WAV)                    │
└──────┬──────────────────────────────────────────────────┘
       │ WebSocket: {"audio":"base64...","context_id":"..."}
       ▼
┌─────────────────────────────────────────────────────────┐
│  Client: murfWebSocketTTS.ts                            │
│  - Receives audio chunks                                │
│  - Decodes WAV progressively                             │
│  - Queues AudioBuffers                                  │
│  - Schedules playback with WebAudio                     │
│  - Resolves promise when queue drained + final received │
└──────┬──────────────────────────────────────────────────┘
       │ WebAudio API
       ▼
┌─────────────┐
│   User      │
│   Hears     │
│   Audio     │
└─────────────┘
       │
       ▼ (after TTS finishes)
┌─────────────────────────────────────────────────────────┐
│  Client: voiceControl.ts                                 │
│  - Executes command (e.g., play station)                │
└─────────────────────────────────────────────────────────┘
```

## Message Flow Timeline

```
Time    Component              Event
─────────────────────────────────────────────────────────────
0ms     User                   Says "play capital fm"
50ms    voiceControl          Recording starts
3000ms  voiceControl          Recording stops
3000ms  voiceControl          POST /api/ai-audio (SSE)
3005ms  /api/ai-audio         Request received
3010ms  /api/ai-audio         Audio decoded
3015ms  /api/ai-audio         Gemini stream started
3400ms  /api/ai-audio         First Gemini chunk received
3600ms  /api/ai-audio         speak_text parseable: "ok got it"
3600ms  /api/ai-audio         SSE emit: {"type":"speak_text","text":"ok got it"}
3605ms  voiceControl          SSE opened, first speak_text chunk
3610ms  voiceControl          Murf WS opened
3615ms  voiceControl          speakWithWebSocket("ok got it now playing capital fm")
3620ms  murfWebSocketTTS      WebSocket connected
3650ms  murfWebSocketTTS      First audio chunk arrived
3660ms  murfWebSocketTTS      First audio decoded
3670ms  murfWebSocketTTS      Playback started (first buffer scheduled)
3700ms  User                   Hears first audio
4200ms  /api/ai-audio         Gemini stream complete
4205ms  /api/ai-audio         Final JSON parsed
4210ms  /api/ai-audio         SSE emit: {"type":"command","command":{"type":"play","stationName":"Capital FM"}}
4215ms  voiceControl          Command received (stored, not executed yet)
5000ms  murfWebSocketTTS      Murf final received
5500ms  murfWebSocketTTS      Playback finished (queue drained)
5505ms  voiceControl          TTS promise resolved
5510ms  voiceControl          Command executed: play("Capital FM")
```

## Testing Latency

### Console Logs

All timing logs are printed to the console with the format:
```
[Timer:session_id] ISO_TIMESTAMP +ELAPSEDms: EVENT_LABEL {context}
```

Example:
```
[Timer:req_1234567890_abc] 2024-01-15T10:30:45.123Z +5.23ms: request received
[Timer:req_1234567890_abc] 2024-01-15T10:30:45.456Z +338.12ms: first Gemini chunk received
[Timer:voice_1234567890_xyz] 2024-01-15T10:30:45.789Z +50.00ms: first speak_text chunk arrived
```

### Network Tab

1. Open browser DevTools → Network tab
2. Filter by "ai-audio"
3. Look for the SSE connection (EventStream)
4. Check timing:
   - **Waiting (TTFB)**: Time to first Gemini chunk (target: <400ms)
   - **Content Download**: Total stream duration

### Key Metrics to Monitor

1. **Gemini First Chunk**: Time from request to first chunk (target: <400ms)
2. **speak_text Parseable**: Time to extract speak_text (target: <600ms)
3. **First Murf Audio**: Time from speak_text start to first audio chunk (target: <300ms)
4. **First Audible Playback**: Time from first audio chunk to audible sound (target: <150-300ms)
5. **Total End-to-End**: Time from recording stop to command execution (target: <2s for short commands)

## Key Tunables

### Gemini Streaming

- **Chunk Size**: Controlled by Gemini API (not tunable)
- **Partial JSON Parsing**: Extracts `speak_text` as soon as closing quote detected
- **SSE Format**: `data: {"type":"speak_text","text":"..."}\n\n`

**Location**: `api/ai-audio.ts`

### Text Chunking (Client → Murf)

- **Chunk Size**: 5 words per chunk (configurable in `murfWebSocketTTS.ts`)
- **Chunk Delay**: 50ms between chunks (configurable)
- **Location**: `src/services/murfWebSocketTTS.ts` line ~359

```typescript
const chunkSize = 5; // words per chunk
setTimeout(sendNextChunk, 50); // ms between chunks
```

### Audio Playback Buffering

- **Initial Buffer Threshold**: 75ms (configurable, range: 50-100ms)
- **Location**: `src/services/murfWebSocketTTS.ts` line ~143

```typescript
setTimeout(() => {
  decodeAndQueueAudio(isFinal);
}, 75); // ms delay for ultra-low latency
```

### WebAudio Scheduling

- **Strategy**: Queue buffers, schedule next to start when previous ends
- **Location**: `src/services/murfWebSocketTTS.ts` function `scheduleNextBuffer()`

```typescript
const startTime = nextPlaybackTime || audioContext.currentTime;
source.start(startTime);
nextPlaybackTime = startTime + audioBuffer.duration;
```

## Timing Log Checkpoints

### Server: `/api/ai-audio.ts`

| Checkpoint | Description | Target |
|------------|-------------|--------|
| `request received` | HTTP POST received | 0ms |
| `audio decoded/base64 ready` | Audio data ready for Gemini | <50ms |
| `Gemini stream started` | generateContentStream() called | <100ms |
| `first Gemini chunk received` | First chunk from Gemini | <400ms |
| `speak_text parseable emitted` | speak_text extracted and sent via SSE | <600ms |
| `Gemini stream complete` | All chunks received | Variable |
| `final JSON parsed` | Complete JSON parsed | Variable |

### Server: `api-server.ts` (Murf WS Proxy)

| Checkpoint | Description | Target |
|------------|-------------|--------|
| `Murf WS connection initiated` | WebSocket connection started | 0ms |
| `Murf WS connected` | Connection established | <500ms |
| `first Murf audio frame received` | First audio chunk from Murf | <300ms after text sent |
| `Murf final received` | Final message from Murf | Variable |

### Client: `voiceControl.ts`

| Checkpoint | Description | Target |
|------------|-------------|--------|
| `recording start` | Recording begins | 0ms |
| `recording stop` | Recording ends | Variable (max 3000ms) |
| `AI request sent` | POST to /api/ai-audio | <50ms after stop |
| `SSE/stream opened` | SSE connection established | <100ms after request |
| `first speak_text chunk arrived` | First speak_text from Gemini | <600ms after request |
| `Murf WS opened` | WebSocket to Murf proxy opened | <50ms after speak_text |
| `command executed` | Command callback called | After TTS finishes |

### Client: `murfWebSocketTTS.ts`

| Checkpoint | Description | Target |
|------------|-------------|--------|
| `Murf WS opened` | WebSocket connection opened | 0ms |
| `first audio chunk arrived` | First base64 audio from Murf | <300ms after text sent |
| `first audio decoded` | First WAV decoded to AudioBuffer | <50ms after chunk |
| `playback started (first buffer scheduled)` | First buffer scheduled in WebAudio | <100ms after decode |
| `Murf final received` | Final message from Murf | Variable |
| `playback finished (queue drained)` | All buffers played, queue empty | Variable |

## Good Latency Targets

For a command like "play capital fm":

- **Gemini first chunk**: <400ms ✅
- **speak_text parseable**: <600ms ✅
- **First Murf audio**: <300ms after speak_text starts ✅
- **First audible playback**: <150-300ms after first audio chunk ✅
- **Total end-to-end**: <2s for short commands ✅

## Troubleshooting

### High Latency at Gemini Stage

- Check network latency to Google API
- Verify audio payload size (should be <1MB)
- Check Gemini API quota/rate limits

### High Latency at Murf Stage

- Check WebSocket connection time
- Verify text chunking is working (should see multiple chunks)
- Check Murf API status

### Playback Delays

- Check initial buffer threshold (should be 50-100ms)
- Verify WebAudio context is not suspended
- Check for audio queue starvation (should see buffers queued)

### Commands Executing Too Early

- Verify TTS promise is being awaited
- Check that `finalReceived` and `playbackQueue.length === 0` before executing
- Look for timing logs showing command executed before playback finished

## Implementation Notes

### Partial JSON Parsing

The `extractSpeakText()` function in `api/ai-audio.ts` uses a simple state machine to find the closing quote of `speak_text`:

1. Find `"speak_text":"` pattern
2. Track escape sequences (`\`)
3. Find closing `"`
4. Extract and unescape value

This allows emitting `speak_text` as soon as it's complete, without waiting for the full JSON.

### WebAudio Scheduling

The playback queue uses `audioContext.currentTime` to schedule buffers:

- First buffer: `audioContext.currentTime` (immediate)
- Subsequent buffers: `nextPlaybackTime = previousEndTime`
- This ensures gapless playback without gaps or overlaps

### Command Deferral

Commands are stored when received but only executed after:
1. TTS promise resolves (playback finished)
2. Queue is drained (`playbackQueue.length === 0`)
3. Final received (`finalReceived === true`)
4. No pending decodes (`pendingDecodes === 0`)

This ensures the user hears the full response before the action occurs.

