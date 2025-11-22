import { VercelRequest, VercelResponse } from '@vercel/node';

interface WeatherResponse {
  temperature: number;
  location: string;
  condition?: string;
  error?: string;
}

// Tonbridge, UK coordinates: 51.1967, 0.2733
const TONBRIDGE_LAT = 51.1967;
const TONBRIDGE_LON = 0.2733;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600'); // Cache for 5 minutes
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Get coordinates from query params (required)
    const lat = req.query.lat ? Number.parseFloat(req.query.lat as string) : null;
    const lon = req.query.lon ? Number.parseFloat(req.query.lon as string) : null;
    const locationName = req.query.city ? (req.query.city as string) : 'Unknown Location';

    // Validate coordinates are provided
    if (lat === null || lon === null || Number.isNaN(lat) || Number.isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new Error('Invalid or missing coordinates');
    }

    // Use open-meteo.com free weather API (no API key required)
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Jamie Radio/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Weather API returned ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.current) {
      throw new Error('Invalid weather data');
    }

    const temperature = Math.round(data.current.temperature_2m);
    const weatherCode = data.current.weather_code;
    
    // Map weather codes to conditions (simplified)
    const conditionMap: Record<number, string> = {
      0: 'Clear',
      1: 'Mainly Clear',
      2: 'Partly Cloudy',
      3: 'Overcast',
      45: 'Foggy',
      48: 'Foggy',
      51: 'Light Drizzle',
      53: 'Drizzle',
      55: 'Heavy Drizzle',
      61: 'Light Rain',
      63: 'Rain',
      65: 'Heavy Rain',
      71: 'Light Snow',
      73: 'Snow',
      75: 'Heavy Snow',
      80: 'Light Showers',
      81: 'Showers',
      82: 'Heavy Showers',
      85: 'Snow Showers',
      86: 'Heavy Snow Showers',
      95: 'Thunderstorm',
      96: 'Thunderstorm',
      99: 'Thunderstorm',
    };

    const result: WeatherResponse = {
      temperature,
      location: locationName,
      condition: conditionMap[weatherCode] || 'Unknown',
    };

    return res.status(200).json(result);
  } catch (error) {
    console.error('[Weather API] Error:', error);
    const locationName = req.query.city ? (req.query.city as string) : 'Unknown Location';
    return res.status(500).json({
      temperature: null,
      location: locationName,
      error: 'Failed to fetch weather',
    });
  }
}

