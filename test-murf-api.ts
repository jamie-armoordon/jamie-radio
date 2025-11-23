#!/usr/bin/env node
/**
 * Test script for Murf AI Falcon TTS API
 * Tests the endpoint directly without using the app
 */

import 'dotenv/config';
import { writeFileSync } from 'fs';
import { join } from 'path';

const MURF_API_KEY = process.env.MURF_API_KEY || '';
const ENDPOINT = 'https://uk.api.murf.ai/v1/speech/stream';
const VOICE_ID = 'Zion'; // Radio-like voice
const TEST_TEXT = 'Hello, this is a test of Murf AI Falcon text to speech. It should sound like a radio DJ.';

async function testMurfAPI() {
  console.log('🧪 Testing Murf AI Falcon TTS API...\n');
  
  if (!MURF_API_KEY) {
    console.error('❌ Error: MURF_API_KEY environment variable not set');
    console.log('   Please add MURF_API_KEY to your .env file');
    process.exit(1);
  }
  
  console.log(`📋 Configuration:`);
  console.log(`   Endpoint: ${ENDPOINT}`);
  console.log(`   Voice ID: ${VOICE_ID}`);
  console.log(`   Text: "${TEST_TEXT}"`);
  console.log(`   API Key: ${MURF_API_KEY.substring(0, 10)}...`);
  console.log('');
  
  try {
    console.log('📤 Sending request to Murf AI...');
    const startTime = Date.now();
    
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MURF_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: TEST_TEXT,
        voice_id: VOICE_ID,
        model: 'falcon',
        language: 'en-US',
      }),
    });
    
    const elapsed = Date.now() - startTime;
    console.log(`⏱️  Request completed in ${elapsed}ms`);
    console.log(`📊 Response status: ${response.status} ${response.statusText}`);
    console.log(`📊 Response headers:`, Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ API Error: ${response.status} ${response.statusText}`);
      console.error(`   Error details: ${errorText}`);
      process.exit(1);
    }
    
    // Get content type
    const contentType = response.headers.get('content-type') || 'unknown';
    console.log(`📦 Content-Type: ${contentType}`);
    
    // Read the audio stream
    console.log('📥 Reading audio stream...');
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    console.log(`✅ Success! Received ${buffer.length} bytes of audio data`);
    console.log(`   Audio size: ${(buffer.length / 1024).toFixed(2)} KB`);
    
    // Convert to base64 for comparison with app
    const base64Audio = buffer.toString('base64');
    console.log(`   Base64 length: ${base64Audio.length} characters`);
    
    // Save to file for testing
    const outputPath = join(process.cwd(), 'test-murf-output.wav');
    writeFileSync(outputPath, buffer);
    console.log(`💾 Audio saved to: ${outputPath}`);
    console.log(`   You can play this file to hear the TTS output`);
    
    // Check if it's WAV format (should start with "RIFF")
    if (buffer.length >= 4) {
      const header = buffer.toString('ascii', 0, 4);
      if (header === 'RIFF') {
        console.log('✅ Audio format: WAV (RIFF header detected)');
      } else {
        console.log(`⚠️  Audio format: Unknown (header: ${header})`);
      }
    }
    
    console.log('\n✅ Test completed successfully!');
    console.log('   The API is working correctly.');
    
  } catch (error: any) {
    console.error('\n❌ Test failed:');
    console.error(`   Error: ${error.message}`);
    if (error.stack) {
      console.error(`   Stack: ${error.stack}`);
    }
    process.exit(1);
  }
}

// Run the test
testMurfAPI();

