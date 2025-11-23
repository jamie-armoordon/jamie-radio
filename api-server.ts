// API server for Vite development
// Run with: npm run dev:api or tsx api-server.ts
// This runs on port 3001 and handles /api/* requests

// Load environment variables from .env file
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { loadCache } from './api/_utils/cache.js';
import { Timer } from './api/_utils/timer.js';
import { logger } from './api/_utils/logger.js';
import VAD from 'node-vad';

const app = express();
const PORT = 3001;

// Create HTTP server for WebSocket support
const server = createServer(app);

// Load cache on startup
loadCache()
  .then(() => {
    logger.log('API Server', 'Cache loaded successfully');
  })
  .catch((error) => {
    logger.error('API Server', 'Failed to load cache:', error);
  });

// -------------------------------------------------------------
// Middleware
// -------------------------------------------------------------

app.use(cors());
// Increase body size limit for audio uploads (50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logger - log all requests including /api/logo
app.use((req, _res, next) => {
  // Always log logo requests with full details
  if (req.url && req.url.startsWith('/api/logo')) {
    logger.log('API Server', `${req.method} ${req.url}`, {
      query: req.query,
      headers: {
        'user-agent': req.headers['user-agent'],
        'referer': req.headers['referer'],
      }
    });
  } else {
    logger.log('API Server', `${req.method} ${req.url}`);
  }
  next();
});

// -------------------------------------------------------------
// Helper: Convert Express req/res to Vercel format
// -------------------------------------------------------------

function createVercelRequest(req: express.Request) {
  return {
    method: req.method,
    query: req.query as Record<string, string>,
    body: req.body, // Include body for POST requests
    headers: req.headers, // Include headers for origin detection
    protocol: req.protocol, // Include protocol for origin detection
    get: (name: string) => req.get(name), // Include get method for headers
  };
}

function createVercelResponse(res: express.Response) {
  const vercelRes = {
    status: (code: number) => {
      res.status(code);
      return vercelRes;
    },
    json: (data: any) => {
      res.json(data);
    },
    send: (data: any) => {
      res.send(data);
    },
    redirect: (codeOrUrl: number | string, url?: string) => {
      if (typeof codeOrUrl === 'string') {
        res.redirect(307, codeOrUrl);
      } else {
        res.redirect(codeOrUrl, url || '');
      }
    },
    setHeader: (name: string, value: string) => {
      res.setHeader(name, value);
    },
    write: (data: any) => {
      res.write(data);
    },
    end: () => {
      res.end();
    },
  };
  return vercelRes;
}

// -------------------------------------------------------------
// API Routes
// -------------------------------------------------------------

// /api/logo - Logo handler (uses Express directly)
app.get('/api/logo', async (req, res) => {
  try {
    logger.log('API Server', 'Logo request received:', {
      url: req.query.url,
      stationId: req.query.stationId,
      stationName: req.query.stationName,
      domain: req.query.discoveryId,
      fallback: req.query.fallback,
      allParams: req.query
    });
    
    // Import and call handler directly with Express req/res
    // Note: Using .ts extension since we're running with tsx
    const { default: handler } = await import('./api/logo.ts');
    await handler(req, res);
  } catch (error) {
    logger.error('API Server', 'Logo error:', error);
    // Fallback: redirect to Google favicon (using google.com as universal fallback)
    // Extract domain from URL or use google.com
    let domain = 'google.com';
    const urlParam = (req.query.url as string) || '';
    if (urlParam) {
      try {
        const url = new URL(urlParam.startsWith('http') ? urlParam : `https://${urlParam}`);
        domain = url.hostname.replace('www.', '');
      } catch {
        // Invalid URL, use google.com
      }
    }
    const googleUrl = `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=256`;
    logger.log('API Server', 'Logo fallback redirect to:', googleUrl);
    res.redirect(307, googleUrl);
  }
});

// /api/radiobrowser - RadioBrowser API wrapper (handles all RadioBrowser calls server-side)
app.get('/api/radiobrowser', async (req, res) => {
  try {
    const { default: handler } = await import('./api/radiobrowser.js');
    await handler(req, res);
  } catch (error) {
    logger.error('API Server', 'RadioBrowser error:', error);
    res.status(500).json({ error: 'RadioBrowser API unavailable' });
  }
});

