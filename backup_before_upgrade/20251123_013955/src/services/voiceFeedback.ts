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

    // Play audio using Web Audio API for better format support
    return new Promise<void>(async (resolve, reject) => {
      try {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        // Decode audio data
        const audioBuffer = await audioContext.decodeAudioData(audioData.buffer);
        console.log('[voiceFeedback] Audio decoded successfully, duration:', audioBuffer.duration, 'seconds');
        
        // Create source and play
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);
        
        // Store reference for stopping
        const audioElement = { source, context: audioContext } as any;
        currentAudio = audioElement;
        
        source.onended = () => {
          currentAudio = null;
          audioContext.close();
          URL.revokeObjectURL(audioUrl);
          console.log('[voiceFeedback] Notifying TTS state change: false (Web Audio ended)');
          if (onTTSStateChange) {
            onTTSStateChange(false);
          }
          useAIStore.getState().setSpeaking(false);
          resolve();
        };
        
        // Notify that TTS is starting BEFORE playback starts (for immediate volume ducking)
        console.log('[voiceFeedback] Notifying TTS state change: true (Web Audio API) - BEFORE playback');
        console.log('[voiceFeedback] onTTSStateChange callback exists:', !!onTTSStateChange);
        if (onTTSStateChange) {
          console.log('[voiceFeedback] Calling onTTSStateChange(true)');
          onTTSStateChange(true);
          console.log('[voiceFeedback] onTTSStateChange(true) called');
        } else {
          console.warn('[voiceFeedback] onTTSStateChange callback is not set!');
        }
        useAIStore.getState().setSpeaking(true);
        
        // Start playback
        source.start(0);
        console.log('[voiceFeedback] Audio playback started');
      } catch (decodeError: any) {
        console.error('[voiceFeedback] Web Audio API decode failed, trying HTML5 Audio fallback:', decodeError);
        URL.revokeObjectURL(audioUrl);
        
        // Fallback to HTML5 Audio
        try {
          const audio = new Audio(audioUrl);
          currentAudio = audio;

          audio.onended = () => {
            currentAudio = null;
            URL.revokeObjectURL(audioUrl);
            console.log('[voiceFeedback] Notifying TTS state change: false (HTML5 Audio ended)');
            if (onTTSStateChange) {
              onTTSStateChange(false);
            }
            useAIStore.getState().setSpeaking(false);
            resolve();
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

          // Notify that TTS is starting BEFORE playback starts (for immediate volume ducking)
          console.log('[voiceFeedback] Notifying TTS state change: true (HTML5 Audio) - BEFORE playback');
          if (onTTSStateChange) {
            onTTSStateChange(true);
          } else {
            console.warn('[voiceFeedback] onTTSStateChange callback is not set!');
          }
          useAIStore.getState().setSpeaking(true);
          
          await audio.play();
          console.log('[voiceFeedback] HTML5 Audio playback started');
        } catch (playError: any) {
          currentAudio = null;
          URL.revokeObjectURL(audioUrl);
          if (onTTSStateChange) {
            onTTSStateChange(false);
          }
          useAIStore.getState().setSpeaking(false);
          reject(new Error(`Failed to play audio: ${playError.message || playError}`));
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
 * Generate and play TTS audio using Google AI API
 * This is a fallback if audio is not provided in the API response
 */
export async function speakResponse(text: string): Promise<void> {
  if (!text || text.trim().length === 0) {
    console.warn('[voiceFeedback] Empty text, skipping TTS');
    return;
  }

  try {
    console.log('[voiceFeedback] Generating TTS for:', text);
    
    // Call TTS API
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text,
        voice: 'Kore', // Default voice
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
    console.log('[voiceFeedback] TTS completed successfully');
  } catch (error: any) {
    console.error('[voiceFeedback] TTS error:', error);
    // Don't re-throw - let it fail silently so the app continues
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

