// Simple API server for Vite development
// Run with: npm run dev:api or tsx api-server.ts
// This runs on port 3001 and handles /api/metadata requests

import { createServer } from 'http';

// Import the metadata handler
async function handleMetadata(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  try {
    // Parse query string
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const stationId = url.searchParams.get('stationId');

    if (!stationId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing stationId parameter' }));
      return;
    }

    // Dynamically import the handler (tsx can handle .ts imports)
    const { default: handler } = await import('./api/metadata.ts');
    
    // Create mock Vercel request/response objects
    const vercelReq = {
      method: req.method,
      query: { stationId },
    };

    let responseData = null;
    let statusCode = 200;

    const vercelRes = {
      status: (code: number) => {
        statusCode = code;
        return vercelRes;
      },
      json: (data: any) => {
        responseData = data;
      },
    };

    await handler(vercelReq, vercelRes);

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(responseData));
  } catch (error) {
    console.error('API Error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      error: 'Failed to fetch metadata',
      title: null,
      artist: null,
      artwork_url: null,
      is_song: false,
    }));
  }
}

const server = createServer((req, res) => {
  if (req.url?.startsWith('/api/metadata')) {
    handleMetadata(req, res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`✅ API server running on http://localhost:${PORT}`);
  console.log('   Vite will proxy /api requests to this server');
});

