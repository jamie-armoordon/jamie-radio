/**
 * Stations API Endpoint
 * Returns UK radio stations with 1-hour caching
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUKStations } from '../src/services/ukStations.js';
import type { RadioStation } from '../src/types/station.js';

// In-memory cache
let cachedStations: RadioStation[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

export default async function handler(req: VercelRequest | Request | any, res: VercelResponse | Response | any) {
  // Handle both Express and Vercel request formats
  if (res.setHeader) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const now = Date.now();
    
    // Check if cache is valid (less than 1 hour old)
    if (cachedStations && (now - cacheTimestamp) < CACHE_DURATION) {
      console.log(`[Stations API] Returning cached stations (${cachedStations.length} stations, age: ${Math.round((now - cacheTimestamp) / 1000 / 60)} minutes)`);
      return res.status(200).json(cachedStations);
    }

    // Cache expired or doesn't exist, fetch fresh stations
    console.log('[Stations API] Cache expired or missing, fetching fresh stations...');
    const stations = await getUKStations();
    
    // Update cache
    cachedStations = stations;
    cacheTimestamp = now;
    
    console.log(`[Stations API] Fetched and cached ${stations.length} stations`);
    return res.status(200).json(stations);
  } catch (error: any) {
    console.error('[Stations API] Error:', error);
    
    // If we have stale cache, return it as fallback
    if (cachedStations && cachedStations.length > 0) {
      console.warn('[Stations API] Returning stale cache due to error');
      return res.status(200).json(cachedStations);
    }
    
    return res.status(500).json({ 
      error: 'Failed to fetch stations',
      message: error.message 
    });
  }
}

