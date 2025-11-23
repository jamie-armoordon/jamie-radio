import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Generate TTS using Murf AI Gen 2 (high-quality, natural radio-like voice)
 * Uses Gen 2 model with Narration style for professional radio host voice
 * Set MURF_API_KEY environment variable for authentication
 */
async function generateMurfGen2TTS(text: string): Promise<string> {
  try {
    console.log('[TTS API] Using Murf AI Gen 2 TTS for:', text.substring(0, 50));
    
    const murfApiKey = process.env.MURF_API_KEY || '';
    if (!murfApiKey) {
      throw new Error('MURF_API_KEY environment variable not set. Murf AI TTS requires API key.');
    }
    
    // Use a professional male radio voice with Narration style for natural, expressive speech
    const voiceId = 'en-UK-theo'; // Theo voice - professional male, supports Narration style
    const style = 'Narration'; // Narration style for professional radio host voice
    
    // Use the correct Murf AI Gen 2 streaming endpoint
    const endpoint = 'https://api.murf.ai/v1/speech/stream';
    
    console.log(`[TTS API] Calling Murf AI Gen 2 endpoint: ${endpoint}`);
    console.log(`[TTS API] Voice: ${voiceId}, Style: ${style}`);
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'api-key': murfApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text,
        voice_id: voiceId,
        model: 'gen2', // Gen 2 model - higher quality, more natural
        language: 'en-UK', // UK English for Theo voice
        style: style, // Narration style for professional radio host
        variation: 5, // Maximum variation for natural, dynamic speech (reduces robotic sound)
        rate: 2, // Slightly faster for energetic radio feel (-50 to 50, default 0)
        pitch: -5, // Slightly deeper for authoritative radio voice (-50 to 50, default 0)
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Murf AI TTS API error: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    // Streaming endpoint returns audio directly as a stream
    // Read the entire stream and convert to base64
    const arrayBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');
    
    console.log('[TTS API] Murf AI Gen 2 TTS generated successfully:', base64Audio.length, 'bytes (base64)');
    return base64Audio;
  } catch (error: any) {
    console.error('[TTS API] Murf AI Gen 2 TTS failed:', error);
    throw error;
  }
}

export default async function handler(req: VercelRequest | any, res: VercelResponse | any) {
  // Handle both Express and Vercel request formats
  if (res.setHeader) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Always use Murf AI Gen 2
    const audioData = await generateMurfGen2TTS(text);
    return res.status(200).json({
      audio: audioData,
      format: 'wav',
      provider: 'murf',
    });
  } catch (error: any) {
    console.error('[TTS API] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to generate TTS audio',
      message: error.message,
    });
  }
}
