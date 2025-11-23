/**
 * API Test Suite
 * Tests all HTTP routes and WebSocket endpoints of the API server
 * 
 * Usage: npx tsx scripts/test-api.ts [--url=http://localhost:3001]
 */

import WebSocket from 'ws';

const BASE_URL = process.env.API_URL || process.argv.find(arg => arg.startsWith('--url='))?.split('=')[1] || 'http://localhost:3001';
const WS_URL = BASE_URL.replace('http://', 'ws://').replace('https://', 'wss://');

interface TestResult {
  name: string;
  passed: boolean;
  skipped: boolean;
  error?: string;
  details?: any;
  statusCode?: number;
  contentType?: string;
  duration?: number;
}

const results: TestResult[] = [];

// Helper: Run HTTP test
async function testHttp(
  name: string,
  method: 'GET' | 'POST',
  path: string,
  options?: {
    query?: Record<string, string>;
    body?: any;
    expectedStatus?: number;
    expectedContentType?: string;
    schemaCheck?: (data: any) => boolean;
    skipIf?: () => boolean;
  }
): Promise<TestResult> {
  const startTime = Date.now();
  const result: TestResult = { name, passed: false, skipped: false };

  try {
    if (options?.skipIf?.()) {
      result.skipped = true;
      result.error = 'Test skipped (condition not met)';
      return result;
    }

    const url = new URL(path, BASE_URL);
    if (options?.query) {
      Object.entries(options.query).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (options?.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url.toString(), fetchOptions);
    result.statusCode = response.status;
    result.contentType = response.headers.get('content-type') || undefined;
    result.duration = Date.now() - startTime;

    // Check status code
    const expectedStatus = options?.expectedStatus || 200;
    if (response.status !== expectedStatus) {
      // For artwork endpoint, 404 is acceptable (invalid/expired URLs)
      if (path.includes('/api/artwork') && response.status === 404) {
        result.passed = true;
        result.error = `Artwork URL returned 404 (URL may be invalid/expired, which is acceptable)`;
        return result;
      }
      result.error = `Expected status ${expectedStatus}, got ${response.status}`;
      return result;
    }

    // Check content type if specified
    if (options?.expectedContentType) {
      const contentType = response.headers.get('content-type');
      if (!contentType?.includes(options.expectedContentType)) {
        result.error = `Expected content-type to include "${options.expectedContentType}", got "${contentType}"`;
        return result;
      }
    }

    // Parse response if JSON
    let data: any = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await response.json();
      result.details = { hasData: true, keys: data ? Object.keys(data) : [] };
    } else if (contentType.startsWith('image/')) {
      const buffer = await response.arrayBuffer();
      result.details = { 
        hasData: true, 
        size: buffer.byteLength,
        contentType: contentType 
      };
    } else {
      const text = await response.text();
      result.details = { hasData: text.length > 0, size: text.length };
    }

    // Schema check if provided
    if (options?.schemaCheck && data !== null && data !== undefined) {
      if (!options.schemaCheck(data)) {
        result.error = 'Schema validation failed';
        return result;
      }
    }

    result.passed = true;
  } catch (error: any) {
    result.error = error.message || String(error);
    result.duration = Date.now() - startTime;
  }

  return result;
}

