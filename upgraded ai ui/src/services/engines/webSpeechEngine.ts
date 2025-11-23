import type { TTSEngine, SpeakOptions } from '../ttsManager';

// Callback for when TTS starts/stops (for volume ducking)
// This will be set by voiceFeedback.ts
let onTTSStateChange: ((isSpeaking: boolean) => void) | null = null;

export function setTTSStateChangeCallback(callback: (isSpeaking: boolean) => void) {
  onTTSStateChange = callback;
}

export class WebSpeechEngine implements TTSEngine {
  id = 'webspeech' as const;
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  isAvailable(): boolean {
    return 'speechSynthesis' in window;
  }

  async speak(text: string, opts?: SpeakOptions): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('Web Speech API not available');
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    // Ensure voices are loaded before speaking
    let voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) {
      // Voices not loaded yet, wait for them
      console.log('[WebSpeechEngine] Voices not loaded, waiting...');
      await new Promise<void>((resolve) => {
        const checkVoices = () => {
          voices = window.speechSynthesis.getVoices();
          if (voices.length > 0) {
            console.log('[WebSpeechEngine] Voices loaded:', voices.length);
            resolve();
          } else {
            // Try again after a short delay
            setTimeout(checkVoices, 50);
          }
        };
        // Set up event listener as backup
        const onVoicesChanged = () => {
          voices = window.speechSynthesis.getVoices();
          if (voices.length > 0) {
            console.log('[WebSpeechEngine] Voices loaded via event:', voices.length);
            window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
            resolve();
          }
        };
        window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
        // Also check immediately
        checkVoices();
        // Timeout after 1 second
        setTimeout(() => {
          window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
          if (voices.length === 0) {
            console.warn('[WebSpeechEngine] Voices still not loaded after timeout, proceeding anyway');
            resolve();
          }
        }, 1000);
      });
    }

    return new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-GB';
      utterance.rate = opts?.rate ?? 1.1; // Slightly faster for clearer speech
      utterance.pitch = opts?.pitch ?? 1.0;
      utterance.volume = opts?.volume ?? 1.0;

      // Use default voice or find a UK English voice
      if (opts?.voice) {
        const selectedVoice = voices.find(v => v.name === opts.voice || v.voiceURI === opts.voice);
        if (selectedVoice) {
          utterance.voice = selectedVoice;
        }
      } else {
        const ukVoice = voices.find(
          (voice) => voice.lang.startsWith('en-GB') || voice.lang.startsWith('en-UK')
        );
        if (ukVoice) {
          utterance.voice = ukVoice;
        }
      }
      
      console.log('[WebSpeechEngine] Speaking:', text, 'with voice:', utterance.voice?.name || 'default');

      // Notify that TTS is starting
      if (onTTSStateChange) {
        onTTSStateChange(true);
      }

      utterance.onstart = () => {
        if (onTTSStateChange) {
          onTTSStateChange(true);
        }
      };

      utterance.onend = () => {
        this.currentUtterance = null;
        if (onTTSStateChange) {
          onTTSStateChange(false);
        }
        resolve();
      };

      utterance.onerror = (event) => {
        this.currentUtterance = null;
        if (onTTSStateChange) {
          onTTSStateChange(false);
        }
        // "interrupted" is not a real error - it's expected when canceling speech
        if (event.error === 'interrupted') {
          resolve(); // Resolve instead of reject
        } else {
          reject(new Error(`Speech synthesis error: ${event.error}`));
        }
      };

      this.currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    });
  }

  stop(): void {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.currentUtterance = null;
    if (onTTSStateChange) {
      onTTSStateChange(false);
    }
  }
}

// Load voices when available (some browsers need this)
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    // Voices loaded
  };
}
