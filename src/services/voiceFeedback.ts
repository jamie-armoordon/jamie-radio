import { useAIStore } from '../store/aiStore';

// Current audio playback state - can be HTMLAudioElement or Web Audio API source
interface WebAudioSource {
  source: AudioBufferSourceNode;
  context: AudioContext;
}

type AudioSource = HTMLAudioElement | WebAudioSource;

let currentAudio: AudioSource | null = null;

// Callback for when TTS starts/stops (for volume ducking)
let onTTSStateChange: ((isSpeaking: boolean) => void) | null = null;

export function setTTSStateChangeCallback(callback: (isSpeaking: boolean) => void) {
  console.log('[voiceFeedback] setTTSStateChangeCallback called');
  onTTSStateChange = callback;
  console.log('[voiceFeedback] Callback set successfully');
}

/**
 * Play audio from base64 encoded audio data (from Google AI TTS API)
 */
export async function playAudioFromBase64(base64Audio: string): Promise<void> {
  if (!base64Audio || base64Audio.trim().length === 0) {
    throw new Error('Empty audio data provided');
  }

  // Stop current audio
  stopSpeaking();

          // Note: We'll notify that TTS is speaking AFTER playback actually starts
  // This ensures the audio is ready before we duck the volume

  try {
    console.log('[voiceFeedback] Decoding base64 audio, length:', base64Audio.length);
    
    // Decode base64 audio
    const audioData = Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0));
    console.log('[voiceFeedback] Decoded audio data, size:', audioData.length, 'bytes');
    
    // Check first few bytes to determine format
    const header = Array.from(audioData.slice(0, 12)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log('[voiceFeedback] Audio header (hex):', header);
    
    // Determine format from header
    let mimeType = 'audio/wav'; // default
    if (audioData[0] === 0xFF && audioData[1] === 0xFB) {
      mimeType = 'audio/mpeg'; // MP3
    } else if (audioData[0] === 0x4F && audioData[1] === 0x67 && audioData[2] === 0x67) {
      mimeType = 'audio/ogg'; // OGG
    } else if (audioData[0] === 0x52 && audioData[1] === 0x49 && audioData[2] === 0x46 && audioData[3] === 0x46) {
      mimeType = 'audio/wav'; // WAV (RIFF)
    }
    
    console.log('[voiceFeedback] Detected audio format:', mimeType);
    
    // Create audio blob
    const audioBlob = new Blob([audioData], { type: mimeType });
    const audioUrl = URL.createObjectURL(audioBlob);
    console.log('[voiceFeedback] Created audio URL:', audioUrl.substring(0, 50) + '...');

    // Use HTML5 Audio for streaming/buffering support (starts playing while buffering)
    // This is better for streaming TTS than Web Audio API which requires full decode
    return new Promise<void>(async (resolve, reject) => {
      try {
        const audio = new Audio(audioUrl);
        
        // Configure for low-latency streaming playback
        audio.preload = 'auto'; // Preload audio
        audio.load(); // Start loading immediately
        
        currentAudio = audio;

        // Wait for enough data to be buffered before starting playback
        // This reduces lag while still starting quickly
        const checkCanPlay = () => {
          return new Promise<void>((resolveCheck) => {
            if (audio.readyState >= 2) { // HAVE_CURRENT_DATA - enough data to start
              resolveCheck();
              return;
            }
            
            const onCanPlay = () => {
              audio.removeEventListener('canplay', onCanPlay);
              audio.removeEventListener('canplaythrough', onCanPlay);
              resolveCheck();
            };
            
            // Start playing as soon as we have enough data (not waiting for full buffer)
            audio.addEventListener('canplay', onCanPlay, { once: true });
            audio.addEventListener('canplaythrough', onCanPlay, { once: true });
            
            // Fallback: start after 100ms even if not ready (for very fast responses)
            setTimeout(() => {
              audio.removeEventListener('canplay', onCanPlay);
              audio.removeEventListener('canplaythrough', onCanPlay);
              resolveCheck();
            }, 100);
          });
        };

        audio.onended = () => {
          // Use queueMicrotask to avoid long-task violations in ended handler
          // React logs warnings if event handlers take >50ms; moving cleanup to microtask prevents this
          queueMicrotask(() => {
            currentAudio = null;
            URL.revokeObjectURL(audioUrl);
            console.log('[voiceFeedback] Notifying TTS state change: false (HTML5 Audio ended)');
            if (onTTSStateChange) {
              onTTSStateChange(false);
            }
            useAIStore.getState().setSpeaking(false);
            resolve();
          });
        };

        audio.onerror = (event) => {
          currentAudio = null;
          URL.revokeObjectURL(audioUrl);
          if (onTTSStateChange) {
            onTTSStateChange(false);
          }
          useAIStore.getState().setSpeaking(false);
          const errorMsg = audio.error ? `Code: ${audio.error.code}, Message: ${audio.error.message}` : 'Unknown audio error';
          console.error('[voiceFeedback] HTML5 Audio playback error:', errorMsg, event);
          reject(new Error(`Audio playback error: ${errorMsg}`));
        };

        // Notify that TTS is starting (for volume ducking)
        console.log('[voiceFeedback] Notifying TTS state change: true (HTML5 Audio) - BEFORE playback');
        if (onTTSStateChange) {
          onTTSStateChange(true);
        } else {
          console.warn('[voiceFeedback] onTTSStateChange callback is not set!');
        }
        useAIStore.getState().setSpeaking(true);
        
        // Wait for enough buffered data, then start playback
        await checkCanPlay();
        console.log('[voiceFeedback] Audio buffered, starting playback (readyState:', audio.readyState, ')');
        await audio.play();
        console.log('[voiceFeedback] HTML5 Audio playback started');
      } catch (playError: any) {
        currentAudio = null;
        URL.revokeObjectURL(audioUrl);
        if (onTTSStateChange) {
          onTTSStateChange(false);
        }
        useAIStore.getState().setSpeaking(false);
        console.error('[voiceFeedback] HTML5 Audio failed, trying Web Audio API fallback:', playError);
        
        // Fallback to Web Audio API if HTML5 Audio fails
        try {
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          const audioBuffer = await audioContext.decodeAudioData(audioData.buffer);
          const source = audioContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioContext.destination);
          
          const audioElement = { source, context: audioContext } as any;
          currentAudio = audioElement;
          
          source.onended = () => {
            // Use queueMicrotask to avoid long-task violations in ended handler
            // React logs warnings if event handlers take >50ms; moving cleanup to microtask prevents this
            queueMicrotask(() => {
              currentAudio = null;
              audioContext.close();
              URL.revokeObjectURL(audioUrl);
              if (onTTSStateChange) {
                onTTSStateChange(false);
              }
              useAIStore.getState().setSpeaking(false);
              resolve();
            });
          };
          
          if (onTTSStateChange) {
            onTTSStateChange(true);
          }
          useAIStore.getState().setSpeaking(true);
          
          source.start(0);
          console.log('[voiceFeedback] Web Audio API fallback playback started');
        } catch (fallbackError: any) {
          reject(new Error(`Failed to play audio: ${playError.message || playError}. Fallback also failed: ${fallbackError.message}`));
        }
      }
    });
  } catch (error) {
    if (onTTSStateChange) {
      onTTSStateChange(false);
    }
    useAIStore.getState().setSpeaking(false);
    throw error;
  }
}

