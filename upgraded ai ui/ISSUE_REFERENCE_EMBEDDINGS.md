# Issue: Reference Embeddings Not Loading

## Request

**Please fix the reference embeddings loading system so that:**
1. The `loadEmbeddingsFromJSON()` function successfully fetches `/models/reference-embeddings.json`
2. The embeddings are loaded into component state
3. The `useWakewordMFCC` hook receives the embeddings and uses cosine similarity instead of magnitude heuristic
4. Console logs show successful loading (currently no logs appear)

**The file exists and is valid JSON at `public/models/reference-embeddings.json` with 3 embeddings (96 dimensions each).**

**Root cause appears to be:** The fetch is either failing silently, not being called, or the path is incorrect for Vite's dev server.

## Problem Summary

The wake word detection system is falling back to the magnitude heuristic instead of using cosine similarity with reference embeddings. The console shows:

\`\`\`
🎯 Embedding stats (no references): {shape: Array(4), magnitude: '155.5196', embeddingDim: 96, timeSteps: 3, confidence: '0.7776'}
\`\`\`

This indicates that `referenceEmbeddings.length === 0` when `runInference` is called.

## Expected Behavior

1. On component mount, `loadEmbeddingsFromJSON()` should fetch `/models/reference-embeddings.json`
2. The embeddings should be loaded into state
3. The `useWakewordMFCC` hook should receive the embeddings via props
4. The inference should use cosine similarity comparison instead of magnitude heuristic

## Current Behavior

- No console logs from `loadEmbeddingsFromJSON` function (suggests it's not being called or failing silently)
- System always uses magnitude heuristic (`refEmbeddings.length === 0`)
- Confidence values are around 0.75-0.78 (magnitude-based, not similarity-based)

## File Structure

\`\`\`
public/
  models/
    reference-embeddings.json  ✅ File exists (verified)
    speech-embedding.onnx      ✅ Model file
  references/
    okay-rhasspy-00.wav        ✅ Reference audio files
    okay-rhasspy-01.wav
    okay-rhasspy-02.wav
\`\`\`

## Code Flow

### 1. Components Loading Embeddings

**Files:**
- `src/hooks/useJamieWakeWord.ts` (lines 62-76)
- `src/pages/WakeTest.tsx` (lines 30-41)
- `src/components/WakeWordStatus.tsx` (lines 27-36)

**Code Pattern:**
\`\`\`typescript
useEffect(() => {
  loadEmbeddingsFromJSON()
    .then((embeddings) => {
      if (embeddings.length > 0) {
        setReferenceEmbeddings(embeddings);
        console.log(`Loaded ${embeddings.length} reference embeddings`);
      }
    })
    .catch((error) => {
      console.error('Error loading embeddings:', error);
    });
}, []);
\`\`\`

### 2. Loading Function

**File:** `src/utils/loadReferenceEmbeddings.ts` (lines 161-230)

**Current Implementation:**
\`\`\`typescript
export async function loadEmbeddingsFromJSON(
  jsonPath: string = '/models/reference-embeddings.json'
): Promise<Float32Array[]> {
  try {
    // Tries multiple paths:
    // - /models/reference-embeddings.json
    // - ./models/reference-embeddings.json
    // - /reference-embeddings.json
    
    const response = await fetch(path);
    // ... error handling and parsing
  } catch (error) {
    console.error('[loadEmbeddingsFromJSON] ❌ Failed:', error);
    return [];
  }
}
\`\`\`

**Expected Logs (not appearing):**
- `[loadEmbeddingsFromJSON] Loading from: /models/reference-embeddings.json`
- `[loadEmbeddingsFromJSON] Response status: 200 OK`
- `[loadEmbeddingsFromJSON] ✅ Loaded 3 embeddings...`

### 3. Hook Using Embeddings

**File:** `src/hooks/useWakewordMFCC.ts` (lines 108-242)

**Relevant Code:**
\`\`\`typescript
const runInference = useCallback(async () => {
  const refEmbeddings = referenceEmbeddings; // From props
  
  if (refEmbeddings.length > 0) {
    // Use cosine similarity
    const distance = cosineDistance(averagedEmbedding, refEmbedding);
    // ...
  } else {
    // Fallback to magnitude heuristic (current behavior)
    const magnitude = Math.sqrt(...);
    result = magnitude / 200;
  }
}, [preprocessAudio, confidenceThreshold, referenceEmbeddings, similarityThreshold]);
\`\`\`

## Verification Steps Taken

1. ✅ **File exists:** `Test-Path public/models/reference-embeddings.json` returns `True`
2. ✅ **JSON is valid:** `node -e "require('./public/models/reference-embeddings.json')"` succeeds
3. ✅ **File contains 3 embeddings:** Each with 96 dimensions
4. ✅ **Components have useEffect hooks:** All three components attempt to load embeddings
5. ❌ **No console logs:** `loadEmbeddingsFromJSON` logs are not appearing
6. ❌ **Network tab:** Need to check for fetch request to `reference-embeddings.json`

## Possible Root Causes

### 1. Fetch Path Issue
- Vite serves `public/` files at root, so `/models/reference-embeddings.json` should work
- But maybe the path needs to be different in dev vs production

### 2. Timing Issue
- Components might be calling `useWakewordMFCC` before embeddings load
- The hook might initialize with empty array and not update when embeddings arrive

### 3. Silent Failure
- Fetch might be failing but error is being caught and returning empty array
- No error logs appearing suggests either:
  - Function isn't being called
  - Errors are being swallowed
  - Console filter is hiding logs

### 4. State Update Issue
- `setReferenceEmbeddings` might not be triggering re-render
- The `useCallback` dependency array might not be updating when embeddings change

## Debugging Checklist

- [ ] Check Network tab for request to `reference-embeddings.json`
- [ ] Verify console filter isn't hiding `loadEmbeddingsFromJSON` logs
- [ ] Check if `useEffect` is actually running (add console.log at start)
- [ ] Verify `setReferenceEmbeddings` is being called
- [ ] Check if `referenceEmbeddings` prop is being passed to `useWakewordMFCC`
- [ ] Test direct URL: `http://localhost:3000/models/reference-embeddings.json`
- [ ] Check Vite dev server is serving files from `public/` correctly

