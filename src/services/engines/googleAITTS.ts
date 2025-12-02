import type { TTSEngine, SpeakOptions } from '../ttsManager';
import { getApiBasePath } from '../../config/api';

// Callback for when TTS starts/stops (for volume ducking)
let onTTSStateChange: ((isSpeaking: boolean) => void) | null = null;

export function setTTSStateChangeCallback(callback: (isSpeaking: boolean) => void) {
  onTTSStateChange = callback;
}

export class GoogleAITTSEngine implements TTSEngine {
  id = 'webspeech' as const; // Using webspeech type for compatibility (not actually used)
  private currentAudio: HTMLAudioElement | null = null;

  isAvailable(): boolean {
    // Always available - uses API
    return true;
  }

  async speak(text: string, opts?: SpeakOptions): Promise<void> {
    if (!text || text.trim().length === 0) {
      throw new Error('Empty text provided');
    }

    // Stop current speech
    this.stop();

    // Notify that TTS is starting
    if (onTTSStateChange) {
      onTTSStateChange(true);
    }

    try {
      console.log('[GoogleAITTS] Requesting TTS audio for:', text);
      
      // Call API endpoint to generate TTS audio
      const response = await fetch(`${getApiBasePath()}/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          voice: opts?.voice || 'Kore', // Default to Kore voice
        }),
      });

      if (!response.ok) {
        throw new Error(`TTS API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      
      if (!result.audio) {
        throw new Error('No audio data in TTS response');
      }

      // Decode base64 audio
      const audioData = Uint8Array.from(atob(result.audio), c => c.charCodeAt(0));
      
      // Create audio blob
      const audioBlob = new Blob([audioData], { type: 'audio/wav' });
      const audioUrl = URL.createObjectURL(audioBlob);

      // Play audio
      return new Promise<void>((resolve, reject) => {
        const audio = new Audio(audioUrl);
        this.currentAudio = audio;

        // Apply volume if specified
        audio.volume = opts?.volume ?? 1.0;

        audio.onended = () => {
          this.currentAudio = null;
          URL.revokeObjectURL(audioUrl);
          if (onTTSStateChange) {
            onTTSStateChange(false);
          }
          resolve();
        };

        audio.onerror = (error) => {
          this.currentAudio = null;
          URL.revokeObjectURL(audioUrl);
          if (onTTSStateChange) {
            onTTSStateChange(false);
          }
          reject(new Error(`Audio playback error: ${error}`));
        };

        audio.play().catch((error) => {
          this.currentAudio = null;
          URL.revokeObjectURL(audioUrl);
          if (onTTSStateChange) {
            onTTSStateChange(false);
          }
          reject(new Error(`Failed to play audio: ${error}`));
        });
      });
    } catch (error) {
      if (onTTSStateChange) {
        onTTSStateChange(false);
      }
      throw error;
    }
  }

  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    if (onTTSStateChange) {
      onTTSStateChange(false);
    }
  }
}
