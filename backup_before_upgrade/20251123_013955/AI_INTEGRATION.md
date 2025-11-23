# AI Integration in iRadio

This document explains how AI is integrated into the iRadio application, including wake word detection, voice command processing, and text-to-speech responses.

## Architecture Overview

The AI integration consists of three main components:

1. **Wake Word Detection** - Python WebSocket server that detects "Jarvis" wake word
2. **Voice Command Processing** - Google Gemini AI processes audio commands
3. **Text-to-Speech** - Browser Speech Synthesis API for AI responses

## Component Flow

```
User speaks "Jarvis, play Capital FM"
    ↓
Wake Word Detector (Python WebSocket) detects "Jarvis"
    ↓
Frontend triggers voice command recording (3 seconds)
    ↓
Audio sent to /api/ai-audio endpoint
    ↓
Gemini AI processes audio and returns JSON command
    ↓
Frontend executes command (play station, change volume, etc.)
    ↓
TTS speaks response to user
```

## Components

### 1. Wake Word Detection (`src/hooks/useWakeWordDetector.ts`)

**Purpose**: Continuously listens for the wake word "Jarvis" using a Python WebSocket server.

**How it works**:
- Connects to `ws://localhost:8000/ws` (Python FastAPI server)
- Streams microphone audio as int16 PCM (16kHz, mono) to the server
- Server uses `openwakeword` library with "hey_jarvis" model
- When wake word is detected, server sends JSON: `{"type": "detection", "model": "...", "score": 0.95, "timestamp": ...}`
- Frontend triggers `voiceControl.startCommandRecording()`

**Key Features**:
- Always-on listening (when enabled)
- Low latency detection
- Debouncing to prevent multiple triggers (2 second cooldown)
- Automatic reconnection on disconnect

**Setup**:
- Python server runs on port 8000
- Requires `openwakeword` Python library
- See `WAKE_WORD_SETUP.md` for installation

### 2. Voice Command Recording (`src/services/voiceControl.ts`)

**Purpose**: Records audio after wake word detection and sends it to AI for processing.

**How it works**:
- When wake word detected, starts recording for 3 seconds
- Uses `MediaRecorder` API to capture audio
- Converts audio to base64 and sends to `/api/ai-audio`
- Receives JSON response with command and text
- Executes command via callbacks
- Speaks response using TTS

**Key Features**:
- Shares microphone stream with wake word detector (clones stream)
- 3 second max recording duration
- Low bitrate encoding (16kbps) to reduce payload size
- Automatic timeout handling

**Audio Format**:
- Format: WebM with Opus codec
- Bitrate: 16kbps
- Sample Rate: Browser default (usually 48kHz)
- Channels: Mono

### 3. AI Audio Processing (`api/ai-audio.ts`)

**Purpose**: Processes audio commands using Google Gemini AI and returns structured commands.

**How it works**:
- Receives base64-encoded audio from frontend
- Uses Google Gemini 2.5 Flash model with audio understanding
- Sends audio as inline data with system instructions
- Returns JSON matching command schema

**System Instructions**:
- AI is "Jarvis", assistant for JamieRadio
- Has access to station list for accurate matching
- Prioritizes "play" commands when user asks to play a station
- Returns structured JSON with command, station, action, text fields

**Command Schema**:
```typescript
{
  command: 'play' | 'next' | 'previous' | 'volume' | 'mute' | 'unmute' | 'info' | 'error',
  station?: string,      // Station name for 'play' command
  action?: 'up' | 'down', // For 'volume' command
  text: string,          // Natural language response for TTS
  error?: string,        // Error message if command is 'error'
  message?: string       // Info message for 'info' command
}
```

**Key Features**:
- 1-hour in-memory caching of station list
- Station list passed to AI for context (first 50 stations)
- Handles markdown code blocks in responses
- Error handling with fallback responses

### 4. Command Execution (`src/components/Player.tsx`)

**Purpose**: Executes AI commands and provides TTS feedback.

**How it works**:
- Receives command from `voiceControl` callbacks
- Maps AI command to application actions:
  - `play` → `onPlayStation(stationName)`
  - `next` → `onNextStation()`
  - `previous` → `onPreviousStation()`
  - `volume_up` → Increase volume by 10%
  - `volume_down` → Decrease volume by 10%
  - `mute` → Set muted state
  - `unmute` → Clear muted state
  - `whats_playing` → Speak current track info

**Volume Ducking**:
- When TTS is speaking, radio volume is reduced to 30%
- Volume automatically restores when TTS finishes
- Uses Web Audio API `GainNode` for smooth transitions

### 5. Text-to-Speech (`src/services/voiceFeedback.ts`)

**Purpose**: Speaks AI responses to the user.

**How it works**:
- Uses browser `SpeechSynthesis` API
- Selects UK English voice if available
- Speaks response text from AI
- Notifies Player component for volume ducking