## Relevant Files

- `src/utils/loadReferenceEmbeddings.ts` - Loading function
- `src/hooks/useWakewordMFCC.ts` - Main hook using embeddings
- `src/hooks/useJamieWakeWord.ts` - Wrapper hook
- `src/pages/WakeTest.tsx` - Test page
- `src/components/WakeWordStatus.tsx` - Status component
- `public/models/reference-embeddings.json` - Embeddings file (exists, valid)
- `vite.config.ts` - Vite configuration (`publicDir: 'public'`)

## Expected Console Output (When Working)

\`\`\`
[loadEmbeddingsFromJSON] Loading from: /models/reference-embeddings.json
[loadEmbeddingsFromJSON] Trying path: /models/reference-embeddings.json
[loadEmbeddingsFromJSON] Response status for /models/reference-embeddings.json: 200 OK
[loadEmbeddingsFromJSON] ✅ Successfully loaded from: /models/reference-embeddings.json
[loadEmbeddingsFromJSON] Parsed JSON: 3 embeddings
[loadEmbeddingsFromJSON] ✅ Loaded 3 embeddings, each with 96 dimensions
[useJamieWakeWord] Loaded 3 reference embeddings
[useWakewordMFCC] Using 3 reference embeddings for cosine similarity
🎯 Embedding comparison: {minDistance: 0.1234, threshold: 0.15, confidence: 0.8234, numReferences: 3}
\`\`\`

## Current Console Output (Actual)

\`\`\`
[useWakewordMFCC] No reference embeddings loaded. Using magnitude heuristic.
🎯 Embedding stats (no references): {magnitude: '155.5196', confidence: '0.7776'}
\`\`\`

## Suggested Fixes

### Option 1: Fix Fetch Path
- Verify Vite serves `public/models/reference-embeddings.json` at `/models/reference-embeddings.json`
- Test direct URL access: `http://localhost:3000/models/reference-embeddings.json`
- If 404, adjust path or Vite config

### Option 2: Use Direct Import (Recommended)
- Import JSON directly: `import embeddings from '/models/reference-embeddings.json'`
- Vite handles JSON imports automatically
- No async fetch needed, synchronous loading

### Option 3: Add Explicit Error Handling
- Ensure `useEffect` hooks are actually running
- Add console.log at start of useEffect to verify execution
- Check if state updates are triggering re-renders
- Verify `referenceEmbeddings` prop is passed to `useWakewordMFCC`

### Option 4: Debug Network Request
- Check browser Network tab for `reference-embeddings.json` request
- Verify response status and content
- Check for CORS or other network errors

## Implementation Priority

1. **First:** Add console.log at the very start of `loadEmbeddingsFromJSON` to confirm it's being called
2. **Second:** Test direct URL access to verify file is served
3. **Third:** If fetch fails, switch to direct import approach
4. **Fourth:** Verify state updates and prop passing

## Code Locations to Modify

- `src/utils/loadReferenceEmbeddings.ts` - Main loading function (lines 161-230)
- `src/hooks/useWakewordMFCC.ts` - Hook that uses embeddings (line 114: `const refEmbeddings = referenceEmbeddings`)
- `src/hooks/useJamieWakeWord.ts` - Component loading embeddings (lines 62-76)
- `src/pages/WakeTest.tsx` - Test page loading embeddings (lines 30-41)
- `src/components/WakeWordStatus.tsx` - Status component loading embeddings (lines 27-36)
