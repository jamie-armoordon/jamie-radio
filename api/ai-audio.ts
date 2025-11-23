import type { VercelRequest, VercelResponse } from '@vercel/node';
import { 
  GoogleGenAI,
  createUserContent,
  createPartFromUri,
} from '@google/genai';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { whisper } from 'whisper-node';
import { Timer } from './_utils/timer.js';
import { logger } from './_utils/logger.js';
import { logAIEvent, truncateField } from './_utils/aiLogger.js';
import {
  TOOLS,
  getSystemInstruction,
  executeToolCalls,
  deriveCommand,
  getOrigin,
  ToolCall,
} from './radioTools.js';
import { decodeWebmToPcm16 } from './utils/audioDecode.js';
import { runVadOnPcm16 } from './utils/vad.js';
import { trimPcm16ToSegments, pcm16ToWav } from './utils/wavEncoder.js';

const API_KEY = process.env.GOOGLE_AI_API_KEY || 'AIzaSyDsmn62Ux5MgplmuEwgthbsYp7-G5CIR84';

/**
 * Heuristic to detect bad transcripts (assistant-intro hallucinations)
 */
function isBadTranscript(text: string): boolean {
  if (!text || !text.trim()) return true;
  
  const lower = text.toLowerCase().trim();
  const words = lower.split(/\s+/).filter(w => w.length > 0);
  
  // Too short (< 3 words)
  if (words.length < 3) return true;
  
  // Assistant intro patterns
  const introPatterns = [
    /^hello,?\s*i'?m\s+jarvis/i,
    /^i'?m\s+jarvis/i,
    /^how\s+can\s+i\s+help/i,
    /^hello,?\s*i'?m\s+your\s+ai\s+assistant/i,
  ];
  
  for (const pattern of introPatterns) {
    if (pattern.test(lower)) return true;
  }
  
  return false;
}

/**
 * Explicit transcription stage: transcribe audio to text only using whisper-node (local)
 * Returns cleaned transcript with single retry on failure
 * @param audio - Base64-encoded WAV audio (trimmed speech segments, must be 16kHz)
 */
