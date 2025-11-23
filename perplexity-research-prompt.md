# Perplexity Research Prompt: Wake Word Audio Capture in Voice Assistant Pipeline

## Project Context

I'm building a voice-controlled radio application (iRadio/JamieRadio) with a 3-stage server-side audio processing pipeline:

**Architecture:**
- **Frontend**: React/TypeScript, uses WebSocket for wake word detection ("hey jarvis"), MediaRecorder API for command capture
- **Backend**: Node.js/Vercel serverless functions
- **Pipeline**: 
  1. **Stage A**: VAD (Voice Activity Detection) + trim - ffmpeg decodes WebM/Opus → PCM16@16kHz → node-vad detects speech → trim to segments → WAV
  2. **Stage B**: Transcription - Gemini 2.5 Flash transcribes trimmed WAV to text
  3. **Stage C**: Intent + Tools - Gemini function calling (two-pass: intent detection → spoken response)

**Tech Stack:**
- Wake word detection: WebSocket-based (separate service, detects "hey jarvis")
- Audio capture: Browser MediaRecorder API (WebM/Opus format)
- VAD: node-vad library (VERY_AGGRESSIVE mode, 16kHz, 300ms debounce)
- Transcription: Google Gemini 2.5 Flash (audio/wav input)
- TTS: Murf AI WebSocket streaming

## Current Problem

**Issue**: Wake word "hey jarvis" is being spoken BEFORE MediaRecorder starts recording, so it's missing from the transcript. User says "hey jarvis play bbc radio one" but transcription only captures "play bbc radio one".

**Current Flow:**
1. Wake word detector (WebSocket) continuously listens for "hey jarvis"
2. When detected, triggers `startCommandRecording()` 
3. MediaRecorder starts recording (no delay, starts immediately)
4. But "hey jarvis" was already spoken before step 2-3

**What We've Tried:**
- Removed 200ms delay before MediaRecorder.start()
- Server-side: First VAD segment always starts at 0ms to capture beginning
- Added ring buffer in wake word detector (Float32Array chunks, ~1 second buffer)
- Problem: Can't easily prepend Float32Array to MediaRecorder's WebM output

**Current State:**
- Transcription works (captures command after wake word)
- Wake word missing from transcript (not critical for functionality, but user wants it included)
- Ring buffer infrastructure exists but not used (prepending Float32Array to WebM is complex)

## Research Questions

1. **Best practices for capturing wake word audio in browser-based voice assistants:**
   - How do commercial voice assistants (Alexa, Google Assistant, Siri) handle this?
   - Do they use continuous recording with ring buffers?
   - What's the latency tradeoff between wake word detection and command capture?

2. **MediaRecorder API limitations and alternatives:**
   - Can MediaRecorder capture audio before `.start()` is called?
   - Best way to prepend Float32Array/PCM audio to MediaRecorder's WebM output?
   - Should we use Web Audio API (AudioWorklet/ScriptProcessor) instead of MediaRecorder?
   - Can we use MediaRecorder with timeslice=0 and manually buffer chunks?

3. **Audio format conversion strategies:**
   - How to efficiently convert Float32Array (from ScriptProcessorNode) to WebM/Opus format?
   - Should we use WebCodecs API (if available)?
   - Can we use ffmpeg.wasm for client-side encoding?
   - Is there a lightweight JavaScript library for WebM/Opus encoding?

4. **Alternative architectures:**
   - Should we use a single continuous MediaRecorder that's always running (with ring buffer)?
   - Should wake word detector and command recorder share the same MediaRecorder instance?
   - Can we use AudioWorkletNode for lower-latency audio processing?
   - Should we send raw PCM from wake word detector to server and let server handle wake word + command in one stream?

5. **Performance and resource considerations:**
   - Memory footprint of ring buffers (1-2 seconds of 16kHz mono audio)
   - CPU cost of client-side audio encoding (Float32Array → WebM)
   - Browser compatibility (MediaRecorder, WebCodecs, AudioWorklet support)

6. **Server-side solutions:**
   - Could we send wake word detector's audio stream to server and let server handle both wake word detection AND command capture in one continuous stream?
   - Would this reduce latency vs. current two-stage approach (wake word detection → trigger recording)?

## Constraints

- Must work in modern browsers (Chrome, Safari, Firefox)
- Low latency is important (user expects quick response)
- Server is Vercel serverless (function execution time limits)
- Audio format: WebM/Opus preferred (small payload size)
- Sample rate: 16kHz mono (for VAD compatibility)

## Desired Outcome

Find the most practical solution to capture wake word audio in the command transcript, considering:
- Implementation complexity
- Browser compatibility
- Latency impact
- Resource usage (memory/CPU)
- Maintainability

Please provide:
1. Recommended approach with rationale
2. Code examples or libraries if applicable
3. Tradeoffs and alternatives
4. Browser compatibility notes
5. Performance considerations

