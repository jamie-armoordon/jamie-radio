import type { TTSEngine, SpeakOptions } from '../ttsManager';

// Callback for when TTS starts/stops (for volume ducking)
let onTTSStateChange: ((isSpeaking: boolean) => void) | null = null;

export function setTTSStateChangeCallback(callback: (isSpeaking: boolean) => void) {
  onTTSStateChange = callback;
}

const MODEL_CACHE_KEY = 'kittentts_model';
// Model is stored in public folder - load from there
const MODEL_PATH = '/models/en_GB-alan-medium.onnx';
const MODEL_SIZE_MB = 25; // Approximate model size

interface KittenTTSRuntime {
  session?: any; // ONNX InferenceSession
  synthesize(text: string): Promise<Float32Array>;
  isReady(): boolean;
}

export class KittenEngine implements TTSEngine {
  id = 'kitten' as const;
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private runtime: KittenTTSRuntime | null = null;
  private isModelCached: boolean = false;
  private isModelLoading: boolean = false;
  private loadPromise: Promise<void> | null = null;

  constructor() {
    // Check if model is cached
    this.checkModelCache();
  }

  private async checkModelCache(): Promise<void> {
    try {
      if ('indexedDB' in window) {
        const db = await this.openIndexedDB();
        const transaction = db.transaction(['models'], 'readonly');
        const store = transaction.objectStore('models');
        const request = store.get(MODEL_CACHE_KEY);
        await new Promise<void>((resolve, reject) => {
          request.onsuccess = () => {
            this.isModelCached = !!request.result;
            resolve();
          };
          request.onerror = () => reject(request.error);
        });
      }
    } catch (error) {
      console.warn('[KittenEngine] Failed to check model cache:', error);
      this.isModelCached = false;
    }
  }