// /api/metadata - Metadata handler
app.get('/api/metadata', async (req, res) => {
  try {
    const stationId = req.query.stationId as string;
    const stationName = req.query.stationName as string;
    
    logger.log('API Server', `Metadata request - Station ID: ${stationId}, Station Name: ${stationName}`);
    
    if (!stationId) {
      return res.status(400).json({ error: 'Missing stationId parameter' });
    }
    
    // Dynamically import the handler
    const { default: handler } = await import('./api/metadata.ts');
    
    // Convert to Vercel format
    const vercelReq = createVercelRequest(req);
    const vercelRes = createVercelResponse(res);
    
    // Call handler
    await handler(vercelReq as any, vercelRes as any);
  } catch (error) {
    logger.error('API Server', 'Metadata error:', error);
    res.status(500).json({
      error: 'Failed to fetch metadata',
      title: null,
      artist: null,
      artwork_url: null,
      is_song: false,
    });
  }
});

// /api/artwork - Artwork proxy handler (uses Express directly)
app.get('/api/artwork', async (req, res) => {
  try {
    const url = req.query.url as string;
    
    if (!url) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }
    
    // Import and call handler directly with Express req/res
    const { default: handler } = await import('./api/artwork.ts');
    await handler(req, res);
  } catch (error) {
    logger.error('API Server', 'Artwork error:', error);
    res.status(500).json({ error: 'Failed to fetch artwork' });
  }
});

// /api/weather - Weather handler
app.get('/api/weather', async (req, res) => {
  try {
    const { default: handler } = await import('./api/weather.ts');
    const vercelReq = createVercelRequest(req);
    const vercelRes = createVercelResponse(res);
    await handler(vercelReq as any, vercelRes as any);
  } catch (error) {
    logger.error('API Server', 'Weather error:', error);
    res.status(500).json({ error: 'Failed to fetch weather' });
  }
});

// /api/geocode - Geocoding handler
app.get('/api/geocode', async (req, res) => {
  try {
    const { default: handler } = await import('./api/geocode.ts');
    const vercelReq = createVercelRequest(req);
    const vercelRes = createVercelResponse(res);
    await handler(vercelReq as any, vercelRes as any);
  } catch (error) {
    logger.error('API Server', 'Geocode error:', error);
    res.status(500).json({ error: 'Failed to geocode' });
  }
});

// /api/ai-audio - AI audio processing handler (streaming SSE)
app.post('/api/ai-audio', async (req, res) => {
  try {
    const { default: handler } = await import('./api/ai-audio.ts');
    const vercelReq = createVercelRequest(req);
    const vercelRes = createVercelResponse(res);
    
    // Don't await - handler will stream via res.write()
    handler(vercelReq as any, vercelRes as any).catch((error) => {
      logger.error('API Server', 'AI audio streaming error:', error);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'Failed to process audio',
          command: { type: 'unknown' },
          speak_text: 'sorry i had trouble understanding that',
        });
      }
    });
  } catch (error) {
    logger.error('API Server', 'AI audio error:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Failed to process audio',
        command: { type: 'unknown' },
        speak_text: 'sorry i had trouble understanding that',
      });
    }
  }
});

// /api/assemblyai-token - Get AssemblyAI temporary token (for browser SDK)
app.get('/api/assemblyai-token', async (req, res) => {
  try {
    const apiKey = process.env.ASSEMBLYAI_API_KEY || '';
    if (!apiKey) {
      return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY not configured' });
    }
    
    // Use AssemblyAI SDK to generate temporary token
    const { AssemblyAI } = await import('assemblyai');
    const client = new AssemblyAI({ apiKey });
    
    // Generate temporary token (valid for up to 10 minutes max)
    // Note: createTemporaryToken returns the token string directly
    // AssemblyAI limits expires_in_seconds to max 600 (10 minutes)
    const token = await client.streaming.createTemporaryToken({
      expires_in_seconds: 600, // 10 minutes (maximum allowed)
    });
    
    res.json({ token });
  } catch (error) {
    logger.error('API Server', 'AssemblyAI token error:', error);
    res.status(500).json({ error: 'Failed to get token' });
  }
});

