/**
 * Murf AI WebSocket TTS Client with PCM Streaming Scheduler
 * Ultra-low latency audio playback using direct PCM scheduling
 */

import { useAIStore } from '../store/aiStore';
import { Timer } from '../utils/timer';
import { logger } from '../utils/logger';
import { getMurfWebSocketUrl as getMurfWS } from '../config/api';

let ws: WebSocket | null = null;
let audioContext: AudioContext | null = null;
let onTTSStateChange: ((isSpeaking: boolean) => void) | null = null;
let contextId: string | null = null;

// PCM Streaming state
interface WAVHeader {
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  dataOffset: number;
}

let wavHeader: WAVHeader | null = null;
let nextPlayTime = 0;
let scheduledSources: AudioBufferSourceNode[] = [];
let isPlayingAudio = false;
let murfFinalReceived = false;
let timer: Timer | null = null;

// Playback completion tracking
let playbackDoneResolve: (() => void) | null = null;
let playbackDoneReject: ((err: any) => void) | null = null;
let playbackDonePromise: Promise<void> | null = null;

/**
 * Set callback for TTS state changes (for volume ducking)
 */
export function setTTSStateChangeCallback(callback: (isSpeaking: boolean) => void) {
  onTTSStateChange = callback;
}

/**
 * Unlock audio context for iOS autoplay policies
 */
export async function unlockTTS(): Promise<void> {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
}

/**
 * Parse WAV header from first chunk
 */
function parseWAVHeader(data: Uint8Array): WAVHeader | null {
  if (data.length < 44) return null;
  
  // Check RIFF header
  if (String.fromCharCode(data[0], data[1], data[2], data[3]) !== 'RIFF') {
    return null;
  }
  
  // Check WAVE format
  if (String.fromCharCode(data[8], data[9], data[10], data[11]) !== 'WAVE') {
    return null;
  }
  
  // Find fmt chunk
  let offset = 12;
  while (offset < data.length - 8) {
    const chunkId = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
    const chunkSize = data[offset + 4] | (data[offset + 5] << 8) | (data[offset + 6] << 16) | (data[offset + 7] << 24);
    
    if (chunkId === 'fmt ') {
      // Parse fmt chunk
      const numChannels = data[offset + 10] | (data[offset + 11] << 8);
      const sampleRate = data[offset + 12] | (data[offset + 13] << 8) | (data[offset + 14] << 16) | (data[offset + 15] << 24);
      const bitsPerSample = data[offset + 22] | (data[offset + 23] << 8);
      
      // Find data chunk
      let dataOffset = offset + 8 + chunkSize;
      while (dataOffset < data.length - 8) {
        const dataChunkId = String.fromCharCode(data[dataOffset], data[dataOffset + 1], data[dataOffset + 2], data[dataOffset + 3]);
        if (dataChunkId === 'data') {
          return {
            sampleRate,
            numChannels,
            bitsPerSample,
            dataOffset: dataOffset + 8
          };
        }
        const dataChunkSize = data[dataOffset + 4] | (data[dataOffset + 5] << 8) | (data[dataOffset + 6] << 16) | (data[dataOffset + 7] << 24);
        dataOffset += 8 + dataChunkSize;
      }
      break;
    }
    
    offset += 8 + chunkSize;
  }
  
  return null;
}

/**
 * Extract PCM data from chunk (handles both WAV with header and headerless PCM)
 */
function extractPCMData(chunk: Uint8Array, isFirstChunk: boolean): { pcm: Int16Array; isHeaderless: boolean } | null {
  if (isFirstChunk && wavHeader) {
    // First chunk with header - extract PCM after header
    if (chunk.length < wavHeader.dataOffset) return null;
    const pcmBytes = chunk.slice(wavHeader.dataOffset);
    const pcm = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength / 2);
    return { pcm, isHeaderless: false };
  } else if (isFirstChunk) {
    // First chunk - try to parse header
    const header = parseWAVHeader(chunk);
    if (header) {
      wavHeader = header;
      if (chunk.length < header.dataOffset) return null;
      const pcmBytes = chunk.slice(header.dataOffset);
      const pcm = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength / 2);
      return { pcm, isHeaderless: false };
    } else {
      // No header - treat as headerless PCM (shouldn't happen for first chunk, but handle it)
      logger.warn('[Murf WS Client] First chunk has no WAV header, treating as headerless PCM');
      const pcm = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 2);
      return { pcm, isHeaderless: true };
    }
  } else {
    // Subsequent chunk - check if it has a header (some Murf chunks might)
    if (chunk.length >= 4 && String.fromCharCode(chunk[0], chunk[1], chunk[2], chunk[3]) === 'RIFF') {
      // Has header - parse and extract PCM
      const header = parseWAVHeader(chunk);
      if (header) {
        if (chunk.length < header.dataOffset) return null;
        const pcmBytes = chunk.slice(header.dataOffset);
        const pcm = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength / 2);
        return { pcm, isHeaderless: false };
      }
    }
    // Headerless PCM - use directly
    const pcm = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 2);
    return { pcm, isHeaderless: true };
  }
}

