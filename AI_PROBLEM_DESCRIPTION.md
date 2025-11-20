# Problem Description for AI Assistant

## Context
I'm building a radio streaming web application with a Node.js/Express backend and React frontend. The app loads ~140 UK radio stations and displays their logos.

## Current Issues

### 1. Console Spam from Network Errors
**Problem**: The browser console is flooded with `net::ERR_NAME_NOT_RESOLVED` errors from RadioBrowser API calls. These errors appear as:
```
GET https://at1.api.radio-browser.info/json/stations/search?name=... net::ERR_NAME_NOT_RESOLVED
GET https://nl1.api.radio-browser.info/json/stations/search?name=... net::ERR_NAME_NOT_RESOLVED
```

**Root Cause**: 
- RadioBrowser API uses multiple mirrors (at1, nl1, etc.) that frequently go down or become unreachable
- The code already handles these gracefully with try/catch and fallback logic
- However, browser DevTools always logs network-level errors, even when they're caught and handled

**Current Handling**:
- Code uses try/catch blocks around RadioBrowser API calls
- Falls back to alternative mirrors when one fails
- Silently continues if all mirrors fail (expected behavior)
- Network errors still appear in console because they're browser-level, not JavaScript-level

**Question**: How can I suppress or reduce these browser network error logs without breaking the graceful error handling? The errors are expected and handled, but they clutter the console.

### 2. Google Favicon 404 Errors
**Problem**: Multiple 404 errors for Google favicon API:
```
GET https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://example.com&size=256 404 (Not Found)
```

**Root Cause**:
- When no domain is available, the code was using `example.com` as a fallback
- Google's favicon API returns 404 for `example.com` because it doesn't have a real favicon
- This was fixed by changing to `radio.co.uk`, but the issue might recur if domain extraction fails

**Question**: Is there a better fallback domain that Google's favicon API will always return a valid image for? Or should I use a different fallback strategy entirely?

### 3. Excessive Debug Logging
**Problem**: The codebase has many `console.log()` statements for debugging that spam the console during normal operation.

**Status**: Already fixed by converting most debug logs to comments. This was straightforward.

## Technical Stack
- **Backend**: Node.js with Express, TypeScript, ES modules
- **Frontend**: React with Vite, TypeScript
- **Logo Resolution**: Custom backend endpoint `/api/logo` with multi-strategy fallback
- **Stream Discovery**: RadioBrowser API (multiple mirrors, frequently unreliable)

## What I Need
1. **Solution for browser network error spam**: How to suppress or minimize `net::ERR_NAME_NOT_RESOLVED` logs in DevTools without breaking error handling
2. **Better favicon fallback**: A reliable domain or strategy for Google favicon API that always returns a valid image
3. **Best practices**: Any other recommendations for reducing console noise in production-like development environments

## Constraints
- Must maintain graceful error handling (can't just ignore errors)
- Must work in browser DevTools (can't modify browser behavior)
- Should work in both development and production
- RadioBrowser API calls are necessary for stream URL discovery (can't remove them)

