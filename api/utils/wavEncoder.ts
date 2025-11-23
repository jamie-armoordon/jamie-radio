/**
 * Convert PCM16 audio data to WAV format
 * Used for preparing trimmed audio for transcription
 */

import { logger } from '../_utils/logger.js';

/**
 * Convert PCM16 mono audio to WAV format (base64-encoded)
 * @param pcm16 - Buffer containing PCM16 mono audio data
 * @param sampleRate - Sample rate (default 16000)
 * @returns Base64-encoded WAV file
 */
export function pcm16ToWav(pcm16: Buffer, sampleRate: number = 16000): string {
  const numChannels = 1; // Mono
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcm16.length;
  const fileSize = 36 + dataSize; // 36 = header size, dataSize = PCM data size

  // Create WAV header (44 bytes)
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
  const wavBuffer = Buffer.concat([header, pcm16]);
  return wavBuffer.toString('base64');
}

/**
 * Trim PCM16 audio to specified time segments
 * @param pcm16 - Buffer containing PCM16 mono audio data
 * @param segments - Array of {startMs, endMs} segments to extract
 * @param sampleRate - Sample rate (default 16000)
 * @returns Trimmed PCM16 buffer containing only the specified segments
 */
export function trimPcm16ToSegments(
  pcm16: Buffer,
  segments: Array<{ startMs: number; endMs: number }>,
  sampleRate: number = 16000
): Buffer {
  if (segments.length === 0) {
    return Buffer.alloc(0);
  }

  const bytesPerSample = 2; // PCM16 = 2 bytes per sample
  const samplesPerMs = sampleRate / 1000;
  const totalSamples = pcm16.length / bytesPerSample;
  const totalDurationMs = (totalSamples / sampleRate) * 1000;
  const chunks: Buffer[] = [];

  for (const seg of segments) {
    const startSample = Math.floor(seg.startMs * samplesPerMs);
    const endSample = Math.ceil(seg.endMs * samplesPerMs);
    const startByte = startSample * bytesPerSample;
    const endByte = Math.min(endSample * bytesPerSample, pcm16.length);
    
    // Sanity check: log if segment is out of bounds
    if (startSample >= totalSamples || endSample <= 0) {
      logger.warn('[wavEncoder] Segment out of bounds:', {
        segment: { startMs: seg.startMs.toFixed(1), endMs: seg.endMs.toFixed(1) },
        samples: { startSample, endSample, totalSamples },
        totalDurationMs: totalDurationMs.toFixed(1),
      });
      continue;
    }
    
    if (startByte < pcm16.length && endByte > startByte && startByte >= 0) {
      chunks.push(pcm16.slice(startByte, endByte));
    } else {
      logger.warn('[wavEncoder] Invalid segment byte range:', {
        segment: { startMs: seg.startMs.toFixed(1), endMs: seg.endMs.toFixed(1) },
        bytes: { startByte, endByte, pcm16Length: pcm16.length },
      });
    }
  }

  const trimmed = Buffer.concat(chunks);
  logger.log('[wavEncoder] Trim result:', {
    inputLength: pcm16.length,
    inputSamples: totalSamples,
    inputDurationMs: totalDurationMs.toFixed(1),
    segmentCount: segments.length,
    trimmedLength: trimmed.length,
    trimmedSamples: trimmed.length / bytesPerSample,
    trimmedDurationMs: ((trimmed.length / bytesPerSample) / sampleRate * 1000).toFixed(1),
  });

  return trimmed;
}

