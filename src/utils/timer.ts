/**
 * High-resolution timing utility for latency measurement
 * Browser-compatible version (re-exports from shared utility if needed)
 */

import { logger } from './logger';

export class Timer {
  private startTime: number;
  private checkpoints: Array<{ label: string; elapsed: number; timestamp: string }> = [];

  constructor(private sessionId: string = 'default') {
    this.startTime = performance.now();
  }

  /**
   * Mark a checkpoint and log elapsed time
   */
  mark(label: string, context?: Record<string, any>): void {
    const now = performance.now();
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
    return performance.now() - this.startTime;
  }

  /**
   * Reset the timer
   */
  reset(): void {
    this.startTime = performance.now();
    this.checkpoints = [];
  }
}

