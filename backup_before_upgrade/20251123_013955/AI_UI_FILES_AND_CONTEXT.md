# AI UI Files and Context

This document lists all files relevant to the AI UI and provides context on how the AI system works in iRadio.

## AI System Overview

The AI system in iRadio provides voice-controlled radio playback through:
1. **Wake Word Detection** - Listens for "Jarvis" to activate
2. **Voice Command Processing** - Records and processes voice commands using Google Gemini AI
3. **Text-to-Speech (TTS)** - Responds to users using Google AI TTS API
4. **Visual Feedback** - UI components show AI state and interactions
5. **Volume Ducking** - Automatically reduces radio volume when TTS is speaking

## Core AI State Management

### `src/store/aiStore.ts`
**Purpose**: Centralized state management for AI lifecycle and interactions.

**Key Features**:
- Zustand store with lifecycle state machine
- Phases: `idle`, `listening`, `wake_detected`, `recording`, `processing`, `executing`, `speaking`, `error`
- Tracks last wake word detection, commands, and interaction log (last 20 entries)
- Auto-transitions: `wake_detected` → `recording` after 800-1200ms, `error` → `listening` after 2-3s

**Exports**:
- `useAIStore()` - Hook to access AI state
- `AIPhase` - Type for AI lifecycle phases
- `AICommand` - Type for parsed commands
- `InteractionLogEntry` - Type for interaction history

**State Structure**:
```typescript
{
  phase: AIPhase,
  lastWakeScore?: number,
  lastWakeAt?: number,
  lastCommand?: AICommand,
  error?: string,
  interactionLog: InteractionLogEntry[],
  wakeWordEnabled: boolean
}
```

## AI UI Components

### `src/components/AIStatusOrb.tsx`
**Purpose**: Floating animated orb showing current AI phase.

**Features**:
- Bottom-right position (center-bottom in fullscreen)
- Phase-specific visuals:
  - `idle`: Hidden or subtle dim dot
  - `listening`: Gentle breathing/pulse ring
  - `wake_detected`: Quick pop/glow + ripple (800-1200ms)
  - `recording`: Pulsing + mic icon + 3s radial progress
  - `processing`: Rotating gradient ring / shimmer loop
  - `executing`: Tick animation + command icon
  - `speaking`: Waveform bounce / looping bars
  - `error`: Red shake + exclamation, auto-fade
- Uses Framer Motion for animations
- Respects reduced motion preferences

### `src/components/AIToast.tsx`
**Purpose**: Small animated toast with phase-specific messages.

**Features**:
- Auto-dismissing notifications
- Messages for each phase:
  - "Listening for 'Jarvis'…"
  - "Recording…" with countdown
  - "Thinking…"
  - Command feedback
  - Error messages
- Slide in/out animations
- Positioned near status orb

### `src/components/AITranscriptPanel.tsx`
**Purpose**: Collapsible panel showing AI interaction history.

**Features**:
- Shows last wake word detection (timestamp + confidence)
- Displays last command JSON
- Shows last spoken text
- Scrollable interaction log (last 20 entries from `aiStore`)
- Toggle button to show/hide
- Can be integrated into Player or Settings

## Voice Control Services

### `src/services/voiceControl.ts`
**Purpose**: Handles voice command recording and execution.

**Key Features**:
- Records 3-second audio clips after wake word detection
- Uses `MediaRecorder` API with WebM/Opus encoding
- Sends audio to `/api/ai-audio` endpoint
- Receives command JSON and TTS audio from API
- Plays TTS audio before executing commands
- Manages callbacks for command execution
- Integrates with `aiStore` for state transitions:
  - Sets `recording` phase before recording
  - Sets `processing` phase when sending to API
  - Sets `error` phase on failures
  - Stores command JSON in AI store

**Main Methods**:
- `start()` - Initialize voice control with callbacks
- `stop()` - Stop voice control
- `startCommandRecording()` - Record command after wake word
- `setStationList()` - Update available stations for AI context

