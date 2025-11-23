import { useEffect, useRef, useState, useCallback } from 'react';
import { useAIStore } from '../store/aiStore';
import { logger } from '../utils/logger';

interface Detection {
  type: 'detection';
  model: string;
  score: number;
  timestamp: number;
}

interface UseWakeWordDetectorOptions {
  wsUrl?: string;
  onDetection?: (detection: Detection) => void;
  enabled?: boolean;
}

interface WakeWordDetectorState {
  isListening: boolean;
  isConnected: boolean;
  lastDetection: Detection | null;
  error: string | null;
}

class WakeWordDetector {
  private wsUrl: string;
  private ws: WebSocket | null = null;
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private onDetection: ((detection: Detection) => void) | null = null;
  private isActive = false;
  private isPaused = false; // Pause audio chunk sending during command handling/TTS to reduce server load
  private lastSilenceWarnTime = 0; // Throttle silence warnings to once per second max (check every 50 chunks)
  // Ring buffer to capture audio before wake word detection (~3 seconds at 16kHz)
  // Increased to capture more audio during the gap between wake word detection and stream start
  private audioBuffer: Float32Array[] = [];
  private readonly MAX_BUFFER_CHUNKS = Math.ceil((16000 * 3.0) / 4096); // ~12 chunks for 3 seconds

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  setOnDetection(callback: (detection: Detection) => void) {
    this.onDetection = callback;
  }

  async start(): Promise<void> {
    if (this.isActive) {
      logger.log('WakeWord', 'Already active, skipping start');
      return;
    }

    // Clean up any existing connection first
    if (this.ws) {
      logger.log('WakeWord', 'Cleaning up existing WebSocket connection');
      this.ws.close();
      this.ws = null;
    }

    try {
      // Check if getUserMedia is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia is not available. This may be due to:\n' +
          '1. Page not served over HTTPS (or localhost)\n' +
          '2. Browser does not support getUserMedia\n' +
          '3. Microphone permissions denied');
      }

