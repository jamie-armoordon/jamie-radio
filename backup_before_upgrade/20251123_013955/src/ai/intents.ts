/**
 * Intent Parser using Gemini 2.5 Flash
 * Parses voice commands into structured JSON
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

export type IntentType = 'play' | 'volume' | 'next' | 'previous' | 'stop' | 'unknown';
export type VolumeAction = 'up' | 'down' | 'set';

export interface ParsedIntent {
  intent: IntentType;
  station?: string;
  volumeLevel?: number;
  volumeAction?: VolumeAction;
  confidence?: number;
}

const SYSTEM_PROMPT = `You are an intent parser for a radio application. Parse the user's voice command and return ONLY valid JSON, no other text.

Valid intents:
- "play" - Play a station (requires station name)
- "volume" - Adjust volume (requires volumeAction: "up", "down", or "set" with volumeLevel 0-100)
- "next" - Next station
- "previous" - Previous station
- "stop" - Stop playback
- "unknown" - Cannot determine intent

Response format (JSON only):
{
  "intent": "play" | "volume" | "next" | "previous" | "stop" | "unknown",
  "station": "station name" (only for play intent),
  "volumeLevel": 0-100 (only for volume intent with "set" action),
  "volumeAction": "up" | "down" | "set" (only for volume intent)
}

Examples:
User: "play Capital FM"
Response: {"intent": "play", "station": "Capital FM"}

User: "volume up"
Response: {"intent": "volume", "volumeAction": "up"}

User: "set volume to 50"
Response: {"intent": "volume", "volumeAction": "set", "volumeLevel": 50}

User: "next station"
Response: {"intent": "next"}

User: "Jamie play BBC Radio 1"
Response: {"intent": "play", "station": "BBC Radio 1"}

User: "Jamie volume down"
Response: {"intent": "volume", "volumeAction": "down"}

Always return valid JSON only, no markdown, no code blocks, no explanation.`;

/**
 * Parse voice command transcript into structured intent
 * @param transcript Text transcript of voice command
 * @param apiKey Gemini API key (from environment or config)
 * @returns Parsed intent or null on error
 */
export async function parseIntent(
  transcript: string,
  apiKey?: string
): Promise<ParsedIntent | null> {
  if (!transcript || transcript.trim().length === 0) {
    return { intent: 'unknown' };
  }

  // Remove "Jamie" wake word if present
  const cleanedTranscript = transcript
    .replace(/^jamie\s+/i, '')
    .trim();

  if (!cleanedTranscript) {
    return { intent: 'unknown' };
  }

  try {
    // Get API key from environment or parameter
    const key = apiKey || import.meta.env.VITE_GEMINI_API_KEY;
    if (!key) {
      console.warn('[intents] Gemini API key not found, using fallback parser');
      return parseIntentFallback(cleanedTranscript);
    }

    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.1, // Low temperature for consistent parsing
        maxOutputTokens: 200,
        responseMimeType: 'application/json',
      },
    });

    const prompt = `${SYSTEM_PROMPT}\n\nUser command: "${cleanedTranscript}"\n\nResponse:`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    // Parse JSON response
    try {
      const parsed = JSON.parse(text) as ParsedIntent;
      
      // Validate intent
      const validIntents: IntentType[] = ['play', 'volume', 'next', 'previous', 'stop', 'unknown'];
      if (!validIntents.includes(parsed.intent)) {
        parsed.intent = 'unknown';
      }

      // Validate volume action
      if (parsed.intent === 'volume') {
        const validActions: VolumeAction[] = ['up', 'down', 'set'];
        if (parsed.volumeAction && !validActions.includes(parsed.volumeAction)) {
          parsed.volumeAction = 'up'; // Default
        }
        if (parsed.volumeAction === 'set' && (!parsed.volumeLevel || parsed.volumeLevel < 0 || parsed.volumeLevel > 100)) {
          parsed.volumeLevel = 50; // Default
        }
      }

      return parsed;
    } catch (parseError) {
      console.error('[intents] Failed to parse Gemini JSON response:', parseError);
      return parseIntentFallback(cleanedTranscript);
    }
  } catch (error) {
    console.error('[intents] Gemini API error:', error);
    return parseIntentFallback(cleanedTranscript);
  }
}

/**
 * Fallback intent parser using simple pattern matching
 * Used when Gemini API is unavailable
 */
function parseIntentFallback(transcript: string): ParsedIntent {
  const lower = transcript.toLowerCase().trim();

  // Play station
  const playMatch = lower.match(/play\s+(.+)/);
  if (playMatch) {
    return {
      intent: 'play',
      station: playMatch[1].trim(),
    };
  }

  // Volume commands
  if (lower.match(/volume\s+up|turn\s+up|increase\s+volume/)) {
    return {
      intent: 'volume',
      volumeAction: 'up',
    };
  }

  if (lower.match(/volume\s+down|turn\s+down|decrease\s+volume/)) {
    return {
      intent: 'volume',
      volumeAction: 'down',
    };
  }

  const volumeSetMatch = lower.match(/(?:set|volume|turn)\s+(?:volume\s+)?(?:to\s+)?(\d+)/);
  if (volumeSetMatch) {
    const level = parseInt(volumeSetMatch[1], 10);
    return {
      intent: 'volume',
      volumeAction: 'set',
      volumeLevel: Math.max(0, Math.min(100, level)),
    };
  }

  // Next/previous
  if (lower.match(/next|skip/)) {
    return { intent: 'next' };
  }

  if (lower.match(/previous|back|last/)) {
    return { intent: 'previous' };
  }

  // Stop
  if (lower.match(/stop|pause/)) {
    return { intent: 'stop' };
  }

  return { intent: 'unknown' };
}

/**
 * Helper to check if intent requires a station name
 */
export function intentRequiresStation(intent: ParsedIntent): boolean {
  return intent.intent === 'play' && !intent.station;
}

/**
 * Helper to format intent for logging
 */
export function formatIntent(intent: ParsedIntent): string {
  const parts: string[] = [intent.intent];
  
  if (intent.station) {
    parts.push(`station: ${intent.station}`);
  }
  
  if (intent.volumeAction) {
    parts.push(`volume: ${intent.volumeAction}`);
    if (intent.volumeLevel !== undefined) {
      parts.push(`${intent.volumeLevel}%`);
    }
  }
  
  return parts.join(', ');
}

