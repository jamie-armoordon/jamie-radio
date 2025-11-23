export interface SpeakOptions {
  voice?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  interrupt?: boolean; // stop current speech
}

export interface TTSEngine {
  id: 'webspeech' | 'kitten';
  isAvailable(): Promise<boolean> | boolean;
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  stop(): void;
  preload?(opts?: any): Promise<void>;
}

class TTSManager {
  private activeEngine: TTSEngine | null = null;
  private kittenEngine: TTSEngine | null = null;
  private webSpeechEngine: TTSEngine | null = null;
  private enhancedOfflineVoice: boolean = false;

  constructor() {
    // Engines will be registered dynamically
  }

  registerEngine(engine: TTSEngine): void {
    if (engine.id === 'kitten') {
      this.kittenEngine = engine;
    } else if (engine.id === 'webspeech') {
      this.webSpeechEngine = engine;
    }
  }

  setEnhancedOfflineVoice(enabled: boolean): void {
    this.enhancedOfflineVoice = enabled;
  }

  getActiveEngine(): TTSEngine['id'] | null {
    return this.activeEngine?.id || null;
  }

  async speak(text: string, opts?: SpeakOptions): Promise<void> {
    if (!text || text.trim().length === 0) {
      console.warn('[TTSManager] Empty text, skipping');
      return;
    }

    // Stop current speech if interrupt is requested
    if (opts?.interrupt) {
      this.stop();
    }

    // If enhanced offline voice is enabled, try Kitten first
    if (this.enhancedOfflineVoice && this.kittenEngine) {
      try {
        const available = await this.kittenEngine.isAvailable();
        if (available) {
          try {
            this.activeEngine = this.kittenEngine;
            console.log('[TTSManager] Attempting to use KittenTTS engine');
            await this.kittenEngine.speak(text, opts);
            console.log('[TTSManager] KittenTTS succeeded');
            return;
          } catch (error: any) {
            // KittenTTS failed - reset active engine and fall back
            this.activeEngine = null;
            const errorMsg = error?.message || String(error);
            console.warn('[TTSManager] KittenTTS failed, falling back to Web Speech:', errorMsg);
            // Fall through to Web Speech
          }
        } else {
          console.log('[TTSManager] KittenTTS not available, using Web Speech');
        }
      } catch (error: any) {
        const errorMsg = error?.message || String(error);
        console.warn('[TTSManager] KittenTTS availability check failed, falling back to Web Speech:', errorMsg);
        // Fall through to Web Speech
      }
    }

    // Always fallback to Web Speech API
    if (!this.webSpeechEngine) {
      throw new Error('Web Speech engine not registered');
    }

    const available = await this.webSpeechEngine.isAvailable();
    if (!available) {
      throw new Error('Web Speech API not available');
    }

    try {
      this.activeEngine = this.webSpeechEngine;
      console.log('[TTSManager] Using Web Speech API engine');
      await this.webSpeechEngine.speak(text, opts);
      return;
    } catch (error: any) {
      // "interrupted" is expected when interrupt: true is used
      if (error?.message?.includes('interrupted')) {
        console.log('[TTSManager] Speech was interrupted (expected)');
        return;
      }
      console.error('[TTSManager] Web Speech API failed:', error);
      throw new Error(`Web Speech API failed: ${error}`);
    }
  }

  stop(): void {
    if (this.activeEngine) {
      this.activeEngine.stop();
      this.activeEngine = null;
    }
    // Also stop all engines to be safe
    if (this.kittenEngine) {
      this.kittenEngine.stop();
    }
    if (this.webSpeechEngine) {
      this.webSpeechEngine.stop();
    }
  }
}

export const ttsManager = new TTSManager();