      logger.log('WakeWord', 'Requesting microphone access...');
      // Get microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: false,  // Disabled for better wake word detection
          noiseSuppression: false,   // Disabled for better wake word detection
          autoGainControl: false,    // Disabled to preserve natural audio levels
        },
      });
      logger.log('WakeWord', 'Microphone access granted');
      logger.log('WakeWord', 'Stream stored, getMediaStream() will return:', {
        hasStream: !!this.mediaStream,
        streamActive: this.mediaStream?.active,
        streamTracks: this.mediaStream?.getTracks().length || 0,
      });

      // Create audio context
      logger.log('WakeWord', 'Creating audio context...');
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      
      // Resume audio context if suspended (required for some browsers)
      if (this.audioContext.state === 'suspended') {
        logger.log('WakeWord', 'Audio context suspended, resuming...');
        await this.audioContext.resume();
      }
      logger.log('WakeWord', 'Audio context state:', this.audioContext.state);
      
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      logger.log('WakeWord', 'Audio context created, source connected');

      // Create script processor for audio capture
      // Use 4096 buffer size for better audio quality and more reliable detection
      // Smaller buffers (2048) can cause issues with noise gates and audio processing
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      let audioChunkCount = 0;
      let lastLogTime = Date.now();
      let pausedChunkCount = 0; // Track chunks skipped due to pause
      this.processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Always buffer audio (even when paused) to capture wake word
        // Add to ring buffer
        const chunkCopy = new Float32Array(inputData.length);
        chunkCopy.set(inputData);
        this.audioBuffer.push(chunkCopy);
        
        // Keep only last MAX_BUFFER_CHUNKS chunks
        if (this.audioBuffer.length > this.MAX_BUFFER_CHUNKS) {
          this.audioBuffer.shift();
        }
        
        if (!this.ws || this.isPaused) {
          // Paused during command handling - don't send chunks to reduce server load
          // Early return prevents any processing when paused
          pausedChunkCount++;
          // Log pause status occasionally to confirm it's working
          if (pausedChunkCount === 1) {
            logger.log('WakeWord', 'Chunk sending paused (isPaused=true), skipping chunks');
          }
          return;
        }
        
        // Reset paused counter when resuming
        if (pausedChunkCount > 0) {
          logger.log('WakeWord', `Resumed: skipped ${pausedChunkCount} chunks while paused`);
          pausedChunkCount = 0;
        }
        
        if (this.ws.readyState === WebSocket.OPEN) {
          // Convert float32 to int16
          const int16Data = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            int16Data[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
          }
          // Send to server
          try {
            // Verify data format before sending
            if (audioChunkCount === 0) {
              logger.log('WakeWord', `First audio chunk: ${int16Data.length} samples, buffer size: ${int16Data.buffer.byteLength} bytes`);
              // Log sample values to verify audio is not silent
              const sampleValues = Array.from(int16Data.slice(0, 10));
              const maxValue = Math.max(...sampleValues.map(Math.abs));
              logger.log('WakeWord', `Sample values (first 10):`, sampleValues, `max amplitude: ${maxValue}`);
              
              // Also check the raw float32 input to see if audio is being captured
              const rawSamples = Array.from(inputData.slice(0, 10));
              const rawMax = Math.max(...rawSamples.map(Math.abs));
              logger.log('WakeWord', `Raw float32 samples (first 10):`, rawSamples, `max: ${rawMax}`);
            }
            
            // Throttle silence warnings: check every 50 chunks, but only warn once per second max
            // This prevents log spam while still detecting microphone issues
            const now = Date.now();
            if (audioChunkCount > 0 && audioChunkCount % 50 === 0) {
              const sampleValues = Array.from(int16Data.slice(0, 10));
              const maxValue = Math.max(...sampleValues.map(Math.abs));
              if (maxValue === 0 && (now - this.lastSilenceWarnTime) >= 1000) {
                logger.warn('WakeWord', `Audio chunk ${audioChunkCount} is silent (max amplitude: 0) - microphone may not be capturing audio`);
                this.lastSilenceWarnTime = now;
              }
            }
            
            this.ws.send(int16Data.buffer);
            audioChunkCount++;
            // Log every 5 seconds (deduplication will handle repeats)
            if (now - lastLogTime > 5000) {
              const chunksPerSec = Math.round(audioChunkCount / ((now - lastLogTime) / 1000));
              const bytesPerSec = chunksPerSec * int16Data.buffer.byteLength;
              logger.log('WakeWord', `Sent ${audioChunkCount} audio chunks to server (${chunksPerSec} chunks/sec, ${Math.round(bytesPerSec / 1024)}KB/sec)`);
              lastLogTime = now;
            }
          } catch (error) {
            logger.error('WakeWord', 'Error sending audio chunk:', error);
          }
        } else {
          // Log if WebSocket is not ready (only once per state change)
          if (audioChunkCount === 0) {
            logger.warn('WakeWord', `WebSocket not ready (state: ${this.ws.readyState}), waiting...`);
          }
        }
      };

      // Connect source to processor
      source.connect(this.processor);
      
      // Connect processor to destination to keep audio graph active
      // ScriptProcessorNode requires a destination connection to process audio
      this.processor.connect(this.audioContext.destination);
      
      logger.log('WakeWord', 'Audio processor connected, ready to capture');
      logger.log('WakeWord', 'Audio context state:', this.audioContext.state);
      logger.log('WakeWord', 'MediaStream active tracks:', this.mediaStream.getAudioTracks().map(t => ({ 
        label: t.label, 
        enabled: t.enabled, 
        muted: t.muted,
        readyState: t.readyState 
      })));

      // Connect WebSocket
      logger.log('WakeWord', 'Connecting to WebSocket:', this.wsUrl);
      this.ws = new WebSocket(this.wsUrl);

      // Set up message handler - log ALL messages to debug
      this.ws.onmessage = (event) => {
        logger.debug('WakeWord', 'Raw WebSocket message received:', {
          type: typeof event.data,
          isString: typeof event.data === 'string',
          isArrayBuffer: event.data instanceof ArrayBuffer,
          length: event.data instanceof ArrayBuffer ? event.data.byteLength : event.data?.length,
          data: typeof event.data === 'string' ? event.data.substring(0, 100) : 'binary data'
        });
        
        try {
          // Handle both JSON and text messages
          let data: any;
          if (typeof event.data === 'string') {
            data = JSON.parse(event.data);
          } else if (event.data instanceof ArrayBuffer) {
            // If binary, try to parse as text first
            const text = new TextDecoder().decode(event.data);
            data = JSON.parse(text);
          } else {
            // Blob or other type
            logger.warn('WakeWord', 'Unexpected message type:', event.data);
            return;
          }
          
          logger.debug('WakeWord', 'Parsed WebSocket message:', data);
          logger.debug('WakeWord', 'Message type:', data.type, 'has callback:', !!this.onDetection);
          
          if (data.type === 'detection' && this.onDetection) {
            logger.log('WakeWord', '✓ Calling onDetection callback with:', data);
            this.onDetection(data as Detection);
          } else if (data.type === 'detection') {
            logger.warn('WakeWord', '⚠ Detection received but no callback set');
          } else {
            logger.debug('WakeWord', 'Received non-detection message:', data);
          }
        } catch (error) {
          logger.error('WakeWord', '✗ Failed to parse WebSocket message:', error);
          logger.error('WakeWord', 'Raw message data:', event.data);
          logger.error('WakeWord', 'Message type:', typeof event.data);
          if (event.data instanceof ArrayBuffer) {
            logger.error('WakeWord', 'ArrayBuffer size:', event.data.byteLength);
            // Try to see first few bytes
            const view = new Uint8Array(event.data.slice(0, 20));
            logger.error('WakeWord', 'First 20 bytes:', Array.from(view));
          }
        }
      };

      // Set up close handler
      this.ws.onclose = (event) => {
        logger.log('WakeWord', 'WebSocket closed:', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        });
        this.isActive = false;
      };

      // Wait for connection with timeout
      await new Promise<void>((resolve, reject) => {
        if (!this.ws) {
          reject(new Error('WebSocket not initialized'));
          return;
        }

        // Check if already connected
        if (this.ws.readyState === WebSocket.OPEN) {
          logger.log('WakeWord', 'WebSocket already open');
          this.isActive = true;
          resolve();
          return;
        }

        const timeout = setTimeout(() => {
          if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
            logger.error('WakeWord', 'WebSocket connection timeout, state:', this.ws.readyState);
            this.ws.close();
            reject(new Error('WebSocket connection timeout after 10 seconds'));
          }
        }, 10000);

        const onOpen = () => {
          clearTimeout(timeout);
          this.isActive = true;
          logger.log('WakeWord', 'WebSocket connected successfully, state:', this.ws?.readyState);
          // Remove handlers to prevent duplicate calls
          if (this.ws) {
            this.ws.removeEventListener('open', onOpen);
            this.ws.removeEventListener('error', onError);
          }
          resolve();
        };

        const onError = (error: Event) => {
          clearTimeout(timeout);
          logger.error('WakeWord', 'WebSocket connection error:', error);
          // Remove handlers
          if (this.ws) {
            this.ws.removeEventListener('open', onOpen);
            this.ws.removeEventListener('error', onError);
          }
          reject(error);
        };

        this.ws.addEventListener('open', onOpen);
        this.ws.addEventListener('error', onError);
      });
    } catch (error) {
      logger.error('WakeWord', 'Failed to start wake word detector:', error);
      this.stop();
      throw error;
    }
  }

  stop(): void {
    this.isActive = false;

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  getIsActive(): boolean {
    return this.isActive;
  }

  getIsConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getMediaStream(): MediaStream | null {
    const hasStream = !!this.mediaStream;
    const streamActive = this.mediaStream?.active;
    const streamTracks = this.mediaStream?.getTracks().length || 0;
    const audioTracks = this.mediaStream?.getAudioTracks() || [];
    const activeTracks = audioTracks.filter(t => t.readyState === 'live');
    
    logger.log('WakeWord', 'getMediaStream() called', {
      hasStream,
      streamActive,
      streamTracks,
      audioTracks: audioTracks.length,
      activeTracks: activeTracks.length,
      isActive: this.isActive,
      mediaStreamId: this.mediaStream ? 'present' : 'null',
      trackStates: audioTracks.map(t => ({ enabled: t.enabled, readyState: t.readyState, muted: t.muted }))
    });
    
    // If stream exists but is not active, log warning
    if (this.mediaStream && !streamActive) {
      logger.warn('WakeWord', 'MediaStream exists but is not active');
    }
    
    // If stream exists but has no active tracks, log warning but still return it
    // (tracks might become active later)
    if (this.mediaStream && activeTracks.length === 0 && audioTracks.length > 0) {
      logger.warn('WakeWord', 'MediaStream has tracks but none are live yet', {
        trackStates: audioTracks.map(t => ({ enabled: t.enabled, readyState: t.readyState }))
      });
    }
    
    return this.mediaStream;
  }

  /**
   * Get buffered audio from before wake word detection
   * Returns Float32Array chunks that can be prepended to recording
   */
  getBufferedAudio(): Float32Array[] {
    // Return a copy of the buffer
    return this.audioBuffer.map(chunk => new Float32Array(chunk));
  }

  /**
   * Clear the audio buffer (called after recording starts)
   */
  clearBuffer(): void {
    this.audioBuffer = [];
  }

  /**
   * Pause audio chunk sending (e.g., during command handling/TTS)
   * This reduces server load and prevents silent chunk spam
   */
  pause(): void {
    this.isPaused = true;
    logger.log('WakeWord', 'Paused audio chunk sending (isPaused=true)');
  }

  /**
   * Resume audio chunk sending after command/TTS completes
   */
  resume(): void {
    this.isPaused = false;
    logger.log('WakeWord', 'Resumed audio chunk sending (isPaused=false)');
  }
}