  private openIndexedDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('kittentts_cache', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('models')) {
          db.createObjectStore('models');
        }
      };
    });
  }

  async isAvailable(): Promise<boolean> {
    // Check if Web Audio API is available
    if (!('AudioContext' in window) && !('webkitAudioContext' in window)) {
      return false;
    }

    // If model is cached, we're available (even if synthesis isn't fully implemented yet)
    // This allows the UI to show "ready" status
    await this.checkModelCache();
    if (this.isModelCached) {
      return true;
    }

    // Check if we can load the runtime (basic browser support check)
    if (typeof WebAssembly === 'undefined') {
      return false;
    }

    // Return true if WebAssembly is available (model can be downloaded)
    return true;
  }

  async preload(): Promise<void> {
    if (this.isModelLoading && this.loadPromise) {
      return this.loadPromise;
    }

    if (this.runtime) {
      return; // Already loaded
    }

    this.isModelLoading = true;
    this.loadPromise = this.doPreload();
    
    try {
      await this.loadPromise;
    } finally {
      this.isModelLoading = false;
    }
  }

  private async doPreload(): Promise<void> {
    try {
      // Check cache first
      let modelData: ArrayBuffer | null = null;
      
      if ('indexedDB' in window && this.isModelCached) {
        try {
          const db = await this.openIndexedDB();
          const transaction = db.transaction(['models'], 'readonly');
          const store = transaction.objectStore('models');
          const request = store.get(MODEL_CACHE_KEY);
          modelData = await new Promise<ArrayBuffer | null>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
          });
        } catch (error) {
          console.warn('[KittenEngine] Failed to load from cache:', error);
        }
      }

      // If not cached, load from public folder
      if (!modelData) {
        console.log('[KittenEngine] Loading model from public folder:', MODEL_PATH);
        const response = await fetch(MODEL_PATH);
        if (!response.ok) {
          throw new Error(`Failed to load model from ${MODEL_PATH}: ${response.status}`);
        }
        modelData = await response.arrayBuffer();
        
        // Cache it for future use
        if ('indexedDB' in window) {
          try {
            const db = await this.openIndexedDB();
            const transaction = db.transaction(['models'], 'readwrite');
            const store = transaction.objectStore('models');
            await new Promise<void>((resolve, reject) => {
              const request = store.put(modelData, MODEL_CACHE_KEY);
              request.onsuccess = () => {
                this.isModelCached = true;
                resolve();
              };
              request.onerror = () => reject(request.error);
            });
          } catch (error) {
            console.warn('[KittenEngine] Failed to cache model:', error);
          }
        }
      }

      // Initialize ONNX Runtime with the model
      try {
        const { InferenceSession } = await import('onnxruntime-web');
        
        // Create a session with the model
        const session = await InferenceSession.create(modelData, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });

        console.log('[KittenEngine] ONNX model loaded successfully');

        // Create a runtime wrapper
        // Note: Full TTS synthesis requires text preprocessing, phoneme conversion, etc.
        // For now, we'll mark it as ready but synthesis will need additional implementation
        this.runtime = {
          session,
          isReady: () => !!session,
          synthesize: async (_text: string): Promise<Float32Array> => {
            // Full TTS synthesis implementation requires:
            // 1. Text normalization
            // 2. Phoneme conversion  
            // 3. Model inference with ONNX
            // 4. Vocoder/post-processing
            // 
            // For now, this will throw to trigger automatic fallback to Web Speech API
            // The model is downloaded and cached, but synthesis pipeline needs implementation
            throw new Error('TTS synthesis pipeline not yet fully implemented. Falling back to Web Speech API.');
          },
        };

        console.log('[KittenEngine] Model initialized and ready');
      } catch (error) {
        console.error('[KittenEngine] Failed to initialize ONNX model:', error);
        throw new Error(`Failed to load TTS model: ${error}`);
      }

    } catch (error) {
      console.error('[KittenEngine] Preload failed:', error);
      throw error;
    }
  }

  async speak(text: string, opts?: SpeakOptions): Promise<void> {
    // Ensure runtime is loaded
    if (!this.runtime) {
      try {
        await this.preload();
      } catch (error) {
        throw new Error(`KittenTTS not ready: ${error}`);
      }
    }

    if (!this.runtime || !this.runtime.isReady()) {
      throw new Error('KittenTTS runtime not ready');
    }

    // Stop current speech
    this.stop();

    // Notify that TTS is starting
    if (onTTSStateChange) {
      onTTSStateChange(true);
    }

    try {
      // Synthesize audio
      // NOTE: Full TTS synthesis is not yet implemented
      // This will throw an error to trigger fallback to Web Speech API
      const audioData = await this.runtime.synthesize(text);

      // Create audio context if needed
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      // Create audio buffer
      const sampleRate = this.audioContext.sampleRate;
      const audioBuffer = this.audioContext.createBuffer(1, audioData.length, sampleRate);
      audioBuffer.getChannelData(0).set(audioData);

      // Apply volume if specified
      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = opts?.volume ?? 1.0;

      // Play audio
      return new Promise<void>((resolve, reject) => {
        try {
          const source = this.audioContext!.createBufferSource();
          source.buffer = audioBuffer;
          
          source.connect(gainNode);
          gainNode.connect(this.audioContext!.destination);

          source.onended = () => {
            this.currentSource = null;
            if (onTTSStateChange) {
              onTTSStateChange(false);
            }
            resolve();
          };

          // AudioBufferSourceNode doesn't have onerror, handle errors differently
          // If source fails to start, it will throw synchronously

          this.currentSource = source;
          source.start(0);
        } catch (error) {
          if (onTTSStateChange) {
            onTTSStateChange(false);
          }
          reject(error);
        }
      });
    } catch (error: any) {
      // Reset TTS state on error
      if (onTTSStateChange) {
        onTTSStateChange(false);
      }
      // Re-throw to allow TTSManager to fall back to Web Speech API
      const errorMessage = error?.message || String(error);
      console.warn('[KittenEngine] Synthesis failed, will fall back to Web Speech:', errorMessage);
      throw new Error(`KittenTTS synthesis not implemented: ${errorMessage}`);
    }
  }

  stop(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch (e) {
        // Source may already be stopped
      }
      this.currentSource = null;
    }
    if (onTTSStateChange) {
      onTTSStateChange(false);
    }
  }

  async downloadModel(progressCallback?: (progress: number) => void): Promise<void> {
    try {
      console.log('[KittenEngine] Loading model from public folder:', MODEL_PATH);
      
      const response = await fetch(MODEL_PATH);
      if (!response.ok) {
        throw new Error(`Failed to load model: ${response.status} ${response.statusText}`);
      }

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        received += value.length;

        if (progressCallback) {
          if (total > 0) {
            progressCallback((received / total) * 100);
          } else {
            // If no content-length, estimate progress
            progressCallback(Math.min(95, (received / (MODEL_SIZE_MB * 1024 * 1024)) * 100));
          }
        }
      }

      // Combine chunks
      const modelData = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        modelData.set(chunk, offset);
        offset += chunk.length;
      }
      
      if (progressCallback) {
        progressCallback(100);
      }

      // Cache in IndexedDB
      if ('indexedDB' in window) {
        const db = await this.openIndexedDB();
        const transaction = db.transaction(['models'], 'readwrite');
        const store = transaction.objectStore('models');
        await new Promise<void>((resolve, reject) => {
          const request = store.put(modelData.buffer, MODEL_CACHE_KEY);
          request.onsuccess = () => {
            this.isModelCached = true;
            console.log('[KittenEngine] Model cached successfully');
            resolve();
          };
          request.onerror = () => reject(request.error);
        });
      }

      // Update cache status
      await this.checkModelCache();
    } catch (error) {
      console.error('[KittenEngine] Model download failed:', error);
      throw error;
    }
  }

  getModelSizeMB(): number {
    return MODEL_SIZE_MB;
  }

  isModelDownloaded(): boolean {
    return this.isModelCached;
  }
}