**Current Implementation**:
- Uses Web Speech API (can be muffled)
- Rate: 1.1 (slightly faster for clarity)
- Language: en-GB
- See `PERPLEXITY_TTS_SEARCH.md` for better TTS options

**Volume Ducking Integration**:
- Calls `onTTSStateChange(true)` when starting
- Calls `onTTSStateChange(false)` when finished
- Player component listens and ducks radio volume

## API Endpoints

### `/api/ai-audio` (POST)

Processes audio commands using Gemini AI.

**Request**:
```json
{
  "audio": "base64-encoded-audio-data",
  "mimeType": "audio/webm",
  "stations": ["Capital FM", "Heart UK", ...] // Optional: station list for context
}
```

**Response**:
```json
{
  "command": "play",
  "station": "Capital FM",
  "text": "ok got it now playing capital fm"
}
```

## Configuration

### Environment Variables

- `GOOGLE_AI_API_KEY` - Google Gemini API key (hardcoded fallback in code)

### Wake Word Server

- Port: 8000
- WebSocket: `ws://localhost:8000/ws`
- Model: `hey_jarvis` (openwakeword)
- Threshold: 0.5

## Data Flow Example

1. **User says**: "Jarvis, play Capital FM"

2. **Wake Word Detector**:
   - Detects "Jarvis" (score: 0.95)
   - Triggers `voiceControl.startCommandRecording()`

3. **Voice Control**:
   - Records 3 seconds of audio
   - Converts to base64
   - Sends to `/api/ai-audio` with station list

4. **AI Processing**:
   - Gemini processes audio
   - Recognizes "play Capital FM" command
   - Returns: `{"command": "play", "station": "Capital FM", "text": "ok got it now playing capital fm"}`

5. **Command Execution**:
   - Player component receives command
   - Calls `onPlayStation("Capital FM")`
   - Station changes to Capital FM
   - TTS speaks: "ok got it now playing capital fm"
   - Radio volume ducks to 30% during TTS

6. **Volume Restoration**:
   - TTS finishes
   - Radio volume restores to original level

## Station List Integration

The AI receives the station list to:
- Match station names accurately
- Only suggest real stations
- Handle variations (e.g., "Capital FM" vs "Capital")

**Implementation**:
- Station list passed from `App.tsx` → `Player.tsx` → `voiceControl.ts` → API
- First 50 stations included in prompt
- Full list available if needed

## Error Handling

**Wake Word Detection Errors**:
- WebSocket connection failures: Logged, automatic reconnection
- Microphone access denied: User must grant permission

**Voice Recording Errors**:
- No audio chunks: Logged, command not sent
- Empty audio: Validation prevents sending
- Network errors: Logged, user notified

**AI Processing Errors**:
- API key invalid: Returns error command
- Audio too large: Payload size limits prevent
- Invalid response: JSON parsing with fallback
- Network timeout: Returns cached/stale response if available

## Performance Considerations

**Wake Word Detection**:
- Low latency: Processes 80ms audio chunks
- Always-on: Minimal CPU usage
- WebSocket: Efficient binary streaming

**Voice Recording**:
- 3 second max duration
- 16kbps encoding reduces payload
- Base64 encoding adds ~33% overhead

**AI Processing**:
- 1-hour station list caching
- Inline audio (no file upload for < 20MB)
- Response time: ~1-3 seconds typical

**TTS**:
- Browser-native (no network calls)
- Volume ducking prevents audio conflicts
- Automatic cleanup on component unmount

## Future Improvements

1. **Better TTS**: Replace Web Speech API with higher quality solution (see `PERPLEXITY_TTS_SEARCH.md`)
2. **Offline Wake Word**: Consider client-side wake word detection
3. **Command History**: Store and learn from user commands
4. **Multi-language**: Support multiple languages for TTS and commands
5. **Voice Profiles**: Customize TTS voice per user preference
6. **Streaming Responses**: Stream AI responses for faster feedback

## Troubleshooting

**Wake word not detected**:
- Check Python server is running (`npm run dev:wakeword`)
- Verify WebSocket connection in browser console
- Check microphone permissions
- Test with "Jarvis" clearly spoken

**Commands not executing**:
- Check browser console for errors
- Verify station name matches available stations
- Check AI API response in network tab
- Ensure microphone access granted

**TTS not speaking**:
- Check browser supports Speech Synthesis
- Verify `speechSynthesis` API available
- Check for errors in console
- Try different browser

**Volume not ducking**:
- Check `gainNodeRef` is initialized
- Verify TTS state change callbacks working
- Check Web Audio API support

## Related Files

- `src/hooks/useWakeWordDetector.ts` - Wake word detection hook
- `src/services/voiceControl.ts` - Voice command recording
- `src/services/voiceFeedback.ts` - Text-to-speech
- `api/ai-audio.ts` - AI audio processing endpoint
- `api/stations.ts` - Station list API (used by AI)
- `start-wakeword-server.py` - Python wake word server
- `WAKE_WORD_SETUP.md` - Wake word server setup guide

