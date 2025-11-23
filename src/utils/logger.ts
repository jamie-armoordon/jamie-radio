/**
 * Enhanced logger with timestamps, tags, and log levels for browser
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Get log level from env or default to 'info' in dev, 'warn' in prod
const getLogLevel = (): LogLevel => {
  if (typeof window !== 'undefined' && (window as any).LOG_LEVEL) {
    return (window as any).LOG_LEVEL as LogLevel;
  }
  // Default: info in dev, warn in prod
  // Handle both browser (Vite) and Node.js environments
  const isDev = typeof import.meta !== 'undefined' && import.meta.env 
    ? import.meta.env.DEV 
    : process.env.NODE_ENV !== 'production';
  return isDev ? 'info' : 'warn';
};

// Check if timestamps are enabled (default: true in dev)
const shouldTimestamp = (): boolean => {
  if (typeof window !== 'undefined' && (window as any).LOG_TIMESTAMPS !== undefined) {
    return (window as any).LOG_TIMESTAMPS;
  }
  // Handle both browser (Vite) and Node.js environments
  const isDev = typeof import.meta !== 'undefined' && import.meta.env 
    ? import.meta.env.DEV !== false
    : process.env.NODE_ENV !== 'production';
  return isDev;
};

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getTimestamp(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

// Log deduplication: prevent identical logs within 100ms (reduced from 250ms for better debugging)
// This reduces log spam from repeated messages (e.g., "Sent N audio chunks..." every 5 seconds)
const logDedupCache = new Map<string, number>();
const DEDUP_WINDOW_MS = 100; // Reduced from 250ms for better debugging visibility

// Tags that should never be deduplicated (critical for debugging)
const NO_DEDUP_TAGS = ['VoiceControl', 'AssemblyAI', 'WakeWord'];

// Check if deduplication is globally disabled
const isDedupDisabled = (): boolean => {
  if (typeof window !== 'undefined' && (window as any).LOG_NO_DEDUP !== undefined) {
    return (window as any).LOG_NO_DEDUP === true;
  }
  return false;
};

function shouldDeduplicate(messageKey: string, tag?: string): boolean {
  // Never deduplicate if globally disabled
  if (isDedupDisabled()) {
    return false;
  }
  
  // Never deduplicate critical tags
  if (tag && NO_DEDUP_TAGS.includes(tag)) {
    return false;
  }
  
  const now = Date.now();
  const lastTime = logDedupCache.get(messageKey);
  if (lastTime && (now - lastTime) < DEDUP_WINDOW_MS) {
    return true; // Skip duplicate
  }
  logDedupCache.set(messageKey, now);
  // Clean old entries periodically (every 1000ms)
  if (now % 1000 < DEDUP_WINDOW_MS) {
    for (const [key, time] of logDedupCache.entries()) {
      if (now - time > DEDUP_WINDOW_MS * 2) {
        logDedupCache.delete(key);
      }
    }
  }
  return false;
}

// Check if message already has a timestamp prefix
function hasTimestampPrefix(message: string): boolean {
  return /^\[\d{2}:\d{2}:\d{2}\.\d{3}\]/.test(message);
}

// Format log message with timestamp and optional tag
function formatMessage(tag?: string, ...args: any[]): any[] {
  const timestamp = shouldTimestamp() ? `[${getTimestamp()}]` : '';
  const tagPart = tag ? `[${tag}]` : '';
  
  // Check if first arg already has timestamp
  if (args.length > 0 && typeof args[0] === 'string' && hasTimestampPrefix(args[0])) {
    // Already has timestamp, just add tag if needed
    if (tagPart) {
      return [tagPart, ...args];
    }
    return args;
  }
  
  // Build prefix
  const parts = [timestamp, tagPart].filter(Boolean);
  const prefix = parts.length > 0 ? parts.join(' ') + ' ' : '';
  
  // If first arg is a string, prepend prefix to it
  if (args.length > 0 && typeof args[0] === 'string') {
    return [prefix + args[0], ...args.slice(1)];
  }
  
  // Otherwise, add prefix as separate arg
  return [prefix, ...args];
}

const currentLogLevel = getLogLevel();
const currentLevelNum = LOG_LEVELS[currentLogLevel];

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= currentLevelNum;
}

export const logger = {
  log: (tagOrMessage?: string, ...args: any[]) => {
    if (!shouldLog('info')) return;
    
    // Support both logger.log('tag', 'message') and logger.log('message')
    let tag: string | undefined;
    let messageArgs: any[];
    
    if (args.length === 0 && typeof tagOrMessage === 'string') {
      // logger.log('message') - no tag
      messageArgs = [tagOrMessage];
    } else if (typeof tagOrMessage === 'string' && args.length > 0) {
      // logger.log('tag', 'message', ...) - has tag
      tag = tagOrMessage;
      messageArgs = args;
    } else {
      // logger.log(...args) - no tag
      messageArgs = tagOrMessage !== undefined ? [tagOrMessage, ...args] : args;
    }
    
    // Deduplication: create key from tag + first message arg
    // For objects/JSON, use a hash of the stringified version
    const firstArg = messageArgs[0];
    if (firstArg !== undefined) {
      let dedupKey: string;
      if (typeof firstArg === 'string') {
        dedupKey = `${tag || ''}:${firstArg.substring(0, 100)}`;
      } else if (typeof firstArg === 'object') {
        // For objects, use a hash of the stringified version (first 200 chars)
        const objStr = JSON.stringify(firstArg).substring(0, 200);
        dedupKey = `${tag || ''}:${objStr}`;
      } else {
        dedupKey = `${tag || ''}:${String(firstArg).substring(0, 100)}`;
      }
      
      if (shouldDeduplicate(dedupKey, tag)) {
        return; // Skip duplicate log
      }
    }
    
    const formatted = formatMessage(tag, ...messageArgs);
    console.log(...formatted);
  },
  
  info: (tagOrMessage?: string, ...args: any[]) => {
    if (!shouldLog('info')) return;
    
    let tag: string | undefined;
    let messageArgs: any[];
    
    if (args.length === 0 && typeof tagOrMessage === 'string') {
      messageArgs = [tagOrMessage];
    } else if (typeof tagOrMessage === 'string' && args.length > 0) {
      tag = tagOrMessage;
      messageArgs = args;
    } else {
      messageArgs = tagOrMessage !== undefined ? [tagOrMessage, ...args] : args;
    }
    
    // Deduplication: handle strings and objects
    const firstArg = messageArgs[0];
    if (firstArg !== undefined) {
      let dedupKey: string;
      if (typeof firstArg === 'string') {
        dedupKey = `${tag || ''}:${firstArg.substring(0, 100)}`;
      } else if (typeof firstArg === 'object') {
        const objStr = JSON.stringify(firstArg).substring(0, 200);
        dedupKey = `${tag || ''}:${objStr}`;
      } else {
        dedupKey = `${tag || ''}:${String(firstArg).substring(0, 100)}`;
      }
      
      if (shouldDeduplicate(dedupKey, tag)) {
        return;
      }
    }
    
    const formatted = formatMessage(tag, ...messageArgs);
    console.info(...formatted);
  },
  
  debug: (tagOrMessage?: string, ...args: any[]) => {
    if (!shouldLog('debug')) return;
    
    let tag: string | undefined;
    let messageArgs: any[];
    
    if (args.length === 0 && typeof tagOrMessage === 'string') {
      messageArgs = [tagOrMessage];
    } else if (typeof tagOrMessage === 'string' && args.length > 0) {
      tag = tagOrMessage;
      messageArgs = args;
    } else {
      messageArgs = tagOrMessage !== undefined ? [tagOrMessage, ...args] : args;
    }
    
    const formatted = formatMessage(tag, ...messageArgs);
    console.debug(...formatted);
  },
  
  warn: (tagOrMessage?: string, ...args: any[]) => {
    if (!shouldLog('warn')) return;
    
    let tag: string | undefined;
    let messageArgs: any[];
    
    if (args.length === 0 && typeof tagOrMessage === 'string') {
      messageArgs = [tagOrMessage];
    } else if (typeof tagOrMessage === 'string' && args.length > 0) {
      tag = tagOrMessage;
      messageArgs = args;
    } else {
      messageArgs = tagOrMessage !== undefined ? [tagOrMessage, ...args] : args;
    }
    
    // Deduplication: less aggressive for warnings (50ms window)
    // Never deduplicate warnings from critical tags
    const firstArg = messageArgs[0];
    if (firstArg !== undefined && !(tag && NO_DEDUP_TAGS.includes(tag))) {
      let dedupKey: string;
      if (typeof firstArg === 'string') {
        dedupKey = `${tag || ''}:${firstArg.substring(0, 100)}`;
      } else if (typeof firstArg === 'object') {
        const objStr = JSON.stringify(firstArg).substring(0, 200);
        dedupKey = `${tag || ''}:${objStr}`;
      } else {
        dedupKey = `${tag || ''}:${String(firstArg).substring(0, 100)}`;
      }
      
      // Use shorter window for warnings (50ms instead of 100ms)
      const now = Date.now();
      const lastTime = logDedupCache.get(dedupKey);
      if (lastTime && (now - lastTime) < 50) {
        return; // Skip duplicate warning
      }
      logDedupCache.set(dedupKey, now);
    }
    
    const formatted = formatMessage(tag, ...messageArgs);
    console.warn(...formatted);
  },
  
  error: (tagOrMessage?: string, ...args: any[]) => {
    if (!shouldLog('error')) return;
    
    let tag: string | undefined;
    let messageArgs: any[];
    
    if (args.length === 0 && typeof tagOrMessage === 'string') {
      messageArgs = [tagOrMessage];
    } else if (typeof tagOrMessage === 'string' && args.length > 0) {
      tag = tagOrMessage;
      messageArgs = args;
    } else {
      messageArgs = tagOrMessage !== undefined ? [tagOrMessage, ...args] : args;
    }
    
    // Never deduplicate errors - they're always important
    const formatted = formatMessage(tag, ...messageArgs);
    console.error(...formatted);
  },
};

