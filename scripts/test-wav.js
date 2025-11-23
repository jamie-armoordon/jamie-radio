/**
 * Test wake word detection on a WAV file
 * 
 * Usage: npm run test:wav <path/to/file.wav>
 * 
 * This script loads a WAV file, applies the same preprocessing as the browser,
 * and runs inference to get the probability score.
 */

import * as ort from 'onnxruntime-node';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODEL_PATH = path.join(__dirname, '../public/models/jamie_noise_robust.onnx');
const TARGET_SAMPLE_RATE = 16000;
const WINDOW_SIZE = 16000; // 1 second

/**
 * Load WAV file and extract audio data
 * Simple WAV parser (assumes PCM, 16-bit, mono)
 */
function loadWavFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  
  // WAV header parsing (simplified)
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  const numChannels = buffer.readUInt16LE(22);
  const dataOffset = 44; // Standard WAV header size
  
  console.log(`[WAV] Sample rate: ${sampleRate}Hz`);
  console.log(`[WAV] Bits per sample: ${bitsPerSample}`);
  console.log(`[WAV] Channels: ${numChannels}`);
  
  // Read audio data (16-bit PCM)
  const audioData = new Int16Array(
    buffer.buffer,
    buffer.byteOffset + dataOffset,
    (buffer.length - dataOffset) / 2
  );
  
  // Convert to float32 [-1, 1]
  const floatData = new Float32Array(audioData.length);
  for (let i = 0; i < audioData.length; i++) {
    floatData[i] = audioData[i] / 32768.0;
  }
  
  return {
    audio: floatData,
    sampleRate,
    numChannels
  };
}

/**
 * Resample audio using simple linear interpolation
 * (For testing - browser uses polyphase filtering with anti-aliasing)
 * Note: This is a simplified resampler for testing. The browser worklet
 * uses proper polyphase filtering, but for WAV file testing this is sufficient.
 */
function resample(audio, fromRate, toRate) {
  const ratio = fromRate / toRate;
  const outputLength = Math.floor(audio.length / ratio);
  const output = new Float32Array(outputLength);
  
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const index = Math.floor(srcIndex);
    const fraction = srcIndex - index;
    
    if (index + 1 < audio.length) {
      output[i] = audio[index] * (1 - fraction) + audio[index + 1] * fraction;
    } else {
      output[i] = audio[index] || 0;
    }
  }
  
  return output;
}

