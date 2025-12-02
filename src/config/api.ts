/**
 * API Configuration
 * Centralized configuration for API endpoints and WebSocket URLs
 */

/**
 * Get the API base path based on environment
 * In production (behind nginx reverse proxy), this will be /radio/api
 * In development, this will be /api (vite proxy handles /api -> localhost:3001/api)
 */
export function getApiBasePath(): string {
  // Check for explicit env var (build-time)
  if (import.meta.env.VITE_API_BASE_PATH) {
    return import.meta.env.VITE_API_BASE_PATH;
  }
  
  // Runtime detection: use /radio/api for production domain, /api for dev
  const hostname = window.location.hostname;
  if (hostname === 'server.jamiearmoordon.co.uk' || hostname.includes('jamiearmoordon.co.uk')) {
    return '/radio/api';
  }
  
  // Development: use /api (vite proxy will handle it)
  return '/api';
}

/**
 * Get WebSocket URL for wake word detection
 */
export function getWakeWordWebSocketUrl(): string {
  // Check for explicit env var (build-time)
  if (import.meta.env.VITE_WAKE_WORD_WS_URL) {
    return import.meta.env.VITE_WAKE_WORD_WS_URL;
  }
  
  // Runtime detection: use wss:// for production domain, ws://localhost for dev
  const hostname = window.location.hostname;
  if (hostname === 'server.jamiearmoordon.co.uk' || hostname.includes('jamiearmoordon.co.uk')) {
    // Production: use secure WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${hostname}/radio/ws`;
  }
  
  // Development: use localhost
  return 'ws://localhost:8000/ws';
}

/**
 * Get WebSocket URL for Murf TTS
 */
export function getMurfWebSocketUrl(): string {
  // Check for explicit env var (build-time)
  if (import.meta.env.VITE_MURF_WS_URL) {
    return import.meta.env.VITE_MURF_WS_URL;
  }
  
  // Runtime detection: use wss:// for production domain, ws://localhost for dev
  const hostname = window.location.hostname;
  if (hostname === 'server.jamiearmoordon.co.uk' || hostname.includes('jamiearmoordon.co.uk')) {
    // Production: use secure WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${hostname}/radio/api/tts/murf-ws`;
  }
  
  // Development: use localhost
  return 'ws://localhost:3001/api/tts/murf-ws';
}

