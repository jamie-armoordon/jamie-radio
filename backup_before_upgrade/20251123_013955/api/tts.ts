import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';

const API_KEY = 'AIzaSyDsmn62Ux5MgplmuEwgthbsYp7-G5CIR84';

/**
 * Convert raw PCM audio data to WAV format by adding WAV header
 */
function convertPCMToWAV(pcmData: Buffer, sampleRate: number): string {
  const numChannels = 1; // Mono
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const fileSize = 36 + dataSize; // 36 = header size, dataSize = PCM data size

  // Create WAV header
  const header = Buffer.alloc(44);
  
  // RIFF header
  header.write('RIFF', 0);
  header.writeUInt32LE(fileSize, 4);
  header.write('WAVE', 8);
  
  // fmt chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // audio format (1 = PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  
  // data chunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  
  // Combine header + PCM data and encode to base64
  const wavBuffer = Buffer.concat([header, pcmData]);
  return wavBuffer.toString('base64');
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
    const { text, voice = 'Kore' } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text is required' });
    }

    console.log(`[TTS API] Generating audio for text: "${text.substring(0, 50)}..." with voice: ${voice}`);

    const ai = new GoogleGenAI({ apiKey: API_KEY });

    // Try different config formats - the API structure may vary
    // Try simplified config - the API might not support voice selection yet
    // or the format might be different
    const ttsResponse: any = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: text,
      config: {
        responseModalities: ['AUDIO'],
        // speechConfig might not be needed or might have different structure
        // Try without it first, or with minimal config
      } as any,
    });

    // Extract audio data from response
    let audioData: string | null = null;
    
    console.log('[TTS API] Response structure keys:', Object.keys(ttsResponse));
    console.log('[TTS API] Response type:', typeof ttsResponse);
    
    // The response structure may vary - check for audio in different formats
    if (ttsResponse.audio) {
      console.log('[TTS API] Found audio in ttsResponse.audio, type:', typeof ttsResponse.audio);
      const audioBuffer = Buffer.isBuffer(ttsResponse.audio) 
        ? ttsResponse.audio 
        : Buffer.from(ttsResponse.audio);
      audioData = audioBuffer.toString('base64');
    } else if (ttsResponse.response && ttsResponse.response.audio) {
      console.log('[TTS API] Found audio in ttsResponse.response.audio');
      const audioBuffer = Buffer.isBuffer(ttsResponse.response.audio)
        ? ttsResponse.response.audio
        : Buffer.from(ttsResponse.response.audio);
      audioData = audioBuffer.toString('base64');
    } else if (ttsResponse.candidates && ttsResponse.candidates[0]?.content?.parts) {
      console.log('[TTS API] Checking candidates structure');
      // Check for audio in candidates structure
      const parts = ttsResponse.candidates[0].content.parts;
      for (const part of parts) {
        console.log('[TTS API] Part keys:', Object.keys(part));
        if (part.inlineData && part.inlineData.mimeType?.startsWith('audio/')) {
          console.log('[TTS API] Found audio in part.inlineData, mimeType:', part.inlineData.mimeType);
          // inlineData.data is already base64, use it directly
          let rawAudioData = part.inlineData.data || null;
          
          if (rawAudioData) {
            console.log('[TTS API] Raw audio data length from inlineData:', rawAudioData.length);
            
            // If it's PCM format (L16), convert to WAV
            if (part.inlineData.mimeType.includes('L16') || part.inlineData.mimeType.includes('pcm')) {
              console.log('[TTS API] Converting PCM to WAV format');
              // Extract sample rate from mimeType (e.g., "audio/L16;codec=pcm;rate=24000")
              const rateMatch = part.inlineData.mimeType.match(/rate=(\d+)/);
              const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
              
              // Decode base64 PCM data
              const pcmData = Buffer.from(rawAudioData, 'base64');
              
              // Convert PCM to WAV by adding WAV header
              audioData = convertPCMToWAV(pcmData, sampleRate);
              console.log('[TTS API] Converted to WAV, length:', audioData.length);
            } else {
              // Already in a playable format
              audioData = rawAudioData;
            }
          }
          break;
        }
      }
    } else {
      // Try to find audio in any nested structure
      console.log('[TTS API] Searching for audio in response...');
      const searchForAudio = (obj: any, path = ''): string | null => {
        if (!obj || typeof obj !== 'object') return null;
        if (obj.data && typeof obj.data === 'string' && obj.data.length > 1000) {
          console.log(`[TTS API] Found potential audio data at: ${path}.data, length:`, obj.data.length);
          return obj.data;
        }
        if (obj.audio && typeof obj.audio === 'string' && obj.audio.length > 1000) {
          console.log(`[TTS API] Found potential audio data at: ${path}.audio, length:`, obj.audio.length);
          return obj.audio;
        }
        for (const key in obj) {
          if (obj.hasOwnProperty(key)) {
            const result = searchForAudio(obj[key], `${path}.${key}`);
            if (result) return result;
          }
        }
        return null;
      };
      audioData = searchForAudio(ttsResponse, 'ttsResponse');
    }
    
    // If still no audio found, log the full response structure for debugging
    if (!audioData) {
      console.log('[TTS API] Full response structure:', JSON.stringify(ttsResponse, null, 2).substring(0, 500));
    }

    if (!audioData) {
      console.error('[TTS API] No audio data found in response. Response keys:', Object.keys(ttsResponse));
      return res.status(500).json({ error: 'No audio data in TTS response' });
    }

    console.log(`[TTS API] Audio generated successfully: ${audioData.length} bytes (base64)`);

    return res.status(200).json({
      audio: audioData,
      format: 'wav', // Gemini TTS typically returns WAV
    });
  } catch (error: any) {
    console.error('[TTS API] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to generate TTS audio',
      message: error.message 
    });
  }
}

