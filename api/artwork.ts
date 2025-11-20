import type { Request, Response } from 'express';
import { fetchImageBuffer } from './_utils/fetchImage';

/**
 * Artwork proxy endpoint
 * Proxies artwork URLs to avoid CORS issues
 * GET /api/artwork?url=https://example.com/image.jpg
 */
export default async function handler(req: Request, res: Response): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
  
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
    const imageData = await fetchImageBuffer(url, 10000);
    
    if (!imageData) {
      console.log('[Artwork Proxy] Image not found or invalid');
      res.status(404).json({ error: 'Image not found or invalid' });
      return;
    }

    console.log('[Artwork Proxy] Successfully fetched artwork, content-type:', imageData.contentType);
    res.setHeader('Content-Type', imageData.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    res.send(imageData.buffer);
  } catch (error) {
    console.error('[Artwork Proxy] Error:', error);
    if (error instanceof Error) {
      console.error('[Artwork Proxy] Error message:', error.message);
      console.error('[Artwork Proxy] Error stack:', error.stack);
    }
    res.status(500).json({ error: 'Failed to fetch artwork', details: error instanceof Error ? error.message : 'Unknown error' });
  }
}

