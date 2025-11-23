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

// JSON Schema for structured output
const COMMAND_SCHEMA = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      enum: ['play', 'next', 'previous', 'volume', 'mute', 'unmute', 'info', 'error'],
      description: 'The command type to execute',
    },
    station: {
      type: 'string',
      description: 'Station name if command is "play"',
    },
    action: {
      type: 'string',
      enum: ['up', 'down'],
      description: 'Volume action if command is "volume"',
    },
    message: {
      type: 'string',
      description: 'Information message if command is "info"',
    },
    text: {
      type: 'string',
      description: 'Natural language response to speak to the user',
    },
    error: {
      type: 'string',
      description: 'Error message if command is "error"',
    },
  },
  required: ['command', 'text'],
};

const getSystemInstruction = (stationList: string[] = []) => `You are Jarvis, the AI assistant inside JamieRadio.

You have the following controls:
- play(stationName) - Change to a specific station
- nextStation() - Switch to next station
- previousStation() - Switch to previous station
- setVolume(percent 0-100) - Set volume to specific level
- volumeUp() - Increase volume by 10%
- volumeDown() - Decrease volume by 10%
- mute() - Mute audio
- unmute() - Unmute audio
- getCurrentSong() - Get current playing track info

${stationList.length > 0 ? `Available stations: ${stationList.slice(0, 50).join(', ')}${stationList.length > 50 ? ` (and ${stationList.length - 50} more)` : ''}` : ''}

CRITICAL RULES:
1. If the user asks to PLAY a station (e.g., "play Capital FM", "switch to Heart", "put on Radio 1"), you MUST use command "play" with the station name.
2. ONLY use command "info" when the user explicitly asks "what's playing" or "what song is this" - NOT when they ask to play a station.
3. When matching station names, be flexible - "Capital FM", "Capital", "Capital UK" all refer to the same station.
4. ALWAYS respond in JSON ONLY matching the provided schema.
5. NEVER include explanations or natural language outside the "text" field.
6. Do not invent stations - only use station names from the available list above.
7. If user asks for a station not in the list, use command "error" with error message.
8. You must never break JSON format.
9. Include a "text" field with a natural language response to speak to the user (e.g., "ok got it now playing capital fm")
10. The wake word "Jarvis" may or may not be present in the audio - process commands regardless. Do NOT require the wake word to be present. If you hear a command, execute it even if "Jarvis" is not detected.

Response format examples:
- {"command": "play", "station": "Capital FM", "text": "ok got it now playing capital fm"}
- {"command": "play", "station": "Heart UK", "text": "switching to heart"}
- {"command": "volume", "action": "up", "text": "volume up"}
- {"command": "info", "message": "Sunset by Kygo", "text": "now playing sunset by kygo"}
- {"command": "error", "error": "station_not_found", "text": "sorry i couldn't find that station"}`;

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
    // Log body for debugging
    console.log('[AI Audio API] Request body:', req.body ? 'present' : 'missing');
    console.log('[AI Audio API] Body type:', typeof req.body);
    
    if (!req.body) {
      console.error('[AI Audio API] Request body is undefined!');
      return res.status(400).json({ 
        error: 'Request body is missing',
        command: 'error',
        text: 'sorry i had trouble processing that',
      });
    }
    
    const { audio, mimeType, stations } = req.body;

    if (!audio || typeof audio !== 'string') {
      console.error('[AI Audio API] Missing or invalid audio data');
      return res.status(400).json({ 
        error: 'Audio data is required',
        command: 'error',
        text: 'sorry i had trouble processing that',
      });
    }
    
    // Check if audio data is empty
    if (audio.length === 0) {
      console.error('[AI Audio API] Empty audio data received');
      return res.status(400).json({ 
        error: 'Empty audio data',
        command: 'error',
        text: 'sorry i didn\'t hear anything',
      });
    }
    
    console.log(`[AI Audio API] Received audio data: ${(audio.length * 3 / 4 / 1024).toFixed(2)}KB`);

    console.log(`[AI Audio API] Using API key: ${API_KEY.substring(0, 10)}...`);
    
    // Initialize new Google GenAI library
    const ai = new GoogleGenAI({ apiKey: API_KEY });

    // Convert mimeType to Gemini-compatible format
    let geminiMimeType = 'audio/webm';
    if (mimeType?.includes('mp3')) {
      geminiMimeType = 'audio/mp3';
    } else if (mimeType?.includes('wav')) {
      geminiMimeType = 'audio/wav';
    } else if (mimeType?.includes('ogg')) {
      geminiMimeType = 'audio/ogg';
    }

    // Get station list (array of station names)
    const stationNames: string[] = Array.isArray(stations) ? stations : [];
    
    // Create content with audio inline data (new library format)
    // Include system instruction and schema in the prompt
    const systemInstruction = getSystemInstruction(stationNames);
    const promptText = `${systemInstruction}\n\nListen to this audio and extract the voice command. Respond with ONLY valid JSON matching this schema: ${JSON.stringify(COMMAND_SCHEMA)}. Return only the JSON object, no other text.`;
    
    const contents = [
      {
        text: promptText,
      },
      {
        inlineData: {
          mimeType: geminiMimeType,
          data: audio,
        },
      },
    ];

    console.log(`[AI Audio API] Sending to Gemini with mimeType: ${geminiMimeType}`);
    
    let response;
    try {
      // New library API - use generateContent with model and contents
      response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contents,
      });
    } catch (geminiError: any) {
      console.error('[AI Audio API] Gemini API error:', geminiError);
      console.error('[AI Audio API] Error details:', geminiError.message, geminiError.stack);
      throw geminiError;
    }

    let text = response.text;

    // Strip markdown code blocks if present (```json ... ```)
    text = text.trim();
    if (text.startsWith('```')) {
      // Remove opening ```json or ```
      text = text.replace(/^```(?:json)?\s*\n?/, '');
      // Remove closing ```
      text = text.replace(/\n?```\s*$/, '');
    }

    // Parse JSON response
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      console.error('Response text:', text);
      return res.status(500).json({ 
        error: 'invalid_json',
        command: 'error',
        text: 'sorry i had trouble processing that',
      });
    }

    // Generate TTS audio for the response text
    let audioData: string | null = null;
    if (parsed.text && parsed.text.trim().length > 0) {
      try {
        console.log('[AI Audio API] Generating TTS audio for:', parsed.text);
        // Try simplified config - remove speechConfig for now to test basic TTS
        const ttsResponse: any = await ai.models.generateContent({
          model: 'gemini-2.5-flash-preview-tts',
          contents: parsed.text,
          config: {
            responseModalities: ['AUDIO'],
            // speechConfig removed - will use default voice
            // Can add voice selection later once basic TTS works
          } as any,
        });

        // Extract audio data from response
        // The response structure may vary - check for audio in different formats
        if (ttsResponse.audio) {
          // If audio is already a Buffer or Uint8Array
          const audioBuffer = Buffer.isBuffer(ttsResponse.audio) 
            ? ttsResponse.audio 
            : Buffer.from(ttsResponse.audio);
          audioData = audioBuffer.toString('base64');
          if (audioData) {
            console.log('[AI Audio API] TTS audio generated:', audioData.length, 'bytes (base64)');
          }
        } else if (ttsResponse.response && ttsResponse.response.audio) {
          // Check nested response structure
          const audioBuffer = Buffer.isBuffer(ttsResponse.response.audio)
            ? ttsResponse.response.audio
            : Buffer.from(ttsResponse.response.audio);
          audioData = audioBuffer.toString('base64');
          if (audioData) {
            console.log('[AI Audio API] TTS audio generated from response:', audioData.length, 'bytes (base64)');
          }
        } else if (ttsResponse.candidates && ttsResponse.candidates[0]?.content?.parts) {
          // Check for audio in candidates structure
          const parts = ttsResponse.candidates[0].content.parts;
          for (const part of parts) {
            if (part.inlineData && part.inlineData.mimeType?.startsWith('audio/')) {
              console.log('[AI Audio API] Found audio in part.inlineData, mimeType:', part.inlineData.mimeType);
              let rawAudioData = part.inlineData.data || null;
              
              if (rawAudioData) {
                // If it's PCM format (L16), convert to WAV
                if (part.inlineData.mimeType.includes('L16') || part.inlineData.mimeType.includes('pcm')) {
                  console.log('[AI Audio API] Converting PCM to WAV format');
                  // Extract sample rate from mimeType (e.g., "audio/L16;codec=pcm;rate=24000")
                  const rateMatch = part.inlineData.mimeType.match(/rate=(\d+)/);
                  const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
                  
                  // Decode base64 PCM data
                  const pcmData = Buffer.from(rawAudioData, 'base64');
                  
                  // Convert PCM to WAV by adding WAV header
                  audioData = convertPCMToWAV(pcmData, sampleRate);
                  if (audioData) {
                    console.log('[AI Audio API] Converted to WAV, length:', audioData.length);
                  }
                } else {
                  // Already in a playable format
                  audioData = rawAudioData;
                }
              }
              break;
            }
          }
        } else {
          console.warn('[AI Audio API] No audio data in TTS response. Response keys:', Object.keys(ttsResponse));
        }
      } catch (ttsError: any) {
        console.error('[AI Audio API] TTS generation failed:', ttsError);
        console.error('[AI Audio API] TTS error details:', ttsError.message, ttsError.stack);
        // Continue without audio - client can fallback
      }
    }

    // Return JSON with audio data if available
    return res.status(200).json({
      ...parsed,
      audio: audioData, // Base64 encoded audio (WAV format)
    });
  } catch (error: any) {
    console.error('[AI Audio API] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to process audio',
      command: 'error',
      text: 'sorry i had trouble understanding that',
      message: error.message 
    });
  }
}

