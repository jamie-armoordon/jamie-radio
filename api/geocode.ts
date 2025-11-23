// api/geocode.ts
// Geocoding endpoint using Open-Meteo geocoding API
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest | any,
  res: VercelResponse | any
) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const name = String(req.query?.name || '');
    if (!name) {
      return res.status(400).json({ error: 'missing_name' });
    }

    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      name
    )}&count=5&language=en&format=json`;

    const r = await fetch(url);
    if (!r.ok) {
      return res.status(500).json({ error: 'geocoding_failed' });
    }

    const data = await r.json();
    return res.status(200).json(data);
  } catch (e: any) {
    return res.status(500).json({
      error: 'geocoding_error',
      message: e?.message || 'unknown_error',
    });
  }
}