// /api/ai-text - AI text processing handler (streaming SSE)
app.post('/api/ai-text', async (req, res) => {
  try {
    const { default: handler } = await import('./api/ai-text.ts');
    const vercelReq = createVercelRequest(req);
    const vercelRes = createVercelResponse(res);
    
    // Don't await - handler will stream via res.write()
    handler(vercelReq as any, vercelRes as any).catch((error) => {
      logger.error('API Server', 'AI text streaming error:', error);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'Failed to process text',
          command: { type: 'unknown' },
          speak_text: 'sorry i had trouble understanding that',
        });
      }
    });
  } catch (error) {
    logger.error('API Server', 'AI text error:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Failed to process text',
        command: { type: 'unknown' },
        speak_text: 'sorry i had trouble understanding that',
      });
    }
  }
});

// /api/tts - Text-to-speech handler
app.post('/api/tts', async (req, res) => {
  try {
    const { default: handler } = await import('./api/tts.ts');
    const vercelReq = createVercelRequest(req);
    const vercelRes = createVercelResponse(res);
    await handler(vercelReq as any, vercelRes as any);
  } catch (error) {
    logger.error('API Server', 'TTS error:', error);
    res.status(500).json({ error: 'Failed to generate TTS audio' });
  }
});

// /api/stations - UK radio stations (cached for 1 hour)
app.get('/api/stations', async (req, res) => {
  try {
    const { default: handler } = await import('./api/stations.ts');
    const vercelReq = createVercelRequest(req);
    const vercelRes = createVercelResponse(res);
    await handler(vercelReq as any, vercelRes as any);
  } catch (error) {
    logger.error('API Server', 'Stations error:', error);
    res.status(500).json({ error: 'Failed to fetch stations' });
  }
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// -------------------------------------------------------------
// WebSocket Server for VAD (Voice Activity Detection)
// -------------------------------------------------------------

const vadWss = new WebSocketServer({
  noServer: true,
});

vadWss.on('connection', (clientWs) => {
  logger.log('[VAD WS] Client connected');
  
  let vadStream: any = null;
  let isActive = false;

  try {
    // Use VAD stream API - it expects 16-bit PCM data
    vadStream = VAD.createStream({
      mode: VAD.Mode.VERY_AGGRESSIVE,
      audioFrequency: 16000,
      debounceTime: 1000, // 1 second debounce
    });
    logger.log('[VAD WS] node-vad stream initialized with VERY_AGGRESSIVE mode, 1000ms debounce');
    
    // Handle stream output
    vadStream.on('data', (data: any) => {
      if (!isActive) return;
      
      const speech = data.speech;
      if (speech.end) {
        // Speech has ended
        logger.log('[VAD WS] Speech ended, duration:', speech.duration, 'ms');
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'vad_result',
            result: VAD.Event.SILENCE,
            speechEnd: true,
            duration: speech.duration,
          }));
        }
      } else if (speech.start) {
        // Speech has started
        logger.log('[VAD WS] Speech started');
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'vad_result',
            result: VAD.Event.VOICE,
            speechStart: true,
          }));
        }
      } else if (speech.state) {
        // Currently speaking
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'vad_result',
            result: VAD.Event.VOICE,
          }));
        }
      } else {
        // Silence
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'vad_result',
            result: VAD.Event.SILENCE,
          }));
        }
      }
    });
    
    vadStream.on('error', (error: any) => {
      logger.error('[VAD WS] Stream error:', error);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'vad_error',
          error: error instanceof Error ? error.message : 'Unknown error',
        }));
      }
    });
  } catch (error) {
    logger.error('[VAD WS] Failed to initialize node-vad:', error);
    clientWs.close(1008, 'VAD initialization failed');
    return;
  }

  clientWs.on('message', async (data: Buffer) => {
    // Check if it's a control message (JSON) - try to parse first few bytes
    if (data.length < 100) {
      try {
        const message = JSON.parse(data.toString('utf8'));
        if (message.type === 'start') {
          isActive = true;
          logger.log('[VAD WS] VAD activated');
          clientWs.send(JSON.stringify({ type: 'started' }));
        } else if (message.type === 'stop') {
          isActive = false;
          logger.log('[VAD WS] VAD deactivated');
          clientWs.send(JSON.stringify({ type: 'stopped' }));
        }
        return;
      } catch {
        // Not JSON, treat as audio data
      }
    }
    
    // Process audio data
    if (!isActive) {
      return;
    }
    
    if (!vadStream) {
      logger.error('[VAD WS] Ignoring audio - VAD stream not initialized');
      return;
    }

    try {
      // Expect Float32Array audio data (32-bit floats = 4 bytes per sample)
      // WebSocket sends ArrayBuffer as Buffer
      const sampleCount = data.length / 4;
      if (sampleCount < 1 || data.length % 4 !== 0) {
        logger.warn('[VAD WS] Audio chunk invalid size:', data.length, 'bytes (must be multiple of 4)');
        return;
      }

      // Convert float32 to int16 PCM for the stream API
      // Float32Array values are normalized -1.0 to 1.0
      const float32Data = new Float32Array(data.buffer, data.byteOffset, sampleCount);
      const int16Data = new Int16Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        // Clamp and convert to int16 range (-32768 to 32767)
        const sample = Math.max(-1, Math.min(1, float32Data[i]));
        int16Data[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      }
      
      // Convert to Buffer and write to stream
      const pcmBuffer = Buffer.from(int16Data.buffer);
      vadStream.write(pcmBuffer);
    } catch (error) {
      logger.error('[VAD WS] Error writing to stream:', error);
      logger.error('[VAD WS] Audio chunk size:', data.length, 'bytes');
      if (error instanceof Error) {
        logger.error('[VAD WS] Error stack:', error.stack);
      }
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'vad_error',
          error: error instanceof Error ? error.message : 'Unknown error',
        }));
      }
    }
  });

  clientWs.on('close', () => {
    logger.log('[VAD WS] Client disconnected');
    isActive = false;
    // Clean up stream
    if (vadStream) {
      vadStream.end();
      vadStream = null;
    }
  });

  clientWs.on('error', (error) => {
    logger.error('[VAD WS] Client error:', error);
  });

  // Send ready message
  clientWs.send(JSON.stringify({ type: 'ready' }));
});

