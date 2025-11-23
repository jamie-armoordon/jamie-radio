# Wake Word System Audit Report

**Generated:** Based on console logs and codebase analysis  
**Focus Areas:** State management, performance, logic accuracy, code quality

---

## 1. System Status

### Embeddings Loading: ✅ **WORKING**

The reference embedding loading system is functioning correctly:
- JSON file successfully fetched from `/models/reference-embeddings.json`
- 3 embeddings loaded with dimension 96
- Embeddings properly passed to `useWakewordMFCC` hook
- Ref-based state management ensures latest embeddings are accessible

**Evidence from logs:**
\`\`\`
[loadEmbeddingsFromJSON] ✅ Successfully loaded 3 embeddings (Dim: 96)
[useWakewordMFCC] Updated reference embeddings ref with 3 items
[useWakewordMFCC] Using 3 reference embeddings for cosine similarity
\`\`\`

### Inference Pipeline: ✅ **WORKING**

The inference pipeline is operational:
- ONNX model loads successfully
- Audio processing via AudioWorklet functioning
- Cosine similarity comparison with reference embeddings working
- Confidence calculation and threshold detection active

### Performance: ⚠️ **NEEDS ATTENTION**

**Issue:** Click handler violation (261ms) detected during `start()` execution.

**Root Cause:** The `ort.InferenceSession.create()` call on line 302 of `useWakewordMFCC.ts` is a synchronous blocking operation that loads the ONNX model file. This operation:
- Blocks the main thread during model loading
- Occurs synchronously within the click handler
- Takes ~200-300ms depending on model size and network conditions

**Impact:** User experience degradation - button clicks feel unresponsive during initialization.

---

## 2. Key Findings

### ✅ What's Working Well

1. **Stale Closure Fix:** The `useRef` pattern correctly solves the stale closure issue:
   - `referenceEmbeddingsRef` stores the latest embeddings (line 64)
   - `useEffect` updates the ref when embeddings change (lines 67-72)
   - `runInference` accesses embeddings via ref, not closure (line 127)
   - Dependency array correctly excludes `referenceEmbeddings` (line 291)

2. **Embedding Loading:** Robust error handling and fallback paths in `loadEmbeddingsFromJSON`:
   - Handles both array and object-wrapped JSON formats
   - Fallback path resolution for different deployment scenarios
   - Graceful degradation (returns empty array on error, allows magnitude heuristic fallback)

3. **Cosine Similarity Math:** Mathematically correct implementation:
   - Proper dot product calculation
   - Correct normalization using L2 norms
   - Handles edge case (zero denominator returns 0)

### ⚠️ Performance Issues

**Click Handler Violation (261ms)**

The violation occurs in the `start()` function when:
1. User clicks "Enable" button
2. `start()` is called (line 293)
3. `ort.InferenceSession.create(modelPath)` executes (line 302)
4. Model file is loaded synchronously, blocking main thread

**Analysis:**
- Model loading is inherently synchronous in ONNX Runtime Web
- The operation cannot be moved to a Web Worker easily (ONNX Runtime Web has limitations)
- The 261ms delay is likely acceptable for a one-time initialization, but violates browser performance guidelines

**Recommendation:** Consider showing a loading indicator during initialization to improve perceived performance.

### 🔄 Double-Mount Analysis

**Root Cause:** React StrictMode is enabled in `src/main.tsx` (line 8).

**Impact:**
- Components mount twice in development mode
- `WakeWordSettings` component logs "Component mounted" twice
- Embeddings are loaded twice (once per mount cycle)
- Both loads complete successfully, so no functional issue

**Current Handling:**
- The component handles double-mount gracefully
- `useEffect` cleanup properly prevents memory leaks
- No duplicate inference sessions created (guarded by `listening` state)

**Note:** This is expected behavior in development. In production builds, StrictMode effects are disabled, so double-mounting won't occur.

### 📊 Logic Verification

#### Cosine Similarity & Distance: ✅ **CORRECT**

\`\`\`23:47:src/hooks/useWakewordMFCC.ts
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  
  return dotProduct / denominator;
}

function cosineDistance(a: Float32Array, b: Float32Array): number {
  return 1 - cosineSimilarity(a, b);
}
\`\`\`

**Verification:**
- ✅ Dot product calculation: Correct
- ✅ L2 norm calculation: Correct (sqrt of sum of squares)
- ✅ Cosine similarity formula: `dot(a,b) / (||a|| * ||b||)` - Correct
- ✅ Cosine distance: `1 - similarity` - Correct
- ✅ Edge case handling: Zero denominator returns 0 - Correct

#### Confidence Mapping Logic: ✅ **SOUND**

The confidence mapping (lines 232-254) uses a hybrid approach:

1. **Within threshold** (`normalizedDistance < 1`): Linear mapping from [1.0, 0.5]
   - At distance = 0: confidence = 1.0
   - At distance = threshold: confidence = 0.5
   - Formula: `1 - (normalizedDistance * 0.5)`

2. **Beyond threshold** (`normalizedDistance >= 1`): Exponential decay
   - Formula: `0.5 * Math.exp(-excess * 2)`
   - Provides smooth falloff beyond threshold

**Analysis:**
- ✅ Mathematically sound
- ✅ Provides smooth transition at threshold boundary
- ✅ Maps to [0, 1] range correctly
- ✅ Final clamp ensures values stay in valid range (line 280)

**Note:** The mapping is appropriate for the expected output range. Speech embedding models typically produce normalized embeddings, so cosine distance in [0, 1] range is expected.

#### Preprocessing Logic: ✅ **CORRECT**

The `preprocessAudio` function (lines 84-118) correctly:
- ✅ Pads/crops audio to exactly 16000 samples
- ✅ Performs RMS normalization
- ✅ Clamps RMS floor to prevent division by zero (1e-3)
- ✅ Handles edge cases (exact length, too short, too long)

**Code Duplication Note:** The same preprocessing logic exists in `loadReferenceEmbeddings.ts` (lines 77-106). This is acceptable as they serve different contexts (real-time vs. batch processing), but could be extracted to a shared utility.

---

## 3. Code Logic Verification

### ✅ useRef Fix Assessment

**Implementation:** Correct and effective

**How it works:**
1. `referenceEmbeddingsRef` is created with `useRef` (line 64)
2. `useEffect` updates `referenceEmbeddingsRef.current` when prop changes (lines 67-72)
3. `runInference` callback reads from `referenceEmbeddingsRef.current` (line 127)
4. Dependency array excludes `referenceEmbeddings` (line 291), preventing unnecessary callback recreation

**Why it works:**
- Refs persist across renders without causing re-renders
- Reading from `.current` always gets the latest value
- The callback doesn't need to be recreated when embeddings change
- The audio processing loop (worklet message handler) can call `runInference` without stale data

**Verification:** ✅ The pattern correctly solves the stale closure problem.

### ✅ Cosine Similarity Math Assessment

**Mathematical Correctness:** Verified

The implementation follows the standard cosine similarity formula:
\`\`\`
similarity = (a · b) / (||a|| * ||b||)
\`\`\`

Where:
- `a · b` = dot product (sum of element-wise products)
- `||a||` = L2 norm (sqrt of sum of squares)
- Result range: [-1, 1] for general vectors, but embeddings are typically normalized to [0, 1]

**Edge Cases Handled:**
- Zero denominator → returns 0 (prevents NaN)
- Empty arrays → handled by loop (returns 0)

**Distance Calculation:**
- `distance = 1 - similarity` correctly maps similarity to distance
- Range: [0, 2] for general case, but typically [0, 1] for normalized embeddings

---

## 4. Recommendations

### Immediate Fixes

1. **Add Loading State for Model Initialization**
   - Show loading indicator during `start()` execution
   - Disable button during initialization to prevent double-clicks
   - Improves perceived performance despite blocking operation

   **Implementation suggestion:**
   \`\`\`typescript
   const [initializing, setInitializing] = useState(false);
   
   const start = useCallback(async () => {
     if (listening || initializing) return;
     setInitializing(true);
     try {
       // ... existing code ...
     } finally {
       setInitializing(false);
     }
   }, [listening, initializing, modelPath, runInference]);
   \`\`\`

2. **Extract Magic Numbers to Constants**
   - Create a constants file for thresholds, sample rates, and window sizes
   - Improves maintainability and makes tuning easier

   **Suggested constants:**
   \`\`\`typescript
   // src/constants/wakeWord.ts
   export const WAKE_WORD_CONFIG = {
     TARGET_SAMPLE_RATE: 16000,
     WINDOW_SIZE: 16000,
     DEFAULT_CONFIDENCE_THRESHOLD: 0.65,
     DEFAULT_SIMILARITY_THRESHOLD: 0.15,
     DEFAULT_SILENCE_THRESHOLD: 0.02,
     RMS_FLOOR: 1e-3,
     MAGNITUDE_DIVISOR: 200,
   } as const;
   \`\`\`

3. **Extract Hardcoded Paths to Configuration**
   - Move model paths to environment variables or config
   - Allows different paths for dev/prod

   **Suggested approach:**
   \`\`\`typescript
   // src/config/wakeWord.ts
   export const WAKE_WORD_PATHS = {
     MODEL: import.meta.env.VITE_WAKE_WORD_MODEL_PATH || '/models/speech-embedding.onnx',
     EMBEDDINGS: import.meta.env.VITE_EMBEDDINGS_PATH || '/models/reference-embeddings.json',
   } as const;
   \`\`\`

### Future Optimizations

1. **Model Loading Optimization**
   - Preload model on app startup (in background)
   - Cache loaded session in a singleton or context
   - Reduces click handler delay to near-zero

2. **Code Deduplication**
   - Extract `preprocessAudio` to shared utility
   - Extract embedding averaging logic to shared utility
   - Reduces maintenance burden

3. **Performance Monitoring**
   - Add performance marks for model loading
   - Track inference latency
   - Monitor confidence distribution

4. **Error Recovery**
   - Add retry logic for model loading failures
   - Graceful degradation if embeddings fail to load
   - User-friendly error messages

5. **StrictMode Handling**
   - Add development-only guards for double-mount effects
   - Consider using a ref flag to prevent duplicate operations in dev

---

## 5. Summary

### Overall Assessment: ✅ **HEALTHY SYSTEM**

The wake word detection system is **functionally correct** and **well-implemented**. The core logic is sound, state management is proper, and the system handles edge cases gracefully.

### Critical Issues: **NONE**

No critical bugs or logic errors found. The system is production-ready from a correctness standpoint.

### Performance Concerns: **MINOR**

The 261ms click handler violation is a UX concern but not a functional issue. It can be mitigated with loading indicators and preloading strategies.

### Code Quality: **GOOD**

The code is well-structured and maintainable. Suggested improvements focus on configuration management and code reuse rather than fixing bugs.

---

**Report End**