/**
 * Generate and play TTS audio using Murf AI WebSocket (ultra-low latency streaming)
 * Falls back to HTTP API if WebSocket fails
 */
export async function speakResponse(text: string): Promise<void> {
  if (!text || text.trim().length === 0) {
    console.warn('[voiceFeedback] Empty text, skipping TTS');
    return;
  }

  try {
    console.log('[voiceFeedback] Generating TTS for:', text);
    
    // Try WebSocket streaming first (ultra-low latency, text chunk-by-chunk)
    try {
      const { speakWithWebSocket, setTTSStateChangeCallback } = await import('./murfWebSocketTTS');
      
      // Set up TTS state callback for volume ducking
      setTTSStateChangeCallback((isSpeaking: boolean) => {
        if (onTTSStateChange) {
          onTTSStateChange(isSpeaking);
        }
      });
      
      await speakWithWebSocket(text);
      console.log('[voiceFeedback] WebSocket TTS completed successfully');
      return;
    } catch (wsError: any) {
      console.warn('[voiceFeedback] WebSocket TTS failed, falling back to HTTP:', wsError);
      // Fall through to HTTP fallback
    }
    
    // Fallback to HTTP API (sends full text, receives audio stream)
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`TTS API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    
    if (!result.audio) {
      throw new Error('No audio data in TTS response');
    }

    // Play the audio
    await playAudioFromBase64(result.audio);
    console.log('[voiceFeedback] HTTP TTS completed successfully');
  } catch (error: any) {
    console.error('[voiceFeedback] TTS API error, falling back to Web Speech API:', error);
    // Fallback to Web Speech API (no API limits, browser-based)
    try {
      const { ttsManager } = await import('./ttsManager');
      await ttsManager.speak(text, { interrupt: true });
      console.log('[voiceFeedback] Web Speech API fallback succeeded');
    } catch (webSpeechError: any) {
      console.error('[voiceFeedback] Web Speech API also failed:', webSpeechError);
      // Don't re-throw - let it fail silently so the app continues
    }
  }
}

export function stopSpeaking(): void {
  if (currentAudio) {
    // Handle both HTML5 Audio and Web Audio API sources
    if ('pause' in currentAudio) {
      // HTML5 Audio
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } else if ('source' in currentAudio) {
      // Web Audio API
      try {
        currentAudio.source.stop();
        currentAudio.context.close();
      } catch (e) {
        // Source might already be stopped
      }
    }
    currentAudio = null;
  }
  if (onTTSStateChange) {
    onTTSStateChange(false);
  }
  useAIStore.getState().setSpeaking(false);
}
