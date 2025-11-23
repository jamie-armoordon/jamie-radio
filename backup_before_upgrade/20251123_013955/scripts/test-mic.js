/**
 * Live microphone test for wake word detection
 * 
 * Usage: npm run test:mic
 * 
 * This script captures live microphone audio, applies preprocessing,
 * and runs inference continuously to show probability scores.
 * 
 * NOTE: Live microphone testing in Node.js requires additional audio libraries.
 * For best results, use the browser test page at /wake-test
 */

import * as ort from 'onnxruntime-node';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODEL_PATH = path.join(__dirname, '../public/models/jamie_noise_robust.onnx');
const TARGET_SAMPLE_RATE = 16000;
const WINDOW_SIZE = 16000; // 1 second

/**
 * Preprocess audio to match training pipeline exactly
 * 
 * Training preprocessing (MUST MATCH 1:1):
 * 1. RMS normalize: audio = audio / rms (where rms = sqrt(mean(audio**2)))
 * 2. Pad or center-crop to exactly 16000 samples
 * 3. Output float32 array length 16000
 */
function preprocessAudio(audio) {
  // Step 1: Pad or center-crop to exactly 16000 samples
  let processed;
  
  if (audio.length > WINDOW_SIZE) {
    // Center crop: take middle 16000 samples
    const start = Math.floor((audio.length - WINDOW_SIZE) / 2);
    processed = audio.subarray(start, start + WINDOW_SIZE);
  } else if (audio.length < WINDOW_SIZE) {
    // Pad at end with zeros
    processed = new Float32Array(WINDOW_SIZE);
    processed.set(audio, 0);
  } else {
    processed = new Float32Array(audio);
  }
  
  // Step 2: RMS normalization (matches training: audio = audio / rms)
  let sumSquares = 0;
  for (let i = 0; i < processed.length; i++) {
    sumSquares += processed[i] * processed[i];
  }
  const rms = Math.sqrt(sumSquares / processed.length);
  
  const normalized = new Float32Array(WINDOW_SIZE);
  if (rms > 0.0001) {
    for (let i = 0; i < processed.length; i++) {
      normalized[i] = processed[i] / rms;
    }
  } else {
    normalized.fill(0);
  }
  
  return { normalized, rms };
}

console.log(`
===== Live Microphone Test =====
This script requires microphone access and audio recording libraries.

For Node.js, you may need:
- node-record-lpcm16
- @suldashi/lame
- or use Web Audio API in browser

The browser test page at /wake-test is recommended for live testing.

To test in browser:
1. Run: npm run dev
2. Navigate to: http://localhost:5173/wake-test
3. Click "Enable" and speak "Jamie"

For WAV file testing, use: npm run test:wav <file.wav>

Note: Live mic testing is better done in the browser at /wake-test
where the full AudioWorklet pipeline with polyphase downsampling is available.
`);

process.exit(0);

