// API server for Vite development
// Run with: npm run dev:api or tsx api-server.ts
// This runs on port 3001 and handles /api/* requests

import express from 'express';
import cors from 'cors';
import { loadCache } from './api/_utils/cache.js';

const app = express();
const PORT = 3001;

// Load cache on startup
loadCache()
  .then(() => {
    console.log('[API Server] Cache loaded successfully');
  })
  .catch((error) => {
    console.error('[API Server] Failed to load cache:', error);
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
    console.log(`[API Server] ${req.method} ${req.url}`, {
      query: req.query,
      headers: {
        'user-agent': req.headers['user-agent'],
        'referer': req.headers['referer'],
      }
    });
  } else {
    console.log(`[API Server] ${req.method} ${req.url}`);
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
    console.log('[API Server] Logo request received:', {
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
    console.error('[API Server] Logo error:', error);
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
    console.log('[API Server] Logo fallback redirect to:', googleUrl);
    res.redirect(307, googleUrl);
  }
});

// /api/radiobrowser - RadioBrowser API wrapper (handles all RadioBrowser calls server-side)
app.get('/api/radiobrowser', async (req, res) => {
  try {
    const { default: handler } = await import('./api/radiobrowser.js');
    await handler(req, res);
  } catch (error) {
    console.error('[API Server] RadioBrowser error:', error);
    res.status(500).json({ error: 'RadioBrowser API unavailable' });
  }
});

// /api/metadata - Metadata handler
app.get('/api/metadata', async (req, res) => {
  try {
    const stationId = req.query.stationId as string;
    const stationName = req.query.stationName as string;
    
    console.log(`[API Server] Metadata request - Station ID: ${stationId}, Station Name: ${stationName}`);
    
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
    console.error('[API Server] Metadata error:', error);
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
    console.error('[API Server] Artwork error:', error);
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
    console.error('[API Server] Weather error:', error);
    res.status(500).json({ error: 'Failed to fetch weather' });
  }
});

// /api/ai-audio - AI audio processing handler
app.post('/api/ai-audio', async (req, res) => {
  try {
    const { default: handler } = await import('./api/ai-audio.ts');
    const vercelReq = createVercelRequest(req);
    const vercelRes = createVercelResponse(res);
    await handler(vercelReq as any, vercelRes as any);
  } catch (error) {
    console.error('[API Server] AI audio error:', error);
    res.status(500).json({ 
      error: 'Failed to process audio',
      command: 'error',
      text: 'sorry i had trouble understanding that',
    });
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
    console.error('[API Server] TTS error:', error);
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
    console.error('[API Server] Stations error:', error);
    res.status(500).json({ error: 'Failed to fetch stations' });
  }
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// 404 handler
app.use((_req, res) => {
  console.log(`[API Server] 404 for: ${_req.url}`);
  res.status(404).json({ error: 'Not found' });
});

// -------------------------------------------------------------
// Start server
// -------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`✅ API server running on http://localhost:${PORT}`);
  console.log('   Vite will proxy /api requests to this server');
  console.log('   Routes: /api/logo, /api/radiobrowser, /api/metadata, /api/artwork, /api/weather, /api/ai-audio, /api/tts, /api/stations, /api/health');
});