### `src/services/voiceFeedback.ts`
**Purpose**: Handles TTS audio playback and volume ducking callbacks.

**Key Features**:
- Plays base64-encoded audio from Google AI TTS API
- Uses Web Audio API for playback (with HTML5 Audio fallback)
- Manages TTS state change callbacks for volume ducking
- Integrates with `aiStore` to set `speaking` phase
- Handles audio format detection (WAV, MP3, OGG)
- Converts PCM audio to WAV format if needed

**Main Functions**:
- `playAudioFromBase64(base64Audio: string)` - Play TTS audio
- `speakResponse(text: string)` - Fallback TTS via `/api/tts`
- `stopSpeaking()` - Stop current TTS playback
- `setTTSStateChangeCallback(callback)` - Register callback for volume ducking

## Wake Word Detection

### `src/hooks/useWakeWordDetector.ts`
**Purpose**: Connects to Python WebSocket server for wake word detection.

**Key Features**:
- Connects to `ws://localhost:8000/ws` (Python FastAPI server)
- Streams microphone audio as int16 PCM (16kHz, mono)
- Receives detection events: `{"type": "detection", "score": 0.95, ...}`
- Debounces detections (2 second cooldown)
- Integrates with `aiStore`:
  - Sets `listening` phase on connection/enabled
  - Sets `wake_detected` phase on detection
  - Sets `error` phase on disconnect/error
  - Sets `idle` phase when disabled
- Triggers `voiceControl.startCommandRecording()` on detection

## AI API Endpoints

### `api/ai-audio.ts`
**Purpose**: Processes voice commands using Google Gemini AI.

**Key Features**:
- Receives base64-encoded audio (WebM format)
- Uses Google Gemini 2.5 Flash model with audio understanding
- Generates TTS audio using `gemini-2.5-flash-preview-tts`
- Returns structured JSON command + base64 audio
- Converts raw PCM audio to WAV format
- Includes station list in context (first 50 stations)
- 1-hour in-memory caching of station list

**Request Format**:
```typescript
{
  audio: string,      // Base64-encoded audio
  mimeType: string,   // "audio/webm"
  stationList?: string[] // Optional station names for context
}
```

**Response Format**:
```typescript
{
  command: 'play' | 'next' | 'previous' | 'volume_up' | 'volume_down' | 'mute' | 'unmute' | 'whats_playing',
  stationName?: string,  // For 'play' command
  text: string,          // Natural language response
  audio: string,         // Base64-encoded WAV audio for TTS
  audioFormat: string    // "wav"
}
```

### `api/tts.ts`
**Purpose**: Dedicated endpoint for TTS generation (fallback).

**Key Features**:
- Takes text input and generates audio using Google AI TTS
- Uses `gemini-2.5-flash-preview-tts` model
- Converts PCM audio to WAV format
- Returns base64-encoded audio

**Request Format**:
```typescript
{
  text: string,
  voice?: string  // Default: "Kore"
}
```

**Response Format**:
```typescript
{
  audio: string,      // Base64-encoded WAV audio
  format: string      // "wav"
}
```

## Integration Points

### `src/components/Player.tsx`
**Purpose**: Main player component that integrates all AI functionality.

**AI Integration**:
- Uses `useAIStore()` to track AI state
- Sets up `voiceControl` with command callbacks
- Executes commands (play, next, previous, volume, mute)
- Integrates volume ducking when TTS is speaking
- Prevents station switching/commands while TTS is playing
- Sets `executing` phase before command execution
- Transitions back to `listening` after execution

**Key Sections**:
- Voice control setup (line ~800): Initializes `voiceControl` with `onCommand` callback
- Command execution (line ~805): Executes AI commands based on type
- Volume ducking (line ~289): Manages gain node volume during TTS
- Gesture controls (line ~731): Prevents swipes while TTS is speaking

### `src/App.tsx`
**Purpose**: Root application component.

**AI Integration**:
- Renders `<AIStatusOrb />` and `<AIToast />` as global overlays
- Uses `pointer-events-none` on wrapper (allows click-through)
- Integrates with existing gradient UI and theme

