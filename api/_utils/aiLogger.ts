/**
 * Structured AI event logging to JSONL file
 * Logs Pass-1, tool execution, Pass-2, and command derivation events
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';

export type AIEvent = {
  ts: string;
  reqId: string;
  event: string;
  [key: string]: any;
};

// Simple write queue to avoid contention (synchronous for simplicity)
let writeQueue: string[] = [];
let isWriting = false;

function getLogPath(): string {
  if (process.env.AI_LOG_PATH) {
    return process.env.AI_LOG_PATH;
  }
  
  // Default: dev -> logs/ai-events.jsonl, prod -> /tmp/ai-events.jsonl
  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    return 'logs/ai-events.jsonl';
  }
  return '/tmp/ai-events.jsonl';
}

function ensureDirectoryExists(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch (e: any) {
      // Ignore errors (might already exist or permission issues)
    }
  }
}

function redactSecrets(obj: any, depth = 0): any {
  if (depth > 10) return '[max_depth]'; // Prevent infinite recursion
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === 'string') {
    // Redact API keys and auth headers
    if (obj.includes('api_key') || obj.includes('Authorization') || obj.includes('Bearer ')) {
      return '[REDACTED]';
    }
    // Redact long base64 strings (likely audio)
    if (obj.length > 100 && /^[A-Za-z0-9+/=]+$/.test(obj)) {
      return `[base64_${obj.length}_chars]`;
    }
    // Truncate very long strings
    if (obj.length > 4000) {
      return obj.substring(0, 4000) + `...[truncated_${obj.length - 4000}_chars]`;
    }
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => redactSecrets(item, depth + 1));
  }
  
  if (typeof obj === 'object') {
    const redacted: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      // Redact sensitive keys
      if (lowerKey.includes('api_key') || lowerKey.includes('authorization') || 
          lowerKey === 'audio' || lowerKey === 'data') {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = redactSecrets(value, depth + 1);
      }
    }
    return redacted;
  }
  
  return obj;
}

function truncateString(str: string, maxLen: number = 300): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + `...[truncated_${str.length - maxLen}_chars]`;
}

export function logAIEvent(event: AIEvent): void {
  // Gate with env flag (default on)
  if (process.env.AI_LOG_ENABLED === 'false') {
    return;
  }
  
  try {
    const logPath = getLogPath();
    ensureDirectoryExists(logPath);
    
    // Redact and prepare event
    const cleanEvent = redactSecrets(event);
    
    // Ensure timestamp and reqId
    if (!cleanEvent.ts) {
      cleanEvent.ts = new Date().toISOString();
    }
    if (!cleanEvent.reqId) {
      cleanEvent.reqId = `req_${Date.now()}_${randomUUID().substring(0, 8)}`;
    }
    
    // Write JSONL line (synchronous for simplicity, but queue to avoid contention)
    const jsonLine = JSON.stringify(cleanEvent) + '\n';
    
    // Simple synchronous write (fast enough for JSONL)
    appendFileSync(logPath, jsonLine, 'utf8');
  } catch (error: any) {
    // Silently fail - don't break the request if logging fails
    // Could optionally log to console in dev
    if (process.env.NODE_ENV !== 'production') {
      console.error('[aiLogger] Failed to write event:', error?.message);
    }
  }
}

// Helper to truncate long strings in event data
export function truncateField(value: any, maxLen: number = 300): any {
  if (typeof value === 'string') {
    return truncateString(value, maxLen);
  }
  return value;
}

