import { useEffect, useRef, useState, useCallback } from 'react';
import { useAIStore } from '../store/aiStore';

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

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  setOnDetection(callback: (detection: Detection) => void) {
    this.onDetection = callback;
  }

  async start(): Promise<void> {
    if (this.isActive) return;

    try {
      // Get microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Create audio context
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Create script processor for audio capture
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          // Convert float32 to int16
          const int16Data = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            int16Data[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
          }
          // Send to server
          this.ws.send(int16Data.buffer);
        }
      };

      source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      // Connect WebSocket
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'detection' && this.onDetection) {
            this.onDetection(data as Detection);
          }
        } catch (error) {
          console.error('[WakeWord] Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WakeWord] WebSocket error:', error);
      };

      this.ws.onclose = () => {
      };

      await new Promise<void>((resolve, reject) => {
        if (!this.ws) {
          reject(new Error('WebSocket not initialized'));
          return;
        }

      this.ws.onopen = () => {
        this.isActive = true;
        console.log('[WakeWord] WebSocket connected successfully');
        resolve();
      };

        this.ws.onerror = (error) => {
          reject(error);
        };
      });
    } catch (error) {
      console.error('[WakeWord] Failed to start wake word detector:', error);
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
    return this.mediaStream;
  }
}

export function useWakeWordDetector({
  wsUrl = 'ws://localhost:8000/ws',
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