async function transcribeAudio(
  ai: GoogleGenAI,
  audio: string,
  geminiMimeType: string,
  requestId: string
): Promise<string> {
  const transcribeStartTime = Date.now();
  
  let tempFilePath: string | null = null;
  
  try {
    logAIEvent({
      ts: new Date().toISOString(),
      reqId: requestId,
      event: 'transcription_started',
      model: 'whisper-node',
      method: 'local_whisper',
    });
    
    // Convert base64 to buffer and write to temp file
    const audioBuffer = Buffer.from(audio, 'base64');
    const tempDir = process.env.TMPDIR || '/tmp';
    tempFilePath = join(tempDir, `transcribe-${requestId}-${Date.now()}.wav`);
    
    await writeFile(tempFilePath, audioBuffer);
    logger.log('[AI Audio API] Wrote temp file for whisper transcription:', tempFilePath, `(${(audioBuffer.length / 1024).toFixed(2)}KB)`);
    
    // Try whisper-node first, fall back to Gemini on failure
    let transcriptSegments: any[] | undefined;
    let useWhisper = false;
    
    try {
      // Transcribe using whisper-node (local, CPU-optimized)
      // Note: whisper.cpp outputs timestamps by default when -ml flag is set
      // We need timestamps for the parser to work, so we set word_timestamps to true
      // which adds -ml 1 flag to get timestamp output
      const options = {
        modelName: 'base.en', // English model, better accuracy than base.en (slower but more accurate)
        whisperOptions: {
          language: 'en', // Force English for better accuracy
          word_timestamps: true, // Enable timestamps so parser can extract text (adds -ml 1 flag)
          gen_file_txt: false,
          gen_file_subtitle: false,
          gen_file_vtt: false,
        },
      };
      
      transcriptSegments = await whisper(tempFilePath, options);
      
      // Check if transcription failed (whisper returns undefined on error)
      if (transcriptSegments && Array.isArray(transcriptSegments) && transcriptSegments.length > 0) {
        useWhisper = true;
        logger.log('[AI Audio API] Whisper transcription segments:', transcriptSegments.length);
        logger.log('[AI Audio API] Whisper first segment:', JSON.stringify(transcriptSegments[0]));
      } else {
        logger.warn('[AI Audio API] Whisper returned empty or invalid result, falling back to Gemini');
        logger.warn('[AI Audio API] Whisper result type:', typeof transcriptSegments, 'isArray:', Array.isArray(transcriptSegments), 'length:', transcriptSegments?.length);
      }
    } catch (whisperError: any) {
      logger.warn('[AI Audio API] Whisper transcription failed, falling back to Gemini:', whisperError?.message || whisperError);
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'whisper_transcription_failed',
        errorMessage: truncateField(whisperError?.message || 'unknown error', 500),
        fallbackToGemini: true,
      });
    }
    
    // If whisper failed, use Gemini instead
    if (!useWhisper) {
      logger.log('[AI Audio API] Using Gemini for transcription (whisper unavailable or failed)');
      
      // Upload file to Gemini
      const uploadedFile = await ai.files.upload({
        file: tempFilePath,
        config: { mimeType: 'audio/wav' },
      });
      
      const fileUri = uploadedFile.uri || '';
      const fileMimeType = uploadedFile.mimeType || 'audio/wav';
      const transcribePrompt = 'Transcribe this audio. Output only the transcribed text, nothing else. Do not greet, do not introduce yourself, do not ask questions. Just transcribe what the user said.';
      
      const transcriptResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-09-2025',
        contents: createUserContent([
          createPartFromUri(fileUri, fileMimeType),
          transcribePrompt,
        ]),
        config: {
          toolConfig: {
            functionCallingConfig: { mode: 'NONE' as any },
          },
          temperature: 0,
        },
      });
      
      const rawTranscript = ((transcriptResponse as any).text || '').trim();
      const cleanedTranscript = rawTranscript.replace(/^["']|["']$/g, '').trim();
      
      const transcriptionLatencyMs = Date.now() - transcribeStartTime;
      
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'transcription_finished',
        latencyMs: transcriptionLatencyMs,
        rawTranscript: truncateField(rawTranscript, 500),
        cleanedTranscript: truncateField(cleanedTranscript, 500),
        isBad: isBadTranscript(cleanedTranscript),
        wordCount: cleanedTranscript.split(/\s+/).filter(w => w.length > 0).length,
        method: 'gemini_fallback',
      });
      
      logger.log('[AI Audio API] Transcription (raw):', rawTranscript || '(empty)');
      logger.log('[AI Audio API] Transcription (cleaned):', cleanedTranscript || '(empty)');
      
      // Clean up temp file
      if (tempFilePath) {
        try {
          await unlink(tempFilePath);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      
      // Retry once if transcript is bad
      if (isBadTranscript(cleanedTranscript)) {
        logger.log('[AI Audio API] Bad transcript detected, retrying transcription...');
        
        const retryResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash-preview-09-2025',
          contents: createUserContent([
            createPartFromUri(fileUri, fileMimeType),
            'Listen carefully to this audio and transcribe exactly what the user said. Output only the transcription, no greetings, no introductions, no questions.',
          ]),
          config: {
            toolConfig: {
              functionCallingConfig: { mode: 'NONE' as any },
            },
            temperature: 0,
          },
        });
        
        const retryRaw = ((retryResponse as any).text || '').trim();
        const retryCleaned = retryRaw.replace(/^["']|["']$/g, '').trim();
        
        logAIEvent({
          ts: new Date().toISOString(),
          reqId: requestId,
          event: 'transcription_retry',
          rawTranscript: truncateField(retryRaw, 500),
          cleanedTranscript: truncateField(retryCleaned, 500),
          isBad: isBadTranscript(retryCleaned),
          method: 'gemini_fallback',
        });
        
        logger.log('[AI Audio API] Transcription retry (cleaned):', retryCleaned || '(empty)');
        
        // Clean up temp file
        if (tempFilePath) {
          try {
            await unlink(tempFilePath);
          } catch (e) {
            // Ignore cleanup errors
          }
        }
        
        return retryCleaned;
      }
      
      return cleanedTranscript;
    }
    
    // If we get here, whisper succeeded - process the results
    if (!transcriptSegments || !Array.isArray(transcriptSegments)) {
      throw new Error('Whisper transcription returned invalid result');
    }
    
    // Combine all segments into a single transcript string
    const rawTranscript = transcriptSegments
      .map((segment: any) => segment.speech || '')
      .filter((text: string) => text.trim().length > 0)
      .join(' ')
      .trim();
    
    const cleanedTranscript = rawTranscript.replace(/^["']|["']$/g, '').trim();
    
    const transcriptionLatencyMs = Date.now() - transcribeStartTime;
    
    // Log raw and cleaned transcripts
    logAIEvent({
      ts: new Date().toISOString(),
      reqId: requestId,
      event: 'transcription_finished',
      latencyMs: transcriptionLatencyMs,
      rawTranscript: truncateField(rawTranscript, 500),
      cleanedTranscript: truncateField(cleanedTranscript, 500),
      isBad: isBadTranscript(cleanedTranscript),
      wordCount: cleanedTranscript.split(/\s+/).filter(w => w.length > 0).length,
      method: 'local_whisper',
      segmentCount: transcriptSegments.length,
    });
    
    logger.log('[AI Audio API] Transcription (raw):', rawTranscript || '(empty)');
    logger.log('[AI Audio API] Transcription (cleaned):', cleanedTranscript || '(empty)');
    
    // Retry once if transcript is bad (try with different model or settings)
    if (isBadTranscript(cleanedTranscript)) {
      logger.log('[AI Audio API] Bad transcript detected, retrying with different whisper settings...');
      
      // Retry with smaller/faster model if available, or same model
      const retryOptions = {
        modelName: 'tiny.en', // Try smaller model for speed
        whisperOptions: {
          language: 'en', // Force English
          word_timestamps: false,
          gen_file_txt: false,
          gen_file_subtitle: false,
          gen_file_vtt: false,
        },
      };
      
      const retrySegments = await whisper(tempFilePath, retryOptions);
      const retryRaw = retrySegments
        .map((segment: any) => segment.speech || '')
        .filter((text: string) => text.trim().length > 0)
        .join(' ')
        .trim();
      const retryCleaned = retryRaw.replace(/^["']|["']$/g, '').trim();
      
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'transcription_retry',
        rawTranscript: truncateField(retryRaw, 500),
        cleanedTranscript: truncateField(retryCleaned, 500),
        isBad: isBadTranscript(retryCleaned),
        method: 'local_whisper',
        retryModel: 'tiny.en',
      });
      
      logger.log('[AI Audio API] Transcription retry (cleaned):', retryCleaned || '(empty)');
      
      // Clean up temp file
      if (tempFilePath) {
        try {
          await unlink(tempFilePath);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      
      return retryCleaned;
    }
    
    // Clean up temp file
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    
    return cleanedTranscript;
  } catch (error: any) {
    logger.error('[AI Audio API] Transcription failed:', error);
    logAIEvent({
      ts: new Date().toISOString(),
      reqId: requestId,
      event: 'transcription_error',
      errorMessage: truncateField(error?.message || 'unknown error', 500),
      method: 'local_whisper',
    });
    
    // Clean up temp file on error
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    
    return '';
  }
}

/**
 * Generate TTS using Murf AI Gen 2 (high-quality, natural radio-like voice)
 * Uses Gen 2 model with Newscast style for radio DJ voice
 * Set MURF_API_KEY environment variable for authentication
 */
async function generateMurfGen2TTS(text: string): Promise<string> {
  try {
    logger.log('AI Audio API', 'Using Murf AI Gen 2 TTS for:', text.substring(0, 50));
    
    const murfApiKey = process.env.MURF_API_KEY || '';
    if (!murfApiKey) {
      throw new Error('MURF_API_KEY environment variable not set. Murf AI TTS requires API key.');
    }
    
    // Use a professional male radio voice with Narration style for natural, expressive speech
    // Theo (en-UK-theo) - male voice with "Narration" style - perfect for radio DJ/host
    // Alternative: Gabriel (en-UK-gabriel) with "Promo" style for energetic radio, or Freddie with "Narration"
    const voiceId = 'en-UK-theo'; // Theo voice - professional male, supports Narration style
    const style = 'Narration'; // Narration style for professional radio host voice
    
    // Use the correct Murf AI Gen 2 streaming endpoint
    // Note: Gen 2 is only available on api.murf.ai (not uk.api.murf.ai)
    const endpoint = 'https://api.murf.ai/v1/speech/stream';
    
    logger.log('AI Audio API', `Calling Murf AI Gen 2 endpoint: ${endpoint}`);
    logger.log('AI Audio API', `Voice: ${voiceId}, Style: ${style}`);
    
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
    
    logger.log('AI Audio API', 'Murf AI Gen 2 TTS generated successfully:', base64Audio.length, 'bytes (base64)');
    return base64Audio;
  } catch (error: any) {
    logger.error('AI Audio API', 'Murf AI Gen 2 TTS failed:', error);
    throw error;
  }
}



export default async function handler(req: VercelRequest | any, res: VercelResponse | any) {
  // Create timer for this request
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const timer = new Timer(requestId);

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
    timer.mark('request received');
    
    if (!req.body) {
      logger.error('AI Audio API', 'Request body is undefined!');
      return res.status(400).json({ 
        error: 'Request body is missing',
        command: { type: 'unknown' },
        speak_text: 'sorry i had trouble processing that',
      });
    }
    
    const { audio, mimeType, stations, location, radioIsPlaying, playerVolume } = req.body;
    
    // Log request_received event
    const audioSizeKB = audio ? Math.round((audio.length * 3 / 4 / 1024) * 100) / 100 : 0;
    const stationNames: string[] = Array.isArray(stations) ? stations : [];
    logAIEvent({
      ts: new Date().toISOString(),
      reqId: requestId,
      event: 'request_received',
      mimeType: mimeType || 'unknown',
      audioSizeKB,
      stationCount: stationNames.length,
      origin: getOrigin(req),
      userAgent: req.headers?.['user-agent'] || 'unknown',
      hasLocation: !!(location?.lat && location?.lon),
      radioIsPlaying: radioIsPlaying ?? undefined,
      playerVolume: playerVolume ?? undefined,
    });

    if (!audio || typeof audio !== 'string') {
      logger.error('AI Audio API', 'Missing or invalid audio data');
      return res.status(400).json({ 
        error: 'Audio data is required',
        command: { type: 'unknown' },
        speak_text: 'sorry i had trouble processing that',
      });
    }
    
    if (audio.length === 0) {
      logger.error('AI Audio API', 'Empty audio data received');
      return res.status(400).json({ 
        error: 'Empty audio data',
        command: { type: 'unknown' },
        speak_text: 'sorry i didn\'t hear anything',
      });
    }
    
    timer.mark('audio decoded/base64 ready', { sizeKB: (audio.length * 3 / 4 / 1024).toFixed(2) });

    // Initialize Google GenAI
    const ai = new GoogleGenAI({ apiKey: API_KEY });

    // Convert mimeType to Gemini-compatible format (only supported formats)
    // Supported: audio/wav, audio/mp3, audio/aiff, audio/aac, audio/ogg, audio/flac
    let geminiMimeType = 'audio/wav'; // Default to WAV since we convert to WAV
    if (mimeType?.includes('mp3')) {
      geminiMimeType = 'audio/mp3';
    } else if (mimeType?.includes('wav')) {
      geminiMimeType = 'audio/wav';
    } else if (mimeType?.includes('ogg')) {
      geminiMimeType = 'audio/ogg';
    } else if (mimeType?.includes('aiff')) {
      geminiMimeType = 'audio/aiff';
    } else if (mimeType?.includes('aac')) {
      geminiMimeType = 'audio/aac';
    } else if (mimeType?.includes('flac')) {
      geminiMimeType = 'audio/flac';
    }
    // Note: audio/webm is not supported by Gemini, so we default to WAV

    // Set up SSE headers
    if (res.setHeader) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }

    const origin = getOrigin(req);

    /* ---------------- STAGE A: VAD + TRIM ---------------- */
    timer.mark('Stage A: VAD started');
    logger.log('[AI Audio API] Stage A: VAD + trim...');
    
    const vadStartTime = Date.now();
    logAIEvent({
      ts: new Date().toISOString(),
      reqId: requestId,
      event: 'vad_started',
      vadMode: 'VERY_AGGRESSIVE',
      audioFrequency: 16000,
      debounceTime: 300,
    });

    let trimmedWavBase64: string;
    let transcribedText: string = '';

    try {
      // Decode audio (webm/opus/wav) to PCM16 mono @ 16kHz
      const pcm16 = await decodeWebmToPcm16(audio, mimeType);
      
      // Run VAD to find speech segments
      const vadResult = await runVadOnPcm16(pcm16, 16000);
      
      const vadLatencyMs = Date.now() - vadStartTime;

      // Check if we have usable speech
      if (vadResult.segments.length === 0 || vadResult.speechRatio < 0.1) {
        logger.warn('[AI Audio API] No usable speech detected, short-circuiting');
        logAIEvent({
          ts: new Date().toISOString(),
          reqId: requestId,
          event: 'vad_no_speech',
          speechRatio: vadResult.speechRatio,
          segmentCount: vadResult.segments.length,
        });

        // Short-circuit with retry response
        const speak_text = "Sorry, I didn't catch that. Could you say it again?";
        const command = { type: 'unknown' as const };
        
        if (res.write) {
          res.write(`data: ${JSON.stringify({ type: 'speak_text', text: speak_text })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'command', command })}\n\n`);
          res.write('data: [DONE]\n\n');
        }
        if (res.end) {
          res.end();
        }
        return;
      }

      // Trim PCM to speech segments only
      const trimmedPcm16 = trimPcm16ToSegments(pcm16, vadResult.segments, 16000);
      const trimmedAudioSizeKB = Math.round((trimmedPcm16.length / 1024) * 100) / 100;
      
      // Validate trimmed buffer - if empty or too small, fall back to untrimmed audio
      if (trimmedPcm16.length === 0 || trimmedAudioSizeKB < 0.1) {
        logger.warn('[AI Audio API] Trimmed audio is empty or too small, falling back to untrimmed audio', {
          trimmedSizeKB: trimmedAudioSizeKB,
          trimmedLength: trimmedPcm16.length,
          segmentCount: vadResult.segments.length,
          segments: vadResult.segments,
          pcm16Length: pcm16.length,
        });
        
        logAIEvent({
          ts: new Date().toISOString(),
          reqId: requestId,
          event: 'vad_trim_empty',
          vadSegments: vadResult.segments,
          speechDurationMs: vadResult.speechDurationMs,
          speechRatio: vadResult.speechRatio,
          trimmedAudioSizeKB,
          pcm16Length: pcm16.length,
          pcm16DurationMs: (pcm16.length / 2 / 16000) * 1000,
          fallbackToUntrimmed: true,
        });
        
        // Fall back to untrimmed audio (will be treated as webm by Gemini if original was webm)
        // But we need to convert to WAV since we already decoded to PCM16
        trimmedWavBase64 = pcm16ToWav(pcm16, 16000);
      } else {
        // Convert trimmed PCM to WAV for transcription
        trimmedWavBase64 = pcm16ToWav(trimmedPcm16, 16000);
      }
      
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'vad_finished',
        vadSegments: vadResult.segments,
        speechDurationMs: vadResult.speechDurationMs,
        speechRatio: vadResult.speechRatio,
        trimmedAudioSizeKB,
        pcm16Length: pcm16.length,
        pcm16DurationMs: (pcm16.length / 2 / 16000) * 1000,
        vadLatencyMs,
      });

      timer.mark('Stage A: VAD complete, trimmed audio ready');
      logger.log('[AI Audio API] Stage A complete:', {
        segments: vadResult.segments.length,
        speechRatio: vadResult.speechRatio.toFixed(3),
        trimmedSizeKB: trimmedAudioSizeKB,
      });

    } catch (vadError: any) {
      logger.error('[AI Audio API] Stage A (VAD) failed:', vadError);
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'vad_error',
        errorMessage: truncateField(vadError?.message || 'unknown error', 500),
      });
      
      // Fallback: continue with original audio if VAD fails
      logger.warn('[AI Audio API] Falling back to original audio (no VAD trimming)');
      trimmedWavBase64 = audio; // Use original (will be treated as webm by Gemini)
    }

    /* ---------------- STAGE B: TRANSCRIBE ---------------- */
    timer.mark('Stage B: Transcription started');
    logger.log('[AI Audio API] Stage B: Transcribe trimmed audio...');
    
    transcribedText = await transcribeAudio(ai, trimmedWavBase64, 'audio/wav', requestId);
    
    timer.mark('Stage B: Transcription complete');
    
    // Check if transcript is bad after retry
    if (!transcribedText || isBadTranscript(transcribedText)) {
      logger.warn('[AI Audio API] Transcription failed or produced bad transcript after retry');
      
      // Check if we already retried (transcription_retry event would have been logged)
      // If still bad, log transcript_bad_generic
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'transcript_bad_generic',
        transcript: truncateField(transcribedText || '', 500),
        wordCount: transcribedText ? transcribedText.split(/\s+/).filter(w => w.length > 0).length : 0,
      });

      // Return retry response
      const speak_text = "I couldn't quite hear that. Try again?";
      const command = { type: 'unknown' as const };
      
      if (res.write) {
        res.write(`data: ${JSON.stringify({ type: 'speak_text', text: speak_text })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'command', command })}\n\n`);
        res.write('data: [DONE]\n\n');
      }
      if (res.end) {
        res.end();
      }
      return;
    }

    /* ---------------- STAGE C: INTENT + TOOLS (TEXT-BASED) ---------------- */
    const systemInstruction = getSystemInstruction(stationNames);
    
    // Add strict router instruction for Pass-1
    const pass1RouterInstruction = `You are a routing engine. Do NOT respond with natural language. Your ONLY valid output is calling tool(s). If unsure, call list_stations/search_stations first, then play_station.`;
    
    const pass1Prompt = `${systemInstruction}\n\n${pass1RouterInstruction}\n\nUser: ${transcribedText || '(no transcript available)'}`;
    
    const intentStartTime = Date.now();

    timer.mark('Stage C: Intent started');
    logger.log('[AI Audio API] Stage C: Intent detection (text-based tool calling)...');
    
    // Log intent_started
    logAIEvent({
      ts: new Date().toISOString(),
      reqId: requestId,
      event: 'intent_started',
      model: 'gemini-2.5-flash-preview-09-2025',
      systemInstructionLength: systemInstruction.length,
      stationHintCount: stationNames.length,
      transcriptLength: transcribedText.length,
      transcriptPreview: truncateField(transcribedText, 200),
    });
    
    try {
      // Stage C: Intent detection operates on TEXT only (not audio)
      const pass1 = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-09-2025',
        contents: [{ text: pass1Prompt }],
        config: {
          tools: TOOLS,
          temperature: 0,
          toolConfig: {
            functionCallingConfig: { mode: 'AUTO' as any },
          },
        },
      });

      // Extract function calls from Pass-1 (should not have text response)
      const functionCalls = (pass1 as any).functionCalls || [];
      const toolCalls: ToolCall[] = functionCalls.map((fc: any) => ({
        name: fc.name || '',
        args: fc.args || {},
      }));
      
      const intentLatencyMs = Date.now() - intentStartTime;
      
      // Log intent results for debugging
      logger.log('[AI Audio API] Stage C toolCalls:', toolCalls.map(tc => ({ name: tc.name, args: tc.args })));
      
      // Log intent_finished
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'intent_finished',
        latencyMs: intentLatencyMs,
        model: 'gemini-2.5-flash-preview-09-2025',
        transcript: truncateField(transcribedText, 500),
        toolCalls: toolCalls.map(tc => ({
          name: tc.name,
          args: truncateField(JSON.stringify(tc.args || {}), 1000),
        })),
        toolCallCount: toolCalls.length,
        intentLatencyMs,
      });
      
      // Log intent_no_tool_calls if Pass-1 returned empty
      if (toolCalls.length === 0) {
        logAIEvent({
          ts: new Date().toISOString(),
          reqId: requestId,
          event: 'intent_no_tool_calls',
          transcript: truncateField(transcribedText, 500),
          systemInstructionLength: systemInstruction.length,
          stationCount: stationNames.length,
          warning: 'Pass-1 returned no tool calls',
        });
      }
      
      timer.mark('Pass 1 complete, executing tools');

      const toolsStartTime = Date.now();
      const toolResults = await executeToolCalls(toolCalls, origin, req);
      const toolsLatencyMs = Date.now() - toolsStartTime;
      timer.mark('Tools executed');
      
      // Log tools_executed
      const searchResult = toolResults.find(
        (r) => r.name === 'search_stations' || r.name === 'list_stations'
      );
      const bestMatch = searchResult?.result as any;
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'tools_executed',
        tools: toolCalls.map((tc, idx) => ({
          name: tc.name,
          args: truncateField(JSON.stringify(tc.args || {}), 500),
          resultSummary: truncateField(JSON.stringify(toolResults[idx]?.result || {}), 1000),
          hasError: !!(toolResults[idx]?.result as any)?.error,
        })),
        overallLatencyMs: toolsLatencyMs,
        bestMatch: bestMatch?.bestMatch ? {
          stationName: bestMatch.bestMatch.stationName || bestMatch.bestMatch.name,
          stationId: bestMatch.bestMatch.stationId || bestMatch.bestMatch.id,
          score: bestMatch.bestMatch.score,
          confidence: bestMatch.confidence,
        } : null,
        confidence: bestMatch?.confidence ?? undefined,
      });

      // Log tool sequence and bestMatch for debugging
      logger.log('[Pass1] toolCalls', {
        calls: toolCalls.map((c) => ({ name: c.name, args: c.args })),
        bestMatch:
          (searchResult?.result as any)?.bestMatch?.stationName ||
          (searchResult?.result as any)?.bestMatch?.name,
      });

      /* ---------------- PASS 2: STREAM SPOKEN TEXT (NO TOOLS) -------------- */
      const toolSummary = toolResults
        .map((r) => {
          const { name, args, result } = r;
          // Special formatting for station search tools
          if (name === 'search_stations' || name === 'list_stations') {
            const res = result as any;
            let summary = `${name}("${res.query || args?.query || ''}"):\n`;
            if (res.bestMatch) {
              summary += `  bestMatch: "${res.bestMatch.stationName || res.bestMatch.name}" (id=${res.bestMatch.stationId || res.bestMatch.id}, score=${res.bestMatch.score}, confidence=${res.confidence})\n`;
            } else {
              summary += `  bestMatch: null\n`;
            }
            if (res.matches?.length) {
              summary += `  otherMatches: ${res.matches.slice(0, 3).map((m: any) => `"${m.stationName || m.name}"`).join(', ')}\n`;
            }
            return summary;
          }
          // Default formatting for other tools
          return `${name}(${JSON.stringify(args)}) => ${JSON.stringify(result)}`;
        })
        .join('\n');

      // Include user query in Pass-2 prompt for context
      const userQuery = transcribedText || '';
      const hasValidTranscript = transcribedText && !isBadTranscript(transcribedText) && transcribedText.trim().length > 0;
      
      // Build fallback guidance based on state
      let fallbackGuidance = '';
      if (toolCalls.length === 0) {
        if (hasValidTranscript) {
          fallbackGuidance = '- Since no tools were called but the user query seems valid, politely ask the user to rephrase their request.';
        } else {
          fallbackGuidance = '- Since no tools were called and the transcript is invalid/empty, say you didn\'t catch that and ask them to try again.';
        }
      }
      
      const finalPrompt = `
You are Jarvis, a friendly UK radio voice assistant.

User asked: "${userQuery || '(transcript unavailable)'}"

The system already ran these tools:

${toolSummary || '(no tools called)'}

Now produce ONE short spoken reply for the user.
- If tools were called: respond based on the tool results.
- If switching stations: say you're switching and name it.
- If volume change: acknowledge it.
- If now playing fetched: mention artist + title.
- If weather was requested: provide the weather information.
${fallbackGuidance}
- If intent is unclear: ask ONE short clarifying question.
DO NOT call tools. Output plain text only.

`.trim();

      const pass2StartTime = Date.now();
      timer.mark('Gemini Pass 2 started');
      logger.log('[AI Audio API] Calling Gemini generateContentStream (Pass 2: spoken text)...');
      
      // Log pass2_started
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'pass2_started',
        model: 'gemini-2.5-flash-preview-09-2025',
        toolSummaryLength: toolSummary.length,
        toolSummaryPreview: truncateField(toolSummary, 300),
        userQueryIncluded: true,
        userQueryLength: userQuery.length,
      });

      const stream = await ai.models.generateContentStream({
        model: 'gemini-2.5-flash-preview-09-2025',
        contents: [{ text: finalPrompt }],
        config: {
          temperature: 0.8,
          toolConfig: {
            functionCallingConfig: { mode: 'NONE' as any },
          },
        },
      });

      let speakText = '';
      let chunkCount = 0;
      for await (const chunk of stream) {
        if (chunk.text) {
          speakText += chunk.text;
          chunkCount++;
        }
      }

      const pass2LatencyMs = Date.now() - pass2StartTime;
      timer.mark('Pass 2 complete');
      
      // Log pass2_finished
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'pass2_finished',
        latencyMs: pass2LatencyMs,
        model: 'gemini-2.5-flash-preview-09-2025',
        speakText: truncateField(speakText.trim(), 1000),
        chunkCount,
        userQueryIncluded: true,
        userQueryLength: userQuery.length,
      });

      // Emit speak_text first
      if (res.write) {
        res.write(
          `data: ${JSON.stringify({
            type: 'speak_text',
            text: speakText.trim(),
          })}\n\n`
        );
        logger.log('[AI Audio API] Emitted speak_text via SSE:', speakText.trim().substring(0, 50));
      }

      // Derive + emit command
      const command = deriveCommand(toolCalls, toolResults);
      
      // Log command_derived
      const searchCall = toolCalls.find(c => c.name === 'search_stations' || c.name === 'list_stations');
      const playCall = toolCalls.find(c => c.name === 'play_station');
      const searchResultForCommand = toolResults.find(
        (r) => r.name === 'search_stations' || r.name === 'list_stations'
      );
      const searchResultData = searchResultForCommand?.result as any;
      // Updated threshold to match deriveCommand (0.6 instead of 0.75)
      const derivedFromTool = playCall ? 'play_station' : 
                             (searchCall && searchResultData?.bestMatch && searchResultData.confidence >= 0.6) ? 'search_stations_fallback' : 
                             'unknown';
      const usedFallback = !playCall && derivedFromTool === 'search_stations_fallback';
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'command_derived',
        command,
        derivedFromTool,
        usedFallback,
        fallbackReason: usedFallback ? 'no play_station call, using bestMatch from search/list_stations (confidence >= 0.6)' : null,
        fallbackConfidence: usedFallback ? searchResultData?.confidence : null,
      });
      
      if (res.write) {
        res.write(`data: ${JSON.stringify({ type: 'command', command })}\n\n`);
        logger.log('[AI Audio API] Emitted command via SSE:', JSON.stringify(command));
        res.write('data: [DONE]\n\n');
      }
      if (res.end) {
        logger.log('[AI Audio API] Ending SSE stream');
        res.end();
      }
      
      // Log sse_completed
      const totalLatencyMs = Date.now() - intentStartTime;
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'sse_completed',
        totalLatencyMs,
      });

    } catch (geminiError: any) {
      logger.error('[AI Audio API] Gemini API error:', geminiError);
      timer.mark('Gemini error', { error: geminiError.message });
      
      // Log error event
      logAIEvent({
        ts: new Date().toISOString(),
        reqId: requestId,
        event: 'error',
        errorType: geminiError?.name || 'unknown',
        errorMessage: truncateField(geminiError?.message || 'unknown error', 500),
        stack: truncateField(geminiError?.stack || '', 1000),
      });
      
      if (res.write) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: geminiError.message })}\n\n`);
      }
      if (res.end) {
        res.end();
      }
    }

  } catch (error: any) {
    logger.error('[AI Audio API] Error:', error);
    timer.mark('handler error', { error: error.message });
    
    if (res.write) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to process audio' })}\n\n`);
    }
    if (res.end) {
      res.end();
    }
  }
}