// -------------------------------------------------------------
// WebSocket Server for AssemblyAI Streaming Proxy
// -------------------------------------------------------------

const assemblyAiWss = new WebSocketServer({
  noServer: true,
});

assemblyAiWss.on('connection', (clientWs, req) => {
  logger.log('[AssemblyAI WS Proxy] Client connected');

  const assemblyAiApiKey = process.env.ASSEMBLYAI_API_KEY || '';
  if (!assemblyAiApiKey) {
    logger.error('[AssemblyAI WS Proxy] ASSEMBLYAI_API_KEY not configured');
    clientWs.close(1008, 'ASSEMBLYAI_API_KEY not configured');
    return;
  }

  // Parse query parameters from request URL
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const sampleRate = url.searchParams.get('sample_rate') || '16000';
  const encoding = url.searchParams.get('encoding') || 'pcm_s16le';
  const formatTurns = url.searchParams.get('format_turns') || 'true';

  // Build AssemblyAI WebSocket URL
  const assemblyAiParams = new URLSearchParams({
    sample_rate: sampleRate,
    encoding: encoding,
    format_turns: formatTurns,
  });
  const assemblyAiUrl = `wss://streaming.assemblyai.com/v3/ws?${assemblyAiParams.toString()}`;

  logger.log('[AssemblyAI WS Proxy] Connecting to AssemblyAI:', assemblyAiUrl);

  // Create WebSocket connection to AssemblyAI with Authorization header
  const assemblyAiWs = new WebSocket(assemblyAiUrl, {
    headers: {
      Authorization: assemblyAiApiKey,
    },
  });

  assemblyAiWs.on('open', () => {
    logger.log('[AssemblyAI WS Proxy] Connected to AssemblyAI');
  });

  assemblyAiWs.on('message', (data: Buffer) => {
    // Forward messages from AssemblyAI to client
    // AssemblyAI sends text JSON messages, so we should forward as text
    if (clientWs.readyState === WebSocket.OPEN) {
      // Check if it's text (JSON) or binary
      try {
        // Try to parse as JSON to verify it's text
        const text = data.toString('utf8');
        JSON.parse(text); // Verify it's valid JSON
        // Send as text
        clientWs.send(text);
        logger.log('[AssemblyAI WS Proxy] Forwarded text message to client:', text.substring(0, 100));
      } catch (e) {
        // Not JSON, send as binary
        clientWs.send(data);
        logger.log('[AssemblyAI WS Proxy] Forwarded binary message to client:', data.length, 'bytes');
      }
    }
  });

  assemblyAiWs.on('error', (error) => {
    logger.error('[AssemblyAI WS Proxy] AssemblyAI WebSocket error:', error);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({
        type: 'Error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  });

  assemblyAiWs.on('close', (code, reason) => {
    logger.log('[AssemblyAI WS Proxy] AssemblyAI WebSocket closed:', code, reason.toString());
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close();
    }
  });

  // Forward messages from client to AssemblyAI
  let audioChunkCount = 0;
  clientWs.on('message', (data: Buffer) => {
    if (assemblyAiWs.readyState === WebSocket.OPEN) {
      // Forward binary audio data or JSON messages
      assemblyAiWs.send(data);
      
      // Log audio forwarding periodically (every 100 chunks)
      audioChunkCount++;
      if (audioChunkCount % 100 === 0) {
        logger.log('[AssemblyAI WS Proxy] Forwarded audio chunk', audioChunkCount, 'to AssemblyAI (', data.length, 'bytes)');
      }
    }
  });

  clientWs.on('close', () => {
    logger.log('[AssemblyAI WS Proxy] Client disconnected');
    if (assemblyAiWs.readyState === WebSocket.OPEN || assemblyAiWs.readyState === WebSocket.CONNECTING) {
      // Send termination message before closing
      try {
        assemblyAiWs.send(JSON.stringify({ type: 'Terminate' }));
      } catch (error) {
        logger.warn('[AssemblyAI WS Proxy] Failed to send termination:', error);
      }
      assemblyAiWs.close();
    }
  });

  clientWs.on('error', (error) => {
    logger.error('[AssemblyAI WS Proxy] Client error:', error);
  });
});

// -------------------------------------------------------------
// WebSocket Server for Murf AI TTS Proxy
// -------------------------------------------------------------

const wss = new WebSocketServer({ 
  noServer: true,
});

wss.on('connection', (clientWs, req) => {
  logger.log('[Murf WS Proxy] Client connected');

  let murfWs: WebSocket | null = null;
  let contextId: string = `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  let messageQueue: string[] = [];
  let isConnected = false;

  let configSent = false;
  let configReady = false;
  let configReadyTimer: NodeJS.Timeout | null = null;
  let firstTextSent = false;
  let firstAudioReceived = false;

  // Create timer for this WebSocket connection
  const timer = new Timer(`murf_${contextId}`);
  timer.mark('Murf WS connection initiated', { context_id: contextId });

  const murfApiKey = process.env.MURF_API_KEY || '';
  if (!murfApiKey) {
    logger.error('[Murf WS Proxy] MURF_API_KEY not set');
    clientWs.close(1008, 'Server configuration error');
    return;
  }

  const murfWsUrl =
    `wss://global.api.murf.ai/v1/speech/stream-input` +
    `?api_key=${encodeURIComponent(murfApiKey)}` +
    `&model=FALCON&sample_rate=24000&channel_type=MONO&format=WAV`;

  logger.log('[Murf WS Proxy] Connecting to Murf AI WebSocket (Falcon model):',
    murfWsUrl.replace(murfApiKey, '***')
  );

  murfWs = new WebSocket(murfWsUrl);

  const flushQueue = (reason: string) => {
    if (!murfWs || murfWs.readyState !== WebSocket.OPEN) return;
    if (messageQueue.length === 0) return;

    logger.log(`[Murf WS Proxy] Flushing ${messageQueue.length} queued messages (${reason})`);
    
    // Ensure first message has voice_config if it's the first text message
    if (messageQueue.length > 0 && !firstTextSent) {
      try {
        const firstMsg = JSON.parse(messageQueue[0]);
        if (firstMsg.text !== undefined && !firstMsg.voice_config) {
          firstMsg.voice_config = {
            voice_id: 'Finley',
            style: 'Conversation',
            variation: 1,
            rate: 2,
            pitch: -5,
          };
          messageQueue[0] = JSON.stringify(firstMsg);
          firstTextSent = true;
          logger.log('[Murf WS Proxy] Added voice_config to first queued message');
        }
      } catch (e) {
        logger.warn('[Murf WS Proxy] Could not parse first queued message to add voice_config');
      }
    }
    
    for (const msg of messageQueue) {
      logger.log('[Murf WS Proxy] Sending queued message:', msg.substring(0, 200));
      murfWs.send(msg);
    }
    messageQueue = [];
  };

  murfWs.on('open', () => {
    logger.log('[Murf WS Proxy] Connected to Murf AI');
    timer.mark('Murf WS connected', { context_id: contextId });
    isConnected = true;

    // Voice config will be sent inline with first text message (more robust)
    // This avoids any "config not applied yet" race conditions
    configSent = true;
    configReady = true;
    flushQueue('connection ready');
  });

  murfWs.on('message', (data: Buffer) => {
    const rawMessage = data.toString();
    logger.log('[Murf WS Proxy] ===== RAW MESSAGE FROM MURF AI =====');
    logger.log('[Murf WS Proxy] Length:', rawMessage.length, 'chars');
    logger.log('[Murf WS Proxy] Raw content:', rawMessage.substring(0, 500));

    let message: any;
    try {
      message = JSON.parse(rawMessage);
      logger.log('[Murf WS Proxy] Parsed message keys:', Object.keys(message));
    } catch {
      logger.warn('[Murf WS Proxy] Non-JSON message from Murf AI');
      return;
    }

    // Any Murf frame after config => treat as ready and flush once
    if (configSent && !configReady) {
      configReady = true;
      if (configReadyTimer) clearTimeout(configReadyTimer);
      flushQueue('ack frame from Murf');
    }

    if (message.error) {
      logger.error('Murf WS Proxy', 'Murf AI error:', message.error);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ error: message.error }));
      }
      return;
    }

    if (message.audio !== undefined) {
      if (!firstAudioReceived) {
        timer.mark('first Murf audio frame received', { context_id: message.context_id });
        firstAudioReceived = true;
      }
      logger.log('Murf WS Proxy', 'Audio chunk received, forwarding to client');
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ audio: message.audio, context_id: message.context_id }));
      }
    } else if (message.final !== undefined) {
      timer.mark('Murf final received', { context_id: message.context_id });
      logger.log('Murf WS Proxy', 'Final message received, forwarding to client');
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ final: message.final, context_id: message.context_id }));
      }
    } else {
      logger.log('Murf WS Proxy', 'Non-audio message from Murf:', JSON.stringify(message));
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(message));
      }
    }
  });

  murfWs.on('error', (error) => {
    logger.error('[Murf WS Proxy] Murf AI connection error:', error);
    logger.error('[Murf WS Proxy] Error details:', error.message, error.stack);
    isConnected = false;
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ error: `Murf AI connection failed: ${error.message || 'Unknown error'}` }));
    }
  });

  murfWs.on('close', (code, reason) => {
    logger.log('[Murf WS Proxy] Murf AI connection closed:', code, reason?.toString() || '');
    logger.log('[Murf WS Proxy] Close code:', code, 'Reason:', reason);
    isConnected = false;
    messageQueue = [];
    
    // If connection closed unexpectedly, notify client
    if (code !== 1000 && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ error: `Murf AI connection closed unexpectedly: code ${code}` }));
    }
  });

  clientWs.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      logger.log('[Murf WS Proxy] Received from client:', JSON.stringify(message).substring(0, 100));

      if (message.text !== undefined) {
        // Build message without wrapper - send payload directly
        const murfMessage: any = {
          text: message.text,
          end: !!message.end,
          context_id: contextId,
        };

        // Include voice_config in first text message (more robust, avoids timing issues)
        if (!firstTextSent) {
          murfMessage.voice_config = {
            voice_id: 'Finley',
            style: 'Conversation',
            variation: 1,
            rate: 2,
            pitch: -5,
          };
          firstTextSent = true;
          logger.log('Murf WS Proxy', 'Including voice_config in first text message');
        }

        const messageStr = JSON.stringify(murfMessage);
        logger.log('Murf WS Proxy', 'Prepared message for Murf AI:', messageStr.substring(0, 200));
        logger.log('Murf WS Proxy', 'Message has voice_config:', !!murfMessage.voice_config);
        logger.log('Murf WS Proxy', 'Connection state - isConnected:', isConnected, 'configReady:', configReady, 'murfWs.readyState:', murfWs?.readyState);

        logger.log('Murf WS Proxy', 'Checking connection state:', {
          isConnected,
          configReady,
          murfWsExists: !!murfWs,
          murfWsState: murfWs?.readyState,
          murfWsStateName: murfWs?.readyState === 0 ? 'CONNECTING' : murfWs?.readyState === 1 ? 'OPEN' : murfWs?.readyState === 2 ? 'CLOSING' : murfWs?.readyState === 3 ? 'CLOSED' : 'UNKNOWN'
        });
        
        if (isConnected && configReady && murfWs && murfWs.readyState === WebSocket.OPEN) {
          try {
            murfWs.send(messageStr);
            logger.log('Murf WS Proxy', 'Message sent to Murf AI');
          } catch (sendError) {
            logger.error('Murf WS Proxy', 'Error sending to Murf AI:', sendError);
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ error: 'Failed to send message to Murf AI' }));
            }
          }
        } else {
          logger.log('Murf WS Proxy', 'Not ready, queuing message (queue size:', messageQueue.length, ')');
          messageQueue.push(messageStr);
          
          // Try to flush if connection becomes ready
          if (murfWs && murfWs.readyState === WebSocket.OPEN && isConnected && configReady) {
            flushQueue('retry after queue');
          }
        }
      }
    } catch (error) {
      logger.error('Murf WS Proxy', 'Error parsing client message:', error);
    }
  });

  clientWs.on('close', () => {
    logger.log('Murf WS Proxy', 'Client disconnected');
    if (murfWs && murfWs.readyState === WebSocket.OPEN) {
      murfWs.close();
    }
  });

  clientWs.on('error', (error) => {
    logger.error('Murf WS Proxy', 'Client error:', error);
  });
});

