/**
 * Server-side VAD (Voice Activity Detection) using node-vad
 * Processes PCM16 audio to detect speech segments
 */

import VAD from 'node-vad';
import { logger } from '../_utils/logger.js';

export type VadSegment = {
  startMs: number;
  endMs: number;
};

export type VadResult = {
  segments: VadSegment[];
  speechDurationMs: number;
  speechRatio: number;
};

/**
 * Run VAD on PCM16 mono audio @ 16kHz
 * @param pcm16 - Buffer containing PCM16 mono audio data @ 16kHz
 * @param sampleRate - Sample rate (default 16000)
 * @returns VAD result with speech segments and metrics
 */
export async function runVadOnPcm16(
  pcm16: Buffer,
  sampleRate: number = 16000
): Promise<VadResult> {
  return new Promise((resolve, reject) => {
    try {
      // Create VAD stream with VERY_AGGRESSIVE mode for better speech detection
      const vadStream = VAD.createStream({
        mode: VAD.Mode.VERY_AGGRESSIVE,
        audioFrequency: sampleRate,
        debounceTime: 300, // 300ms debounce (lower than 1000ms to avoid cutting short commands)
      });

      const segments: VadSegment[] = [];
      let currentSegment: { startSample: number } | null = null;
      let totalSamplesWritten = 0;

      vadStream.on('data', (data: any) => {
        const speech = data.speech;
        
        if (speech.start) {
          // Speech started - always use sample-based timing (clip-relative)
          // Don't trust speech.startTime from node-vad (may be absolute/incorrect)
          const startSample = totalSamplesWritten;
          currentSegment = { startSample };
        } else if (speech.end && currentSegment) {
          // Speech ended - always use sample-based timing
          // Don't trust speech.endTime from node-vad (may be absolute/incorrect)
          const endSample = totalSamplesWritten;
          
          if (endSample > currentSegment.startSample) {
            // Convert samples to ms for segment storage
            segments.push({
              startMs: (currentSegment.startSample / sampleRate) * 1000,
              endMs: (endSample / sampleRate) * 1000,
            });
          }
          currentSegment = null;
        }
      });

      vadStream.on('error', (error: any) => {
        logger.error('[VAD] Stream error:', error);
        reject(new Error(`VAD stream error: ${error?.message || 'unknown error'}`));
      });

      vadStream.on('end', () => {
        // Close any open segment at stream end
        if (currentSegment) {
          const endSample = totalSamplesWritten;
          if (endSample > currentSegment.startSample) {
            segments.push({
              startMs: (currentSegment.startSample / sampleRate) * 1000,
              endMs: (endSample / sampleRate) * 1000,
            });
          }
          currentSegment = null;
        }

        const totalDurationMs = (pcm16.length / 2 / sampleRate) * 1000; // PCM16 = 2 bytes per sample
        const totalSamples = pcm16.length / 2;
        
        // Process segments: merge gaps < 250ms, add pre/post roll, clamp to clip bounds
        const processedSegments = processSegments(segments, totalDurationMs);
        
        const speechDurationMs = processedSegments.reduce(
          (sum, seg) => sum + (seg.endMs - seg.startMs),
          0
        );
        const speechRatio = totalDurationMs > 0 ? speechDurationMs / totalDurationMs : 0;

        logger.log('[VAD] Processing complete:', {
          pcm16Length: pcm16.length,
          totalSamples,
          totalSamplesWritten,
          totalDurationMs: totalDurationMs.toFixed(1),
          rawSegmentCount: segments.length,
          segmentCount: processedSegments.length,
          speechDurationMs: speechDurationMs.toFixed(1),
          speechRatio: speechRatio.toFixed(3),
          segments: processedSegments.map(s => ({ 
            startMs: s.startMs.toFixed(1), 
            endMs: s.endMs.toFixed(1),
            durationMs: (s.endMs - s.startMs).toFixed(1)
          })),
        });

        resolve({
          segments: processedSegments,
          speechDurationMs,
          speechRatio,
        });
      });

      // Write PCM data in chunks (~960 bytes = 30ms @ 16kHz)
      // node-vad expects chunks of appropriate size for stream processing
      const chunkSize = 960; // 30ms @ 16kHz = 480 samples * 2 bytes = 960 bytes
      const samplesPerChunk = chunkSize / 2; // PCM16 = 2 bytes per sample
      let offset = 0;

      const writeChunk = () => {
        if (offset >= pcm16.length) {
          // Close any open segment at the end
          if (currentSegment) {
            const endSample = totalSamplesWritten;
            if (endSample > currentSegment.startSample) {
              segments.push({
                startMs: (currentSegment.startSample / sampleRate) * 1000,
                endMs: (endSample / sampleRate) * 1000,
              });
            }
            currentSegment = null;
          }
          vadStream.end();
          return;
        }

        const chunk = pcm16.slice(offset, offset + chunkSize);
        offset += chunkSize;
        totalSamplesWritten += samplesPerChunk;

        try {
          const canContinue = vadStream.write(chunk);
          if (!canContinue) {
            // Wait for drain if buffer is full
            vadStream.once('drain', writeChunk);
          } else if (offset < pcm16.length) {
            // Continue writing
            setImmediate(writeChunk);
          } else {
            // Last chunk - close any open segment
            if (currentSegment) {
              const endSample = totalSamplesWritten;
              if (endSample > currentSegment.startSample) {
                segments.push({
                  startMs: (currentSegment.startSample / sampleRate) * 1000,
                  endMs: (endSample / sampleRate) * 1000,
                });
              }
              currentSegment = null;
            }
            vadStream.end();
          }
        } catch (error: any) {
          logger.error('[VAD] Write error:', error);
          reject(new Error(`VAD write error: ${error?.message || 'unknown error'}`));
        }
      };

      writeChunk();
    } catch (error: any) {
      logger.error('[VAD] Initialization error:', error);
      reject(new Error(`VAD initialization failed: ${error?.message || 'unknown error'}`));
    }
  });
}