## Settings Integration

### `src/components/settings/SettingsPanel.tsx`
**Purpose**: Settings panel with AI configuration options.

**AI Settings** (if implemented):
- "AI Visual Feedback" toggle - Controls visibility of Orb/Toast
- Wake word enable/disable toggle
- TTS voice selection (if multiple voices available)

**Storage**: Settings persisted in `src/store/settingsStore.ts`

## Volume Ducking System

**Purpose**: Automatically reduces radio volume when TTS is speaking.

**How It Works**:
1. `voiceFeedback.ts` calls `onTTSStateChange(true)` when TTS starts
2. `Player.tsx` receives callback and sets `isTTSSpeaking` state
3. Volume ducking effect reduces gain node to 20% of original volume
4. When TTS ends, `onTTSStateChange(false)` restores volume
5. Uses `setValueAtTime()` for immediate changes, `setTargetAtTime()` for smooth transitions

**Key Files**:
- `src/services/voiceFeedback.ts` - Triggers callbacks
- `src/components/Player.tsx` - Implements ducking logic (line ~289)

## File Structure

```
src/
├── store/
│   └── aiStore.ts                    # AI state management (Zustand)
├── components/
│   ├── AIStatusOrb.tsx              # Animated status orb
│   ├── AIToast.tsx                  # Toast notifications
│   ├── AITranscriptPanel.tsx        # Interaction history panel
│   ├── Player.tsx                   # Main player (AI integration)
│   └── settings/
│       └── SettingsPanel.tsx        # AI settings UI
├── services/
│   ├── voiceControl.ts              # Voice command recording
│   └── voiceFeedback.ts             # TTS playback & ducking
├── hooks/
│   └── useWakeWordDetector.ts       # Wake word detection
└── App.tsx                          # Root (renders AI UI)

api/
├── ai-audio.ts                      # Voice command processing API
└── tts.ts                           # TTS generation API
```

## AI Lifecycle Flow

```
1. User enables wake word
   → aiStore.setPhase('listening')
   → useWakeWordDetector connects to WebSocket

2. User says "Jarvis"
   → WebSocket detects wake word
   → aiStore.setWakeDetected(score)
   → After 800-1200ms: aiStore.setPhase('recording')
   → voiceControl.startCommandRecording()

3. Recording (3 seconds)
   → MediaRecorder captures audio
   → aiStore.setPhase('processing')
   → Audio sent to /api/ai-audio

4. AI Processing
   → Gemini processes audio
   → Returns command JSON + TTS audio
   → aiStore.setPhase('executing')
   → Command executed in Player.tsx

5. TTS Playback
   → playAudioFromBase64() plays audio
   → aiStore.setSpeaking(true)
   → Volume ducked to 20%
   → aiStore.setSpeaking(false) when done
   → aiStore.setPhase('listening')
```

## Key Dependencies

- **Zustand** - State management for `aiStore`
- **Framer Motion** - Animations for AI UI components
- **Google GenAI SDK** - AI audio processing and TTS
- **Web Audio API** - Audio playback and volume control
- **MediaRecorder API** - Voice command recording

## Configuration

**API Keys**: 
- Google AI API key configured in `api/ai-audio.ts` and `api/tts.ts`
- Currently: `AIzaSyDsmn62Ux5MgplmuEwgthbsYp7-G5CIR84`

**Wake Word Server**:
- Python WebSocket server on `ws://localhost:8000/ws`
- Uses `openwakeword` library with "hey_jarvis" model

**TTS Settings**:
- Default voice: "Kore"
- Ducking level: 20% of original volume
- Transition time: 0.1s for ducking, 0.2s for restoration

## Notes

- All AI commands are blocked while TTS is speaking (`isTTSSpeaking` check)
- Station switching (next/previous) is disabled during TTS
- Gesture controls (swipe left/right) are disabled during TTS
- Volume ducking uses Web Audio API gain node for smooth transitions
- TTS audio is played before command execution to provide immediate feedback