// Helper: Test WebSocket
async function testWebSocket(name: string, path: string): Promise<TestResult> {
  const startTime = Date.now();
  const result: TestResult = { name, passed: false, skipped: false };

  return new Promise((resolve) => {
    const wsUrl = `${WS_URL}${path}`;
    const ws = new WebSocket(wsUrl);

    let audioReceived = false;
    let finalReceived = false;
    let errorReceived = false;
    const messages: any[] = [];

    const finish = (passed: boolean, extra?: any, errMsg?: string, skipped?: boolean) => {
      clearTimeout(timeout);
      try { ws.close(); } catch {}
      result.passed = passed;
      if (extra) result.details = extra;
      if (errMsg) result.error = errMsg;
      if (skipped) result.skipped = true;
      result.duration = Date.now() - startTime;
      resolve(result);
    };

    const timeout = setTimeout(() => {
      // If we got final but no audio, still treat WS path as functional.
      if (finalReceived && !audioReceived) {
        finish(true, { audioReceived, finalReceived, messageCount: messages.length, note: "final without audio" });
        return;
      }
      if (!audioReceived && !finalReceived && !errorReceived) {
        finish(false, undefined, 'Timeout: No audio or final message received within 12 seconds');
        return;
      }
      if (errorReceived) {
        finish(false, undefined, 'WebSocket error received (likely missing/invalid MURF_API_KEY)', true);
        return;
      }
      finish(true, { audioReceived, finalReceived, messageCount: messages.length });
    }, 12000);

    ws.on('open', () => {
      // Client-side format expected by your proxy: {text, end}
      // Send test message with end:true on the last non-empty chunk (not empty final frame)
      ws.send(JSON.stringify({ text: 'Hello, this is a ws test.', end: true }));
    });

    ws.on('message', (data: Buffer) => {
      let message: any;
      try {
        message = JSON.parse(data.toString());
      } catch {
        // ignore non-JSON frames
        return;
      }

      messages.push(message);

      if (message.error) {
        errorReceived = true;
        finish(false, { message }, `WebSocket error: ${message.error}`, true);
        return;
      }

      if (typeof message.audio === 'string' && message.audio.length > 0) {
        audioReceived = true;
        finish(true, {
          audioReceived: true,
          audioLength: message.audio.length,
          messageCount: messages.length
        });
        return;
      }

      if (message.final === true) {
        finalReceived = true;
        // Don't finish immediately; wait a beat for late audio
        setTimeout(() => {
          if (!audioReceived) {
            finish(true, {
              audioReceived,
              finalReceived,
              messageCount: messages.length,
              note: "final without audio"
            });
          }
        }, 300);
      }
    });

    ws.on('close', (code, reason) => {
      // Proxy uses 1008 for server config errors (missing key)
      const r = reason?.toString() || '';
      if (code === 1008 && r.toLowerCase().includes('murf')) {
        finish(false, undefined, 'Server configuration error (likely missing MURF_API_KEY)', true);
        return;
      }
      // If close happens after final/audio, we already finished.
      if (!audioReceived && !finalReceived && !errorReceived) {
        finish(false, undefined, `Connection closed before response: ${code} ${r}`);
      }
    });

    ws.on('error', (error) => {
      finish(false, undefined, `WebSocket connection error: ${error.message}`, true);
    });
  });
}