// 404 handler
app.use((_req, res) => {
  logger.log('API Server', `404 for: ${_req.url}`);
  res.status(404).json({ error: 'Not found' });
});

// -------------------------------------------------------------
// Handle WebSocket upgrade requests
// -------------------------------------------------------------

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

  if (pathname === '/api/vad') {
    vadWss.handleUpgrade(request, socket, head, (ws) => {
      vadWss.emit('connection', ws, request);
    });
  } else if (pathname === '/api/tts/murf-ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else if (pathname === '/api/assemblyai-proxy') {
    assemblyAiWss.handleUpgrade(request, socket, head, (ws) => {
      assemblyAiWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// -------------------------------------------------------------
// Start server
// -------------------------------------------------------------

server.listen(PORT, () => {
  logger.log(`✅ API server running on http://localhost:${PORT}`);
  logger.log('   Vite will proxy /api requests to this server');
  logger.log('   Routes: /api/logo, /api/radiobrowser, /api/metadata, /api/artwork, /api/weather, /api/ai-audio, /api/ai-text, /api/tts, /api/stations, /api/health');
  logger.log('   WebSocket: ws://localhost:3001/api/tts/murf-ws (Murf AI TTS proxy)');
  logger.log('   WebSocket: ws://localhost:3001/api/vad (Voice Activity Detection)');
  logger.log('   WebSocket: ws://localhost:3001/api/assemblyai-proxy (AssemblyAI streaming proxy)');
});
