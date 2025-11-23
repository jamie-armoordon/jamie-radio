import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Artwork proxy endpoint
 * Proxies artwork URLs to avoid CORS issues
 * GET /api/artwork?url=https://example.com/image.jpg
 * 
 * Uses blob/arrayBuffer pattern for Vercel compatibility
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const url = req.query.url as string;
  
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Missing url parameter' });
    return;
  }

  try {
    console.log('[Artwork Proxy] Fetching artwork from:', url);
    
    // Fetch the image with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    // Check if response is OK
    if (!response.ok) {
      console.log('[Artwork Proxy] Response not OK:', response.status, response.statusText);
      res.status(404).json({ error: 'Image not found or invalid' });
      return;
    }
    
    // Check content type
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      console.log('[Artwork Proxy] Invalid content-type:', contentType);
      res.status(404).json({ error: 'Invalid content type' });
      return;
    }
    
    // Convert response to blob, then to arrayBuffer, then to Buffer
    // This pattern works better with Vercel functions
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    console.log('[Artwork Proxy] Successfully fetched artwork, content-type:', contentType, 'size:', buffer.length);
    
    // Set headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    
    // Send buffer
    res.send(buffer);
  } catch (error) {
    console.error('[Artwork Proxy] Error:', error);
    if (error instanceof Error) {
      console.error('[Artwork Proxy] Error message:', error.message);
      console.error('[Artwork Proxy] Error stack:', error.stack);
    }
    
    // Return 404 instead of 500 for better UX (image not found is not a server error)
    res.status(404).json({ error: 'Failed to fetch artwork', details: error instanceof Error ? error.message : 'Unknown error' });
  }
}
