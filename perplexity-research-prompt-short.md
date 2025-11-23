# Perplexity Research: Wake Word Audio Capture

I'm building a voice-controlled radio app with a 3-stage pipeline: (1) VAD+trim (WebM→PCM16→node-vad→WAV), (2) Gemini transcription, (3) Gemini intent detection.

**Problem**: Wake word "hey jarvis" is spoken BEFORE MediaRecorder starts, so it's missing from transcripts. User says "hey jarvis play bbc radio one" but only "play bbc radio one" is captured.

**Current setup**:
- Wake word detection via WebSocket (separate service)
- MediaRecorder API for command capture (WebM/Opus, 16kHz mono)
- Recording starts immediately when wake word detected (no delay)
- Added ring buffer (Float32Array, ~1s) but can't easily prepend to WebM

**Questions**:
1. How do commercial voice assistants (Alexa, Google) capture wake word audio?
2. Best way to prepend Float32Array/PCM to MediaRecorder's WebM output?
3. Should we use continuous MediaRecorder with ring buffer instead?
4. Can WebCodecs API or AudioWorklet help?
5. Alternative: send wake word detector's stream to server for unified processing?

**Constraints**: Modern browsers, low latency, 16kHz mono, WebM/Opus preferred, Vercel serverless.

**Need**: Practical solution balancing complexity, compatibility, latency, and resources.

