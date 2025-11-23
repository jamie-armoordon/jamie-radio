/**
 * Extract embeddings from WAV files for wake word detection
 * 
 * Usage: 
 *   node scripts/extract-embeddings.js <wav-file-1.wav> [wav-file-2.wav] ...
 * 
 * Or download from GitHub and process:
 *   node scripts/extract-embeddings.js public/references/*.wav
 * 
 * Output: JSON file with embeddings array
 */

import * as ort from 'onnxruntime-node';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODEL_PATH = path.join(__dirname, '../public/models/speech-embedding.onnx');
const TARGET_SAMPLE_RATE = 16000;
const WINDOW_SIZE = 16000;

/**
 * Load WAV file and extract audio data
 */
function loadWavFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  
  // WAV header parsing
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  const numChannels = buffer.readUInt16LE(22);
  const dataOffset = 44;
  
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
 * Resample audio using linear interpolation
 */
function resample(audio, fromRate, toRate) {
  const ratio = fromRate / toRate;
  const outputLength = Math.floor(audio.length / ratio);
  const output = new Float32Array(outputLength);
  
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, audio.length - 1);
    const fraction = srcIndex - srcIndexFloor;
    
    output[i] = audio[srcIndexFloor] * (1 - fraction) + audio[srcIndexCeil] * fraction;
  }
  
  return output;
}

/**
 * Preprocess audio: RMS normalize + pad/crop to 16000 samples
 */
function preprocessAudio(audio) {
  // Pad or center-crop to exactly 16000 samples
  let processed;
  if (audio.length > WINDOW_SIZE) {
    const start = Math.floor((audio.length - WINDOW_SIZE) / 2);
    processed = audio.subarray(start, start + WINDOW_SIZE);
  } else if (audio.length < WINDOW_SIZE) {
    processed = new Float32Array(WINDOW_SIZE);
    processed.set(audio, 0);
  } else {
    processed = new Float32Array(audio);
  }
  
  // RMS normalization with floor clamp
  let sumSquares = 0;
  for (let i = 0; i < processed.length; i++) {
    sumSquares += processed[i] * processed[i];
  }
  let rms = Math.sqrt(sumSquares / processed.length);
  if (rms < 1e-3) {
    rms = 1e-3;
  }
  
  const normalized = new Float32Array(WINDOW_SIZE);
  for (let i = 0; i < processed.length; i++) {
    normalized[i] = processed[i] / rms;
  }
  
  return normalized;
}

/**
 * Extract embedding from audio
 */
async function extractEmbedding(session, audio) {
  const inputName = session.inputNames[0];
  const inputShape = [1, WINDOW_SIZE];
  
  const inputTensor = new ort.Tensor('float32', audio, inputShape);
  const outputMap = await session.run({ [inputName]: inputTensor });
  
  const outputName = session.outputNames[0];
  const output = outputMap[outputName];
  
  // Extract output data
  let outputArray;
  if (output.data instanceof Float32Array) {
    outputArray = output.data;
  } else if (output.data instanceof Float64Array) {
    outputArray = new Float32Array(output.data);
  } else {
    outputArray = new Float32Array(Array.from(output.data));
  }
  
  // Handle 4D tensor [1, 3, 1, 96] - average across time steps
  if (output.dims.length === 4 && output.dims[3] > 2) {
    const [, timeSteps, channels, embeddingDim] = output.dims;
    const averagedEmbedding = new Float32Array(embeddingDim);
    
    for (let t = 0; t < timeSteps; t++) {
      const offset = t * channels * embeddingDim;
      for (let i = 0; i < embeddingDim; i++) {
        averagedEmbedding[i] += outputArray[offset + i];
      }
    }
    
    for (let i = 0; i < embeddingDim; i++) {
      averagedEmbedding[i] /= timeSteps;
    }
    
    return averagedEmbedding;
  }
  
  // Fallback: return as-is
  return outputArray;
}

async function main() {
  const wavFiles = process.argv.slice(2);
  
  if (wavFiles.length === 0) {
    console.error('Usage: node scripts/extract-embeddings.js <wav-file-1.wav> [wav-file-2.wav] ...');
    process.exit(1);
  }
  
  console.log('Loading ONNX model...');
  const session = await ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ['cpu'],
  });
  console.log('Model loaded\n');
  
  const embeddings = [];
  
  for (const wavFile of wavFiles) {
    console.log(`Processing: ${wavFile}`);
    
    // Load WAV
    const { audio, sampleRate } = loadWavFile(wavFile);
    console.log(`  Sample rate: ${sampleRate}Hz, Length: ${audio.length} samples`);
    
    // Resample if needed
    let resampled = audio;
    if (sampleRate !== TARGET_SAMPLE_RATE) {
      resampled = resample(audio, sampleRate, TARGET_SAMPLE_RATE);
      console.log(`  Resampled to ${resampled.length} samples`);
    }
    
    // Preprocess
    const preprocessed = preprocessAudio(resampled);
    console.log(`  Preprocessed to ${preprocessed.length} samples`);
    
    // Extract embedding
    const embedding = await extractEmbedding(session, preprocessed);
    embeddings.push(Array.from(embedding));
    console.log(`  Embedding extracted: ${embedding.length} dimensions\n`);
  }
  
  // Save embeddings
  const outputPath = path.join(__dirname, '../public/models/reference-embeddings.json');
  fs.writeFileSync(outputPath, JSON.stringify(embeddings, null, 2));
  console.log(`✅ Saved ${embeddings.length} embeddings to ${outputPath}`);
}

main().catch(console.error);