export function useWakeWordDetector({
  wsUrl = import.meta.env.VITE_WAKE_WORD_WS_URL || 'ws://localhost:8000/ws',
  onDetection,
  enabled = false,
}: UseWakeWordDetectorOptions = {}): WakeWordDetectorState & {
  start: () => Promise<void>;
  stop: () => void;
  getDetector: () => WakeWordDetector | null;
} {
  const [isListening, setIsListening] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [lastDetection, setLastDetection] = useState<Detection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const detectorRef = useRef<WakeWordDetector | null>(null);
  const connectionCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const { setPhase, setWakeDetected, setError: setAIError, setWakeWordEnabled } = useAIStore();

  // Initialize detector
  useEffect(() => {
    const detector = new WakeWordDetector(wsUrl);
    if (onDetection) {
      detector.setOnDetection((data) => {
        setLastDetection(data);
        // Update AI state
        setWakeDetected(data.score);
        onDetection(data);
      });
    } else {
      detector.setOnDetection((data) => {
        setLastDetection(data);
        // Update AI state
        setWakeDetected(data.score);
      });
    }
    detectorRef.current = detector;

    // Check connection status periodically
    connectionCheckIntervalRef.current = setInterval(() => {
      if (detectorRef.current) {
        const connected = detectorRef.current.getIsConnected();
        setIsConnected(connected);
        // If connection lost while enabled, set error
        const currentListening = detectorRef.current.getIsActive();
        if (!connected && currentListening) {
          setAIError('Wake word connection lost');
        }
      }
    }, 1000);

    return () => {
      if (connectionCheckIntervalRef.current) {
        clearInterval(connectionCheckIntervalRef.current);
      }
      detector.stop();
    };
  }, [wsUrl, onDetection]);

  const start = useCallback(async () => {
    if (detectorRef.current && !isListening) {
      try {
        setError(null);
        await detectorRef.current.start();
        setIsListening(true);
        setIsConnected(detectorRef.current.getIsConnected());
        // Update AI state: connection + enabled → listening
        setWakeWordEnabled(true);
        setPhase('listening');
      } catch (err: any) {
        const errorMsg = err.message || 'Failed to start wake word detector';
        setError(errorMsg);
        setIsListening(false);
        setIsConnected(false);
        // Update AI state: error
        setAIError('Wake word connection lost');
        setWakeWordEnabled(false);
      }
    }
  }, [isListening]);

  const stop = useCallback(() => {
    if (detectorRef.current) {
      detectorRef.current.stop();
      setIsListening(false);
      setIsConnected(false);
      // Update AI state: disabled → idle
      setWakeWordEnabled(false);
      setPhase('idle');
    }
  }, []);

  // Auto-start if enabled
  useEffect(() => {
    if (enabled && !isListening) {
      start();
    } else if (!enabled && isListening) {
      stop();
    }
  }, [enabled, isListening, start, stop]);

  const getDetector = useCallback(() => {
    return detectorRef.current;
  }, []);

  return {
    isListening,
    isConnected,
    lastDetection,
    error,
    start,
    stop,
    getDetector,
  };
}
