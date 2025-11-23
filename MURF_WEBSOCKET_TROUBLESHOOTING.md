# Murf AI WebSocket TTS Integration - Troubleshooting Guide

## Problem Summary

The Murf AI WebSocket TTS integration is not returning audio. Messages are being sent correctly to Murf AI, but no audio responses are being received.

## Current Status

- ✅ WebSocket connection establishes successfully
- ✅ Voice configuration is sent correctly
- ✅ Text messages are queued and sent after connection
- ❌ No audio responses received from Murf AI
- ❌ No error messages from Murf AI

## API Documentation Context

According to Murf AI documentation:

### WebSocket Endpoint
- **URL**: `wss://global.api.murf.ai/v1/speech/stream-input`
- **Model Support**: 
  - `FALCON` - Available on WebSocket endpoints
  - `GEN2` - **NOT available on WebSocket**, only on HTTP endpoint (`api.murf.ai/v1/speech/stream`)

### Message Formats

#### 1. Voice Configuration (on connect)
```json
{
  "setVoiceConfigurationOrInitializeContext": {
    "voice_config": {
      "voice_id": "en-UK-theo",
      "style": "Narration",
      "variation": 5,
      "rate": 2,
      "pitch": -5
    },
    "context_id": "ctx_..."
  }
}
```

#### 2. Send Text
```json
{
  "sendText": {
    "text": "Hello world",
    "end": false,
    "context_id": "ctx_..."
  }
}
```

#### 3. Response Format (from Murf AI)
- **Audio Output**: `{ "audio": "base64_string", "context_id": "..." }`
- **Final Output**: `{ "final": true, "context_id": "..." }`

## Current Implementation

### Server-Side Proxy (`api-server.ts`)

**Location**: `api-server.ts` lines 268-482

**Key Components**:
1. WebSocket server on `/api/tts/murf-ws`
2. Proxies to Murf AI WebSocket endpoint
3. Handles message queuing until connection is ready
4. Forwards messages between client and Murf AI

**Current Flow**:
1. Client connects to server proxy
2. Server connects to Murf AI WebSocket (`wss://global.api.murf.ai/v1/speech/stream-input?api_key=...&model=FALCON`)
3. On connection open:
   - Send voice configuration
   - Wait 100ms
   - Send queued text messages
4. Forward responses from Murf AI to client

**Issue**: No responses are being received from Murf AI after sending text.

### Client-Side (`src/services/murfWebSocketTTS.ts`)

**Location**: `src/services/murfWebSocketTTS.ts`

**Key Components**:
1. Connects to server proxy: `ws://localhost:3001/api/tts/murf-ws`
2. Sends text chunks: `{ "text": "...", "end": false }`
3. Receives audio chunks: `{ "audio": "base64...", "final": true }`
4. Buffers and plays audio chunks

**Current Flow**:
1. Split text into 5-word chunks
2. Send chunks every 50ms
3. Send final message with `end: true`
4. Wait for audio chunks and play them

## Logs Analysis

### What We See:
```
[Murf WS Proxy] Client connected
[Murf WS Proxy] Connecting to Murf AI WebSocket (Falcon model)
[Murf WS Proxy] Received from client: {"text":"now playing Radio X","end":false}
[Murf WS Proxy] WebSocket not ready, queuing message
[Murf WS Proxy] Connected to Murf AI
[Murf WS Proxy] Voice configuration sent (Falcon model)
[Murf WS Proxy] Sending 1 queued messages
[Murf WS Proxy] Message sent to Murf AI
```

### What We DON'T See:
- No `===== RAW MESSAGE FROM MURF AI =====` logs
- No audio chunks being received
- No error messages from Murf AI
- No final messages

## Possible Issues

### 1. Voice Configuration Acknowledgment
**Hypothesis**: Murf AI might need to acknowledge voice config before accepting text.

**Evidence**: We send voice config, wait 100ms, then send text. But maybe we need to wait for a response.

**Fix Needed**: Wait for acknowledgment message from Murf AI before sending text.

### 2. Message Format Issue
**Hypothesis**: The `sendText` format might be incorrect.

**Current Format**:
```json
{
  "sendText": {
    "text": "now playing Radio X",
    "end": false,
    "context_id": "ctx_..."
  }
}
```

**Check**: Does Murf AI expect a different structure? Maybe `sendText` should be at root level differently?

### 3. Context ID Mismatch
**Hypothesis**: Context ID might need to match exactly, or might need to be sent differently.

**Current**: We generate `ctx_${Date.now()}_${random}` and use it in both voice config and sendText.

**Check**: Does voice config need to return a context_id that we should use?

### 4. Authentication Issue
**Hypothesis**: API key might not be working correctly on WebSocket.

**Current**: API key is passed as query parameter: `?api_key=...&model=FALCON`

**Check**: Does WebSocket need header authentication instead?

### 5. Model/Endpoint Mismatch
**Hypothesis**: Falcon model might have different requirements than Gen2.

**Current**: Using `model=FALCON` on `global.api.murf.ai`

**Check**: Should we use a regional endpoint? Does Falcon need different voice IDs?

## Code References