/**
 * Process VAD segments: merge gaps < 250ms, add pre-roll (500ms for first segment, 150ms for others) and post-roll (250ms),
 * and clamp to clip bounds to prevent out-of-range segments
 * @param segments - Raw VAD segments
 * @param totalDurationMs - Total clip duration in milliseconds
 * @returns Processed and clamped segments
 */
function processSegments(segments: VadSegment[], totalDurationMs: number): VadSegment[] {
  if (segments.length === 0) return [];

  // Sort by start time
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);

  // Merge segments with gaps < 250ms
  const merged: VadSegment[] = [];
  let current = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].startMs - current.endMs;
    if (gap < 250) {
      // Merge: extend current segment
      current.endMs = sorted[i].endMs;
    } else {
      // Gap too large: start new segment
      merged.push(current);
      current = { ...sorted[i] };
    }
  }
  merged.push(current);

  // Add pre-roll and post-roll, then clamp to clip bounds
  // First segment: always include first 500ms of clip to capture wake words like "hey jarvis"
  // If first segment starts after 0ms, extend it back to 0ms
  // Subsequent segments get standard pre-roll (150ms)
  const withRoll = merged.map((seg, index) => {
    if (index === 0) {
      // First segment: always start from 0ms to capture wake word at beginning of recording
      // This ensures we include "hey jarvis" even if VAD detects speech slightly later
      return {
        startMs: 0,
        endMs: seg.endMs + 250,
      };
    } else {
      return {
        startMs: Math.max(0, seg.startMs - 150),
        endMs: seg.endMs + 250,
      };
    }
  });

  // Clamp segments to valid range and drop invalid ones
  const clamped: VadSegment[] = [];
  for (const seg of withRoll) {
    // Drop segments that are completely out of bounds or invalid
    if (seg.startMs >= totalDurationMs || seg.endMs <= 0 || seg.startMs >= seg.endMs) {
      logger.warn('[VAD] Dropping out-of-bounds segment:', {
        startMs: seg.startMs.toFixed(1),
        endMs: seg.endMs.toFixed(1),
        totalDurationMs: totalDurationMs.toFixed(1),
      });
      continue;
    }

    // Clamp to valid range
    const clampedStart = Math.max(0, seg.startMs);
    const clampedEnd = Math.min(totalDurationMs, seg.endMs);

    // Drop if segment becomes too small after clamping (>200ms beyond bounds)
    if (clampedEnd - clampedStart < 50) {
      logger.warn('[VAD] Dropping segment too small after clamping:', {
        original: { startMs: seg.startMs.toFixed(1), endMs: seg.endMs.toFixed(1) },
        clamped: { startMs: clampedStart.toFixed(1), endMs: clampedEnd.toFixed(1) },
        totalDurationMs: totalDurationMs.toFixed(1),
      });
      continue;
    }

    // Recompute duration from clamped bounds
    clamped.push({
      startMs: clampedStart,
      endMs: clampedEnd,
    });
  }

  return clamped;
}

