import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = 'AIzaSyCDsJFpXMwSpHhKoGjlcTjuAcw4t-WkGNI';

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

const SYSTEM_INSTRUCTION = `You are Jamie, the AI assistant inside JamieRadio.

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
- listStations() - List available stations

Rules:
1. ALWAYS respond in JSON ONLY matching the provided schema.
2. NEVER include explanations or natural language outside the "text" field.
3. Do not invent stations - only use real station names.
4. If user asks for something unavailable, use command "error" with error message.
5. You must never break JSON format.
6. Include a "text" field with a natural language response to speak to the user (e.g., "ok got it now playing capital fm")
7. Listen for the wake word "Jamie" at the start - ignore commands without it.

Response format examples:
- {"command": "play", "station": "Capital FM", "text": "ok got it now playing capital fm"}
- {"command": "volume", "action": "up", "text": "volume up"}
- {"command": "info", "message": "Sunset by Kygo", "text": "now playing sunset by kygo"}
- {"command": "error", "error": "unknown_command", "text": "sorry i didn't understand that"}`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { audio, mimeType } = req.body;

    if (!audio || typeof audio !== 'string') {
      return res.status(400).json({ error: 'Audio data is required' });
    }

    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
    });

    // Convert mimeType to Gemini-compatible format
    let geminiMimeType = 'audio/webm';
    if (mimeType?.includes('mp3')) {
      geminiMimeType = 'audio/mp3';
    } else if (mimeType?.includes('wav')) {
      geminiMimeType = 'audio/wav';
    } else if (mimeType?.includes('ogg')) {
      geminiMimeType = 'audio/ogg';
    }

    // Create content with audio inline data
    // Format: array of parts (inlineData and text)
    const contents = [
      {
        inlineData: {
          mimeType: geminiMimeType,
          data: audio,
        },
      },
      {
        text: 'Listen to this audio and extract the voice command. Respond with the command in JSON format.',
      },
    ] as any;

    const response = await model.generateContent({
      contents,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: COMMAND_SCHEMA as any,
      },
      systemInstruction: SYSTEM_INSTRUCTION,
    });

    const result = response.response;
    const text = result.text();

    // Parse and return JSON
    try {
      const parsed = JSON.parse(text);
      return res.status(200).json(parsed);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      return res.status(500).json({ 
        error: 'invalid_json',
        command: 'error',
        text: 'sorry i had trouble processing that',
      });
    }
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