### Server Proxy Connection
```typescript:api-server.ts
// Lines 268-295
wss.on('connection', (clientWs, req) => {
  let murfWs: any = null;
  let contextId: string | null = null;
  let messageQueue: string[] = [];
  let isConnected = false;
  
  contextId = `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const murfWsUrl = `wss://global.api.murf.ai/v1/speech/stream-input?api_key=${encodeURIComponent(murfApiKey)}&model=FALCON`;
  murfWs = new WebSocket(murfWsUrl);
```

### Voice Configuration
```typescript:api-server.ts
// Lines 296-331
murfWs.on('open', () => {
  isConnected = true;
  
  const voiceConfig = {
    setVoiceConfigurationOrInitializeContext: {
      voice_config: {
        voice_id: 'en-UK-theo',
        style: 'Narration',
        variation: 5,
        rate: 2,
        pitch: -5,
      },
      context_id: contextId,
    },
  };
  
  murfWs.send(JSON.stringify(voiceConfig));
  
  setTimeout(() => {
    // Send queued messages
  }, 100);
});
```

### Message Forwarding
```typescript:api-server.ts
// Lines 379-413
clientWs.on('message', (data: Buffer) => {
  const message = JSON.parse(data.toString());
  
  if (message.text !== undefined) {
    const murfMessage = {
      sendText: {
        text: message.text,
        end: message.end || false,
        context_id: contextId,
      },
    };
    
    if (isConnected && murfWs.readyState === WebSocket.OPEN) {
      murfWs.send(JSON.stringify(murfMessage));
    } else {
      messageQueue.push(JSON.stringify(murfMessage));
    }
  }
});
```

### Response Handling
```typescript:api-server.ts
// Lines 334-378
murfWs.on('message', (data: Buffer) => {
  const rawMessage = data.toString();
  const message = JSON.parse(rawMessage);
  
  if (message.audio !== undefined) {
    // Forward audio chunk
    clientWs.send(JSON.stringify({ audio: message.audio, context_id: message.context_id }));
  } else if (message.final !== undefined) {
    // Forward final message
    clientWs.send(JSON.stringify({ final: message.final, context_id: message.context_id }));
  }
});
```

### Client Implementation
```typescript:src/services/murfWebSocketTTS.ts
// Lines 190-295
export async function speakWithWebSocket(text: string): Promise<void> {
  const wsConnection = await connectWebSocket();
  
  // Split text into chunks
  const words = text.split(/\s+/);
  const chunkSize = 5;
  
  const sendNextChunk = () => {
    if (chunkIndex >= words.length) {
      // Send end marker
      wsConnection.send(JSON.stringify({ text: '', end: true }));
      return;
    }
    
    const chunk = words.slice(chunkIndex, chunkIndex + chunkSize).join(' ');
    wsConnection.send(JSON.stringify({
      text: chunk,
      end: false,
    }));
    
    chunkIndex += chunkSize;
    setTimeout(sendNextChunk, 50);
  };
  
  sendNextChunk();
}
```

## Environment Variables

- `MURF_API_KEY`: Set in `.env` file
- API key format: `ap2_...` (starts with `ap2_`)

## Testing Steps

1. Start the server: `npm run dev:api`
2. Trigger voice command
3. Check server logs for:
   - Connection establishment
   - Voice config sent
   - Text messages sent
   - **Any responses from Murf AI** (currently missing)

## Expected Behavior

1. Client connects to server proxy
2. Server connects to Murf AI
3. Voice config sent → Murf AI acknowledges (maybe?)
4. Text sent → Murf AI starts generating audio
5. Audio chunks stream back → Client plays them
6. Final message received → Client stops

## Current Behavior

1. ✅ Client connects to server proxy
2. ✅ Server connects to Murf AI
3. ✅ Voice config sent
4. ✅ Text sent
5. ❌ **No audio chunks received**
6. ❌ **No final message received**

## Questions to Investigate

1. **Does Murf AI send an acknowledgment after voice config?**
   - If yes, we should wait for it before sending text
   - Check if there's a response message we're missing

2. **Is the `sendText` format correct?**
   - Compare with official API examples
   - Check if `context_id` is required in `sendText` or only in voice config

3. **Does Falcon model support the voice/style we're using?**
   - `en-UK-theo` with `Narration` style
   - Maybe Falcon has different voice options?

4. **Should we use a regional endpoint instead of global?**
   - UK endpoint: `wss://uk.api.murf.ai/v1/speech/stream-input`
   - Might have better support for UK voices

5. **Is there a WebSocket protocol version issue?**
   - Check if Murf AI requires specific WebSocket subprotocols
   - Check if headers are needed

## Additional Resources

- Murf AI API Docs: https://murf.ai/api/docs/api-reference/text-to-speech/stream-input
- AsyncAPI Spec provided by user shows the exact message formats
- Model enum shows: `FALCON` and `GEN2` are both valid

## Next Steps for AI Researcher

1. Review the AsyncAPI specification provided
2. Check if voice config needs acknowledgment before sending text
3. Verify the exact message format for `sendText`
4. Test if regional endpoints work better
5. Check if there are any required headers or subprotocols
6. Verify if Falcon model supports the voice/style combination
7. Check Murf AI error responses - maybe they're being sent but not logged

## Files to Review

- `api-server.ts` (lines 268-482) - Server proxy implementation
- `src/services/murfWebSocketTTS.ts` - Client implementation
- `.env` - API key configuration
- Murf AI API documentation (provided by user)

