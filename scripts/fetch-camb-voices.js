#!/usr/bin/env node

/**
 * Script to fetch available voices from Camb.ai API
 * Usage: node scripts/fetch-camb-voices.js
 * Requires CAMB_AI_API_KEY environment variable
 */

import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = 'https://client.camb.ai/apis';
const API_KEY = process.env.CAMB_AI_API_KEY;

if (!API_KEY) {
  console.error('❌ CAMB_AI_API_KEY environment variable not set!');
  console.error('   Set it in your .env file or export it:');
  console.error('   export CAMB_AI_API_KEY=your_api_key_here');
  process.exit(1);
}

console.log('🔍 Fetching available voices from Camb.ai...\n');

// Try different possible endpoints
const endpoints = [
  { path: '/list_voices', name: '/list_voices' }, // Correct endpoint (with underscore)
  { path: '/list-voices', name: '/list-voices' },
  { path: '/voices', name: '/voices' },
  { path: '/voice/list', name: '/voice/list' },
  { path: '/voice', name: '/voice' },
];

let voices = [];
let workingEndpoint = null;

for (const endpoint of endpoints) {
  try {
    console.log(`Trying endpoint: ${endpoint.name}...`);
    const response = await fetch(`${BASE_URL}${endpoint.path}`, {
      headers: {
        'Accept': 'application/json',
        'x-api-key': API_KEY,
      },
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Success! Response structure:`, JSON.stringify(data, null, 2).substring(0, 500));
      
      // Try different response structures
      const possibleVoices = 
        data.voices || 
        data.payload?.voices || 
        data.data || 
        data.results ||
        (Array.isArray(data) ? data : null);
      
      if (Array.isArray(possibleVoices) && possibleVoices.length > 0) {
        voices = possibleVoices;
        workingEndpoint = endpoint.path;
        console.log(`\n✅ Found ${voices.length} voices using endpoint: ${endpoint.name}\n`);
        break;
      } else {
        console.log(`⚠️  Endpoint returned data but no voices array found`);
      }
    } else {
      const errorText = await response.text();
      console.log(`❌ Failed: ${response.status} ${response.statusText}`);
      if (errorText) {
        console.log(`   Error: ${errorText.substring(0, 200)}`);
      }
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
  console.log('');
}

if (voices.length === 0) {
  console.error('❌ Could not fetch voices from any endpoint!');
  console.error('   The API might have changed or your API key might not have access.');
  process.exit(1);
}

// Display voices
console.log('📋 Available Voices:');
console.log('='.repeat(80));
voices.forEach((voice, index) => {
  const voiceId = voice.voice_id || voice.id || voice.voiceId || 'N/A';
  const name = voice.name || voice.voice_name || 'Unnamed';
  const gender = voice.gender || voice.gender_id || 'N/A';
  const language = voice.language || voice.language_id || voice.language_name || 'N/A';
  const age = voice.age || 'N/A';
  
  console.log(`\n${index + 1}. Voice ID: ${voiceId}`);
  console.log(`   Name: ${name}`);
  console.log(`   Gender: ${gender} ${gender === 1 || gender === 'MALE' || gender === 'male' ? '(MALE)' : ''}`);
  console.log(`   Language: ${language}`);
  console.log(`   Age: ${age}`);
  if (voice.description) console.log(`   Description: ${voice.description}`);
});

// Find male English voices
const maleEnglishVoices = voices.filter(v => {
  const gender = v.gender || v.gender_id;
  const language = v.language || v.language_id;
  return (gender === 1 || gender === 'MALE' || gender === 'male') && 
         (language === 1 || language === 'en' || language === 'English');
});

console.log('\n\n🎯 Male English Voices (Best for radio):');
console.log('='.repeat(80));
if (maleEnglishVoices.length > 0) {
  maleEnglishVoices.forEach((voice, index) => {
    const voiceId = voice.voice_id || voice.id || voice.voiceId;
    const name = voice.name || voice.voice_name || 'Unnamed';
    console.log(`${index + 1}. Voice ID: ${voiceId} - ${name}`);
  });
  
  const recommendedVoiceId = maleEnglishVoices[0].voice_id || maleEnglishVoices[0].id || maleEnglishVoices[0].voiceId;
  console.log(`\n✅ Recommended Voice ID: ${recommendedVoiceId}`);
  
  // Update the code files
  console.log('\n📝 Updating code files...');
  
  const filesToUpdate = [
    join(__dirname, '..', 'api', 'tts.ts'),
    join(__dirname, '..', 'api', 'ai-audio.ts'),
  ];
  
  for (const filePath of filesToUpdate) {
    try {
      let content = readFileSync(filePath, 'utf8');
      
      // Update the fallback voice IDs to include the recommended one first
      const fallbackPattern = /const fallbackVoiceIds = \[.*?\];/s;
      const newFallback = `const fallbackVoiceIds = [${recommendedVoiceId}, 1, 2, 3, 10, 100, 1000];`;
      
      if (fallbackPattern.test(content)) {
        content = content.replace(fallbackPattern, newFallback);
        writeFileSync(filePath, content, 'utf8');
        console.log(`   ✅ Updated ${filePath.split(/[/\\]/).pop()}`);
      } else {
        console.log(`   ⚠️  Could not find fallbackVoiceIds pattern in ${filePath.split(/[/\\]/).pop()}`);
      }
    } catch (error) {
      console.error(`   ❌ Error updating ${filePath}:`, error.message);
    }
  }
  
  console.log('\n✅ Done! Restart your API server to use the new voice ID.');
} else {
  console.log('⚠️  No male English voices found. Using first available voice.');
  const firstVoiceId = voices[0].voice_id || voices[0].id || voices[0].voiceId;
  console.log(`   First voice ID: ${firstVoiceId}`);
  
  // Still update the code with the first voice
  const filesToUpdate = [
    join(__dirname, '..', 'api', 'tts.ts'),
    join(__dirname, '..', 'api', 'ai-audio.ts'),
  ];
  
  for (const filePath of filesToUpdate) {
    try {
      let content = readFileSync(filePath, 'utf8');
      const fallbackPattern = /const fallbackVoiceIds = \[.*?\];/s;
      const newFallback = `const fallbackVoiceIds = [${firstVoiceId}, 1, 2, 3, 10, 100, 1000];`;
      
      if (fallbackPattern.test(content)) {
        content = content.replace(fallbackPattern, newFallback);
        writeFileSync(filePath, content, 'utf8');
        console.log(`   ✅ Updated ${filePath.split(/[/\\]/).pop()}`);
      }
    } catch (error) {
      console.error(`   ❌ Error updating ${filePath}:`, error.message);
    }
  }
}

console.log('\n📊 Summary:');
console.log(`   Total voices: ${voices.length}`);
console.log(`   Male English voices: ${maleEnglishVoices.length}`);
console.log(`   Working endpoint: ${workingEndpoint || 'N/A'}`);

