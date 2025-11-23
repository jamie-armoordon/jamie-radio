/**
 * Enhanced logger with timestamps, tags, and log levels for server
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Get log level from env or default to 'info' in dev
const getLogLevel = (): LogLevel => {
  const envLevel = process.env.LOG_LEVEL as LogLevel | undefined;
  if (envLevel && ['debug', 'info', 'warn', 'error'].includes(envLevel)) {
    return envLevel;
  }
  return process.env.NODE_ENV === 'production' ? 'warn' : 'info';
};

// Check if timestamps are enabled (default: true)
const shouldTimestamp = (): boolean => {
  if (process.env.LOG_TIMESTAMPS !== undefined) {
    return process.env.LOG_TIMESTAMPS === 'true';
  }
  return true;
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
    
    const formatted = formatMessage(tag, ...messageArgs);
    console.error(...formatted);
  },
};

