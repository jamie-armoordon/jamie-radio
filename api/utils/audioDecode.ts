/**
 * Decode audio (WebM/Opus/WAV) to PCM16 mono @ 16kHz using ffmpeg
 * Used for server-side audio processing before VAD
 */

import { spawn } from 'child_process';
import { logger } from '../_utils/logger.js';

/**
 * Decode base64-encoded audio (WebM/Opus/WAV) to PCM16 mono @ 16kHz
 * @param base64Audio - Base64-encoded audio data
 * @param mimeType - Optional MIME type hint (audio/webm, audio/wav, etc.)
 * @returns Buffer containing PCM16 mono audio data @ 16kHz
 */
export async function decodeWebmToPcm16(base64Audio: string, mimeType?: string): Promise<Buffer> {
  const input = Buffer.from(base64Audio, 'base64');
  
  // Detect format from MIME type or file header
  let format = 'auto'; // Let ffmpeg auto-detect
  if (mimeType) {
    if (mimeType.includes('wav')) {
      format = 'wav';
    } else if (mimeType.includes('webm')) {
      format = 'webm';
    } else if (mimeType.includes('mp3')) {
      format = 'mp3';
    } else if (mimeType.includes('ogg')) {
      format = 'ogg';
    }
  }
  
  // If auto-detection fails, try to detect from header
  if (format === 'auto' && input.length >= 12) {
    // Check for WAV (RIFF header)
    if (input[0] === 0x52 && input[1] === 0x49 && input[2] === 0x46 && input[3] === 0x46) {
      format = 'wav';
    }
    // Check for WebM (starts with 0x1A 0x45 0xDF 0xA3)
    else if (input[0] === 0x1A && input[1] === 0x45 && input[2] === 0xDF && input[3] === 0xA3) {
      format = 'webm';
    }
    // Check for MP3 (starts with 0xFF 0xFB or 0xFF 0xF3)
    else if (input[0] === 0xFF && (input[1] === 0xFB || input[1] === 0xF3)) {
      format = 'mp3';
    }
  }
  
  logger.log('[audioDecode] Decoding audio:', {
    format,
    mimeType: mimeType || 'unknown',
    inputSize: input.length,
  });
  
  return new Promise((resolve, reject) => {
    const ffmpegArgs: string[] = [
      '-i', 'pipe:0',             // Read from stdin (let ffmpeg auto-detect format)
      '-ac', '1',                 // Mono (1 channel)
      '-ar', '16000',             // 16kHz sample rate
      '-f', 's16le',              // Signed 16-bit little-endian PCM
      'pipe:1',                   // Write to stdout
      '-loglevel', 'error',       // Suppress verbose output
    ];
    
    // Only specify input format if we're confident about it (WAV is reliable)
    if (format === 'wav') {
      ffmpegArgs.unshift('-f', 'wav');
    }
    
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    const chunks: Buffer[] = [];
    let stderr = '';

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    ffmpeg.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code: number) => {
      if (code === 0) {
        const pcmBuffer = Buffer.concat(chunks);
        logger.log('[audioDecode] Decoded audio:', {
          inputSize: input.length,
          outputSize: pcmBuffer.length,
          durationMs: (pcmBuffer.length / 2 / 16000) * 1000, // PCM16 = 2 bytes per sample
        });
        resolve(pcmBuffer);
      } else {
        logger.error('[audioDecode] ffmpeg failed:', code, stderr);
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.substring(0, 200)}`));
      }
    });

    ffmpeg.on('error', (error: Error) => {
      logger.error('[audioDecode] ffmpeg spawn error:', error);
      reject(new Error(`Failed to spawn ffmpeg: ${error.message}. Make sure ffmpeg is installed.`));
    });

    // Write input and close stdin
    ffmpeg.stdin.end(input);
  });
}

