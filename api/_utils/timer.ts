/**
 * High-resolution timing utility for latency measurement
 * Works in both Node.js (server) and browser (client) environments
 */

import { logger } from './logger.js';

export class Timer {
  private startTime: number;
  private checkpoints: Array<{ label: string; elapsed: number; timestamp: string }> = [];

  constructor(private sessionId: string = 'default') {
    // Use performance.now() which works in both Node.js and browser
    this.startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  /**
   * Mark a checkpoint and log elapsed time
   */
  mark(label: string, context?: Record<string, any>): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsed = now - this.startTime;
    const timestamp = new Date().toISOString();

    const checkpoint = { label, elapsed, timestamp };
    this.checkpoints.push(checkpoint);

    // Build log message - logger will add timestamp, so we just include Timer tag and elapsed time
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    const logMsg = `[Timer:${this.sessionId}] (+${elapsed.toFixed(2)}ms): ${label}${contextStr}`;
    
    // Use logger - it will add timestamp prefix automatically
    logger.log(logMsg);
  }

  /**
   * Get all checkpoints
   */
  getCheckpoints(): Array<{ label: string; elapsed: number; timestamp: string }> {
    return [...this.checkpoints];
  }

  /**
   * Get elapsed time since start
   */
  getElapsed(): number {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return now - this.startTime;
  }

  /**
   * Reset the timer
   */
  reset(): void {
    this.startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.checkpoints = [];
  }
}