/**
 * Preprocess audio to match training pipeline exactly
 * 
 * Training preprocessing (MUST MATCH 1:1):
 * 1. RMS normalize: audio = audio / rms (where rms = sqrt(mean(audio**2)))
 * 2. Pad or center-crop to exactly 16000 samples
 * 3. Output float32 array length 16000
 * 
 * NO peak normalization
 * NO per-chunk scaling
 * NO amplitude hacks
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
    // Remainder is already zeros
  } else {
    // Exactly 16000 samples
    processed = new Float32Array(audio);
  }
  
  // Step 2: Calculate RMS before normalization (for debug)
  let sumSquares = 0;
  for (let i = 0; i < processed.length; i++) {
    sumSquares += processed[i] * processed[i];
  }
  const rms = Math.sqrt(sumSquares / processed.length);
  
  // Step 3: RMS normalization (matches training: audio = audio / rms)
  const normalized = new Float32Array(WINDOW_SIZE);
  if (rms > 0.0001) {
    for (let i = 0; i < processed.length; i++) {
      normalized[i] = processed[i] / rms;
    }
  } else {
    // Silence - return zeros
    normalized.fill(0);
  }
  
  // Debug logging (matches requirements)
  console.log(`[Preprocess] RMS before normalization: ${rms.toFixed(6)}`);
  console.log(`[Preprocess] First 10 preprocessed samples: [${Array.from(normalized.slice(0, 10)).map(v => v.toFixed(6)).join(', ')}]`);
  
  return normalized;
}

async function testWavFile(wavPath) {
  try {
    console.log(`\n===== Testing WAV File: ${wavPath} =====\n`);
    
    // Step 1: Load WAV file
    console.log('[1/5] Loading WAV file...');
    const { audio, sampleRate } = loadWavFile(wavPath);
    console.log(`[1/5] Loaded ${audio.length} samples at ${sampleRate}Hz\n`);
    
    // Step 2: Resample to 16kHz if needed
    let resampled = audio;
    if (sampleRate !== TARGET_SAMPLE_RATE) {
      console.log(`[2/5] Resampling from ${sampleRate}Hz to ${TARGET_SAMPLE_RATE}Hz...`);
      resampled = resample(audio, sampleRate, TARGET_SAMPLE_RATE);
      console.log(`[2/5] Resampled to ${resampled.length} samples\n`);
    } else {
      console.log(`[2/5] No resampling needed\n`);
    }
    
    // Step 3: Preprocess (RMS normalize + pad/crop)
    console.log('[3/5] Preprocessing (RMS normalize + pad/crop)...');
    const preprocessed = preprocessAudio(resampled);
    console.log(`[3/5] Preprocessed to ${preprocessed.length} samples\n`);
    
    // Step 4: Load ONNX model
    console.log('[4/5] Loading ONNX model...');
    const session = await ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ['cpu'],
    });
    
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    console.log(`[4/5] Model loaded - Input: ${inputName}, Output: ${outputName}`);
    
    // Get input shape
    const inputMeta = session.inputMetadata[inputName];
    const inputShape = inputMeta.dims;
    console.log(`[4/5] Input shape: [${inputShape.join(', ')}]\n`);
    
    // Step 5: Run inference
    console.log('[5/5] Running inference...');
    
    // Get expected input shape from model metadata
    const inputMeta = session.inputMetadata[inputName];
    const inputShape = inputMeta.dims;
    console.log(`[5/5] Model expects input shape: [${inputShape.join(', ')}]`);
    
    // Create input tensor with model's expected shape
    const inputTensor = new ort.Tensor('float32', preprocessed, inputShape);
    console.log(`[5/5] Input tensor shape: [${inputTensor.dims.join(', ')}]`);
    
    const startTime = Date.now();
    const results = await session.run({ [inputName]: inputTensor });
    const inferenceTime = Date.now() - startTime;
    
    const output = results[outputName];
    console.log(`[5/5] Output shape: [${output.dims.join(', ')}], size: ${output.data.length}`);
    const outputArray = Array.from(output.data);
    if (outputArray.length <= 10) {
      console.log(`[5/5] Output values: [${outputArray.map(v => v.toFixed(6)).join(', ')}]`);
    } else {
      console.log(`[5/5] Output values (first 10): [${outputArray.slice(0, 10).map(v => v.toFixed(6)).join(', ')}]`);
    }
    
    // Extract probability
    let probability;
    if (output.dims.length === 0 || (output.dims.length === 1 && output.dims[0] === 1)) {
      probability = output.data[0];
    } else if (output.dims.length === 1 && output.dims[0] === 2) {
      probability = output.data[1];
    } else if (output.dims.length === 2 && output.dims[1] === 1) {
      probability = output.data[0];
    } else if (output.dims.length === 2 && output.dims[1] === 2) {
      probability = output.data[1];
    } else {
      probability = output.data[0];
    }
    
    // Results
    console.log(`\n===== Results =====`);
    console.log(`Probability: ${probability.toFixed(6)}`);
    console.log(`Inference time: ${inferenceTime}ms`);
    console.log(`\nInterpretation:`);
    if (probability >= 0.90) {
      console.log(`✅ STRONG WAKE WORD DETECTION (>= 0.90)`);
    } else if (probability >= 0.50) {
      console.log(`⚠️  MODERATE DETECTION (0.50-0.90)`);
    } else if (probability >= 0.20) {
      console.log(`⚠️  WEAK DETECTION (0.20-0.50)`);
    } else {
      console.log(`❌ NO DETECTION (< 0.20)`);
    }
    console.log(`\n`);
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Main
const wavPath = process.argv[2];
if (!wavPath) {
  console.error('Usage: npm run test:wav <path/to/file.wav>');
  process.exit(1);
}

if (!fs.existsSync(wavPath)) {
  console.error(`Error: File not found: ${wavPath}`);
  process.exit(1);
}

testWavFile(wavPath);