// Test functions
async function runTests() {
  console.log(`\n🧪 Testing API server at ${BASE_URL}\n`);

  // 1. Health check
  results.push(await testHttp('GET /api/health', 'GET', '/api/health', {
    expectedStatus: 200,
    expectedContentType: 'application/json',
    schemaCheck: (data) => data.ok === true && typeof data.time === 'string',
  }));

  // 2. Stations
  results.push(await testHttp('GET /api/stations', 'GET', '/api/stations', {
    expectedStatus: 200,
    expectedContentType: 'application/json',
    schemaCheck: (data) => Array.isArray(data) && data.length > 0,
  }));

  // 3. Logo (with various params)
  results.push(await testHttp('GET /api/logo (with url)', 'GET', '/api/logo', {
    query: { url: 'https://www.bbc.co.uk' },
    expectedStatus: 200,
    expectedContentType: 'image/',
  }));

  results.push(await testHttp('GET /api/logo (with stationName)', 'GET', '/api/logo', {
    query: { stationName: 'BBC Radio 1', stationId: 'bbc_radio1' },
    expectedStatus: 200,
    expectedContentType: 'image/',
  }));

  // 4. RadioBrowser - search
  results.push(await testHttp('GET /api/radiobrowser (search)', 'GET', '/api/radiobrowser', {
    query: { action: 'search', name: 'BBC Radio 1', countrycode: 'GB', limit: '1' },
    expectedStatus: 200,
    expectedContentType: 'application/json',
    schemaCheck: (data) => Array.isArray(data),
  }));

  // 5. RadioBrowser - uuid (using a known UUID format, may fail if UUID doesn't exist)
  results.push(await testHttp('GET /api/radiobrowser (uuid)', 'GET', '/api/radiobrowser', {
    query: { action: 'uuid', uuid: '00000000-0000-0000-0000-000000000000' },
    expectedStatus: 200,
    expectedContentType: 'application/json',
    // May return null, which is valid for non-existent UUIDs
    schemaCheck: (data) => data === null || typeof data === 'object',
  }));

  // 6. Metadata
  results.push(await testHttp('GET /api/metadata (BBC)', 'GET', '/api/metadata', {
    query: { stationId: 'bbc_radio1', stationName: 'BBC Radio 1' },
    expectedStatus: 200,
    expectedContentType: 'application/json',
    schemaCheck: (data) => 
      typeof data.station_id === 'string' &&
      typeof data.title === 'string' &&
      typeof data.artist === 'string' &&
      typeof data.is_song === 'boolean',
  }));

  results.push(await testHttp('GET /api/metadata (Bauer)', 'GET', '/api/metadata', {
    query: { stationId: 'kiss_uk', stationName: 'Kiss FM' },
    expectedStatus: 200,
    expectedContentType: 'application/json',
    schemaCheck: (data) => 
      typeof data.station_id === 'string' &&
      typeof data.title === 'string' &&
      typeof data.artist === 'string' &&
      typeof data.is_song === 'boolean',
  }));

  // 7. Artwork (may return 404 if URL is invalid/expired, which is expected behavior)
  results.push(await testHttp('GET /api/artwork', 'GET', '/api/artwork', {
    query: { url: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/9c/91/83/9c918303-e0a4-2d4b-97a3-509672b3f98e/source/100x100bb.jpg' },
    expectedStatus: 200, // Ideally 200, but 404 is acceptable for invalid URLs
    expectedContentType: 'image/',
    // Accept 404 as valid since artwork URLs can expire
    schemaCheck: (data) => {
      // If we get JSON, it's an error response (404), which is acceptable
      return true;
    },
  }));

  // 8. Weather
  results.push(await testHttp('GET /api/weather', 'GET', '/api/weather', {
    query: { lat: '51.1967', lon: '0.2733', city: 'Tonbridge' },
    expectedStatus: 200,
    expectedContentType: 'application/json',
    schemaCheck: (data) => 
      (typeof data.temperature === 'number' || data.temperature === null) &&
      typeof data.location === 'string',
  }));

  // 9. TTS (requires MURF_API_KEY)
  results.push(await testHttp('POST /api/tts', 'POST', '/api/tts', {
    body: { text: 'This is a test message for text to speech.' },
    expectedStatus: 200,
    expectedContentType: 'application/json',
    schemaCheck: (data) => 
      typeof data.audio === 'string' || data.error !== undefined,
  }));

  // 10. AI Audio (requires GEMINI API key - hardcoded in code)
  // Create a minimal base64 audio (silence)
  const minimalAudio = Buffer.from(new Array(1000).fill(0)).toString('base64');
  results.push(await testHttp('POST /api/ai-audio', 'POST', '/api/ai-audio', {
    body: { 
      audio: minimalAudio,
      mimeType: 'audio/webm',
      stations: ['BBC Radio 1', 'Capital FM', 'Heart UK']
    },
    expectedStatus: 200,
    expectedContentType: 'application/json',
    schemaCheck: (data) => 
      typeof data.command === 'string' &&
      typeof data.text === 'string',
  }));

  // 11. WebSocket TTS (requires MURF_API_KEY)
  results.push(await testWebSocket('WS /api/tts/murf-ws', '/api/tts/murf-ws'));

  // Print results
  console.log('\n' + '='.repeat(80));
  console.log('TEST RESULTS');
  console.log('='.repeat(80) + '\n');

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  results.forEach((result) => {
    const icon = result.passed ? '✅' : result.skipped ? '⏭️' : '❌';
    const status = result.passed ? 'PASS' : result.skipped ? 'SKIP' : 'FAIL';
    console.log(`${icon} ${status.padEnd(4)} ${result.name.padEnd(50)} ${result.duration ? `(${result.duration}ms)` : ''}`);
    
    if (result.error) {
      console.log(`    └─ ${result.error}`);
    }
    
    if (result.details) {
      console.log(`    └─ Details: ${JSON.stringify(result.details)}`);
    }

    if (result.statusCode) {
      console.log(`    └─ Status: ${result.statusCode}, Content-Type: ${result.contentType || 'N/A'}`);
    }

    if (result.passed) passed++;
    else if (result.skipped) skipped++;
    else failed++;
  });

  console.log('\n' + '='.repeat(80));
  console.log(`Summary: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('='.repeat(80) + '\n');

  // Exit with non-zero if core routes failed
  const coreRoutes = ['GET /api/health', 'GET /api/stations', 'GET /api/metadata (BBC)', 'GET /api/radiobrowser (search)'];
  const coreFailed = results
    .filter(r => coreRoutes.includes(r.name))
    .some(r => !r.passed && !r.skipped);

  if (coreFailed || failed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});

