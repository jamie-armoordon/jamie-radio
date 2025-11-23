/**
 * RadioBrowser API Backend Wrapper
 * Handles all RadioBrowser API calls server-side to avoid browser network errors
 */

import type { Request, Response } from 'express';

// RadioBrowser API mirrors for redundancy
const MIRRORS = [
  'https://at1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://de1.api.radio-browser.info',
];

const TIMEOUT_MS = 5000;

/**
 * Try a RadioBrowser API call with mirror fallback
 */
async function tryRadioBrowserRequest(path: string): Promise<any> {
  for (const base of MIRRORS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
      
      const url = `${base}${path}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      // Silently try next mirror - network errors are expected when mirrors are down
      continue;
    }
  }
  
  // All mirrors failed
  return null;
}

/**
 * Search stations by name
 * GET /api/radiobrowser/search?name=StationName&countrycode=GB&limit=1
 */
export async function searchStations(req: Request, res: Response): Promise<void> {
  try {
    const name = (req.query.name as string) || '';
    const countrycode = (req.query.countrycode as string) || 'GB';
    const limit = (req.query.limit as string) || '1';
    const order = (req.query.order as string) || 'clickcount';
    const reverse = (req.query.reverse as string) || 'true';
    const hidebroken = (req.query.hidebroken as string) || 'true';
    
    if (!name) {
      res.status(400).json({ error: 'Missing name parameter' });
      return;
    }
    
    const searchName = encodeURIComponent(name);
    const path = `/json/stations/search?name=${searchName}&countrycode=${countrycode}&limit=${limit}&order=${order}&reverse=${reverse}&hidebroken=${hidebroken}`;
    
    const data = await tryRadioBrowserRequest(path);
    
    if (data === null) {
      res.json([]);
      return;
    }
    
    res.json(data);
  } catch (error) {
    console.error('[RadioBrowser API] Search error:', error);
    res.json([]);
  }
}

/**
 * Resolve stream by UUID
 * GET /api/radiobrowser/uuid?uuid=station-uuid
 */
export async function getByUUID(req: Request, res: Response): Promise<void> {
  try {
    const uuid = (req.query.uuid as string) || '';
    
    if (!uuid) {
      res.status(400).json({ error: 'Missing uuid parameter' });
      return;
    }
    
    const path = `/json/stations/byuuid/${uuid}`;
    const data = await tryRadioBrowserRequest(path);
    
    if (data === null || !Array.isArray(data) || data.length === 0) {
      res.json(null);
      return;
    }
    
    res.json(data[0]);
  } catch (error) {
    console.error('[RadioBrowser API] UUID lookup error:', error);
    res.json(null);
  }
}

/**
 * Main handler - routes to appropriate function
 */
export default async function handler(req: Request, res: Response): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  const action = req.query.action as string;
  
  if (action === 'search') {
    await searchStations(req, res);
  } else if (action === 'uuid') {
    await getByUUID(req, res);
  } else {
    res.status(400).json({ error: 'Invalid action. Use ?action=search or ?action=uuid' });
  }
}