/**
 * Convert Int16 PCM to Float32
 */
function int16ToFloat32(int16: Int16Array): Float32Array {
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0;
  }
  return float32;
}

/**
 * Schedule PCM chunk for playback
 */
function schedulePCMChunk(pcm: Int16Array, isFirstChunk: boolean): void {
  if (!audioContext || !wavHeader) {
    logger.error('[Murf WS Client] Cannot schedule PCM: audioContext or wavHeader missing');
    return;
  }
  
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(err => {
      logger.error('[Murf WS Client] Failed to resume AudioContext:', err);
    });
  }
  
  // Convert PCM to Float32
  const float32 = int16ToFloat32(pcm);
  
  // Calculate frames per channel
  const frames = float32.length / wavHeader.numChannels;
  
  // Create AudioBuffer
  const buffer = audioContext.createBuffer(wavHeader.numChannels, frames, wavHeader.sampleRate);
  
  // Copy to channels
  if (wavHeader.numChannels === 1) {
    buffer.copyToChannel(new Float32Array(float32), 0);
  } else {
    // Interleaved stereo
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      left[i] = float32[i * 2];
      right[i] = float32[i * 2 + 1];
    }
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
  }
  
  // Schedule playback
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  
  // Calculate start time
  if (isFirstChunk && nextPlayTime === 0) {
    nextPlayTime = audioContext.currentTime + 0.02; // Small buffer for first chunk
    if (timer) {
      timer.mark('playback started (first buffer scheduled)');
    }
    isPlayingAudio = true;
    if (onTTSStateChange) {
      onTTSStateChange(true);
    }
    useAIStore.getState().setSpeaking(true);
  }
  
  // Clamp nextPlayTime to avoid gaps
  if (nextPlayTime < audioContext.currentTime + 0.02) {
    nextPlayTime = audioContext.currentTime + 0.02;
  }
  
  const startTime = nextPlayTime;
  const duration = buffer.duration;
  
  source.start(startTime);
  scheduledSources.push(source);
  
  // Update next play time
  nextPlayTime = startTime + duration;
  
  // Track when this source ends
  source.onended = () => {
    scheduledSources = scheduledSources.filter(s => s !== source);
    checkPlaybackComplete();
  };
  
  logger.log(`[Murf WS Client] Scheduled PCM chunk: ${frames} frames, ${duration.toFixed(3)}s, start: ${startTime.toFixed(3)}`);
}

/**
 * Check if playback is complete
 */
function checkPlaybackComplete(): void {
  if (murfFinalReceived && scheduledSources.length === 0 && isPlayingAudio) {
    logger.log('[Murf WS Client] Playback complete');
    
    if (timer) {
      timer.mark('playback finished (queue drained)');
    }
    
    isPlayingAudio = false;
    if (onTTSStateChange) {
      onTTSStateChange(false);
    }
    useAIStore.getState().setSpeaking(false);
    
    playbackDoneResolve?.();
    playbackDoneResolve = null;
    playbackDoneReject = null;
    playbackDonePromise = null;
    timer = null;
  }
}

/**
 * Base64 to Uint8Array
 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Get WebSocket URL at runtime based on current hostname
 */
function getMurfWebSocketUrl(): string {
  return getMurfWS();
}

/**
 * Connect to WebSocket proxy
 */
async function connectWebSocket(): Promise<WebSocket> {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return ws;
  }
  
  return new Promise((resolve, reject) => {
    const wsUrl = getMurfWebSocketUrl();
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      logger.log('[Murf WS Client] Connected successfully, state:', ws?.readyState);
      resolve(ws!);
    };
    
    ws.onerror = (error) => {
      logger.error('[Murf WS Client] WebSocket error:', error);
      reject(error);
    };
    
    ws.onclose = (event) => {
      // Only log error if final was NOT received AND it's not a normal close (1000/1005/1006)
      // This prevents false "[WebSocket closed] 1005" errors after successful playback
      const isNormalClose = event.code === 1000 || event.code === 1005 || event.code === 1006;
      if (!murfFinalReceived && !isNormalClose) {
        logger.error('[Murf WS Client] WebSocket closed unexpectedly:', event.code, event.reason);
        if (playbackDoneReject) {
          playbackDoneReject(new Error(`Murf AI connection closed unexpectedly: code ${event.code}`));
        }
      } else {
        // Normal close (with or without final) - log at debug level only
        logger.debug('[Murf WS Client] WebSocket closed:', event.code, event.reason);
        if (murfFinalReceived && (event.code === 1005 || event.code === 1006)) {
          // Normal close after final - resolve if not already resolved
          if (playbackDoneResolve) {
            playbackDoneResolve();
          }
        }
      }
      ws = null;
      contextId = null;
    };
  });
}

