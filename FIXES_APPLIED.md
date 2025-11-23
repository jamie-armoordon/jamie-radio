# Gemini Two-Pass Function Calling Fixes - Applied

**Date:** 2025-01-XX  
**Based on:** `ai-report.md` diagnostic findings

---

## Summary of Changes

All fixes from the diagnostic report have been implemented using targeted code diffs. The changes address:

1. ✅ Missing weather intent in system instruction
2. ✅ Pass-2 lacking user query context
3. ✅ Missing Pass-1 transcript logging
4. ✅ Optional transcription fallback (feature-flagged)
5. ✅ Improved fallback behavior for empty tool calls

---

## Changes Applied

### 1. Weather Intent Added to System Instruction

**File:** `api/radioTools.ts`  
**Location:** `getSystemInstruction()` function, after section 3

**Change:** Added new section 4 for weather queries with explicit instructions and examples.

**Impact:** Gemini now knows to call `get_weather` for weather-related queries.

---

### 2. Pass-2 Context Enhancement

**Files:** `api/ai-audio.ts`, `api/ai.ts`

**Changes:**
- Extract `transcribedText` from Pass-1 response (`pass1.text`)
- Include `User asked: "<transcript>"` in Pass-2 prompt
- Add explicit fallback instructions for when no tools are called

**Impact:** Pass-2 always knows what the user asked, even when no tools were called.

---

### 3. Pass-1 Logging Added

**File:** `api/ai-audio.ts`

**Changes:**
- Log transcript text (or "(no text transcribed)")
- Log raw `functionCalls` array
- Log extracted `toolCalls` array

**Impact:** Better debuggability - can see what Gemini transcribed and what tools it tried to call.

---

### 4. Optional Transcription Fallback (Feature-Flagged)

**File:** `api/ai-audio.ts`

**Changes:**
- Added `ENABLE_TRANSCRIBE_FALLBACK` constant (default: `false`)
- If enabled and no transcript + no tool calls, run explicit transcription
- Re-run Pass-1 with transcript as text input

**Impact:** Fallback mechanism for edge cases where audio transcription fails silently.

**Note:** Disabled by default. Enable by setting `ENABLE_TRANSCRIBE_FALLBACK = true` if needed.

---

## Test Checklist

### Manual Testing (Priority Order)

#### ✅ Critical: Weather Queries
- [ ] **"what's the weather like?"**
  - Expected: `get_weather` tool called
  - Expected: Pass-2 responds with weather info
  - Expected: `command: { type: "weather" }`
  - Check logs: `[AI Audio API] Pass-1 transcript:` should show the query
  - Check logs: `[AI Audio API] Tool calls:` should include `get_weather`

- [ ] **"temperature in London"**
  - Expected: `get_weather({ city: "London" })` called
  - Expected: Weather for London returned

- [ ] **"weather forecast"**
  - Expected: `get_weather` tool called
  - Expected: Appropriate response

#### ✅ High: Existing Radio Intents (Regression Tests)
- [ ] **"play Capital FM"**
  - Expected: `search_stations` + `play_station` called
  - Expected: Station switches
  - Expected: `command: { type: "play", stationName: "Capital FM" }`

- [ ] **"play rap music"**
  - Expected: `list_stations` or `search_stations` called
  - Expected: `play_station` called with best match
  - Expected: Station switches

- [ ] **"what's playing?"**
  - Expected: `get_now_playing` called
  - Expected: Current track info returned
  - Expected: `command: { type: "whats_playing" }`

- [ ] **"volume up"**
  - Expected: `volume_up` called
  - Expected: `command: { type: "volume_up" }`

#### ✅ Medium: Edge Cases
- [ ] **Empty/no audio**
  - Expected: Error returned (existing behavior should still work)

- [ ] **Unclear query ("hello")**
  - Expected: Pass-2 asks clarifying question (not generic "Hello there.")
  - Expected: `command: { type: "unknown" }` (acceptable)

- [ ] **Query with no matching tool**
  - Expected: Pass-2 responds to query directly (not generic greeting)
  - Check logs: Transcript should be captured

#### ✅ Low: Transcription Fallback (if enabled)
- [ ] Set `ENABLE_TRANSCRIBE_FALLBACK = true`
- [ ] Test with poor quality audio that fails initial transcription
- [ ] Expected: Fallback transcription runs, Pass-1 retry with transcript

---

## Log Verification

After each test, check logs for:

1. **Pass-1 transcript:**
   ```
   [AI Audio API] Pass-1 transcript: "what's the weather like?"
   ```

2. **Tool calls:**
   ```
   [AI Audio API] Tool calls: [{ name: 'get_weather', args: {} }]
   ```

3. **Pass-2 response:**
   ```
   [AI Audio API] Emitted speak_text via SSE: "The weather is..."
   ```

4. **Command:**
   ```
   [AI Audio API] Emitted command via SSE: {"type":"command","command":{"type":"weather"}}
   ```

---

## Files Modified

1. `api/radioTools.ts` - Added weather intent section to system instruction
2. `api/ai-audio.ts` - Added transcript capture, logging, Pass-2 context, transcription fallback
3. `api/ai.ts` - Added user query to Pass-2 prompt (parity with audio endpoint)

---

## Rollback Plan

If issues arise, revert commits or manually undo:

1. **`api/radioTools.ts`:** Remove section 4 (weather queries), renumber section 5 back to 4
2. **`api/ai-audio.ts`:** 
   - Remove transcript extraction and Pass-2 user query line
   - Remove logging lines
   - Remove transcription fallback block
3. **`api/ai.ts`:** Remove user query from Pass-2 prompt

---

## Next Steps

1. Run manual tests above
2. Monitor logs for any unexpected behavior
3. If transcription issues persist, enable `ENABLE_TRANSCRIBE_FALLBACK` and test
4. Consider adding unit tests for `getSystemInstruction()` weather section
5. Consider adding integration test for weather query flow

---

## Notes

- All changes preserve backward compatibility
- No breaking changes to API contracts
- Feature flag allows safe experimentation with transcription fallback
- Logging is non-intrusive and uses existing logger utilities