/**
 * Generate and stream TTS using Murf AI WebSocket (via server proxy)
 * Supports progressive text streaming for low latency
 */
export async function speakWithWebSocket(text: string, end: boolean = true): Promise<void> {
  if (!text || text.trim().length === 0) {
    return;
  }
  
  // Reset state for new utterance
  wavHeader = null;
  nextPlayTime = 0;
  scheduledSources = [];
  isPlayingAudio = false;
  murfFinalReceived = false;
  playbackDonePromise = new Promise<void>((resolve, reject) => {
    playbackDoneResolve = resolve;
    playbackDoneReject = reject;
  });
  
  // Generate context ID
  contextId = `ctx_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  timer = new Timer(`utt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`);
  
  try {
    // Ensure audio context exists
    if (!audioContext) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    
    // Connect WebSocket
    const wsConnection = await connectWebSocket();
    if (timer) {
      timer.mark('Murf WS opened');
    }
    
    // Small delay to ensure proxy connection is ready
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Send text chunk
    const message = {
      text: text,
      end: end,
      context_id: contextId,
      voice_config: {
        voice_id: 'Finley',
        style: 'Conversation',
        variation: 1,
        rate: 2,
        pitch: -5
      }
    };
    
    if (wsConnection.readyState === WebSocket.OPEN) {
      wsConnection.send(JSON.stringify(message));
      logger.log(`[Murf WS Client] Sending text chunk (final: ${end}):`, text.substring(0, 50));
    } else {
      throw new Error('WebSocket not open');
    }
    
    let firstAudioChunk = true;
    let chunkIndex = 0;
    
    // Set up message handler
    wsConnection.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        
        if (message.error) {
          logger.error('[Murf WS Client] Server error:', message.error);
          if (scheduledSources.length === 0) {
            playbackDoneReject?.(new Error(message.error));
            return;
          } else {
            logger.warn('[Murf WS Client] Error received but we have scheduled audio, continuing playback');
            murfFinalReceived = true;
            checkPlaybackComplete();
          }
        }
        
        if (message.audio) {
          chunkIndex++;
          const audioBytes = base64ToBytes(message.audio);
          
          if (firstAudioChunk && timer) {
            timer.mark('first audio chunk arrived');
            firstAudioChunk = false;
          }
          
          logger.log(`[Murf WS Client] Received audio chunk ${chunkIndex}, ${audioBytes.length} bytes`);
          
          // Extract PCM data
          const pcmData = extractPCMData(audioBytes, chunkIndex === 1);
          if (!pcmData) {
            logger.warn(`[Murf WS Client] Failed to extract PCM from chunk ${chunkIndex}`);
            return;
          }
          
          // Schedule for playback
          schedulePCMChunk(pcmData.pcm, chunkIndex === 1);
        }
        
        if (message.final) {
          if (timer) {
            timer.mark('Murf final received');
          }
          murfFinalReceived = true;
          logger.log('[Murf WS Client] Received final message');
          checkPlaybackComplete();
        }
      } catch (error) {
        logger.error('[Murf WS Client] Error processing message:', error);
      }
    };
    
    // Wait for playback to complete
    await playbackDonePromise;
    
  } catch (error) {
    logger.error('[Murf WS Client] TTS failed:', error);
    playbackDoneReject?.(error);
    throw error;
  } finally {
    // Cleanup
    if (ws) {
      ws.close();
      ws = null;
    }
    contextId = null;
  }
}

/**
 * Play streaming TTS from text stream
 */
export async function playStreamingTTS(
  textStream: AsyncIterable<string>
): Promise<void> {
  // For now, accumulate text and send when stream ends
  // TODO: Implement true progressive text sending
  let accumulatedText = '';
  for await (const chunk of textStream) {
    accumulatedText += chunk;
  }
  
  if (accumulatedText.trim().length > 0) {
    await speakWithWebSocket(accumulatedText, true);
  }
}
