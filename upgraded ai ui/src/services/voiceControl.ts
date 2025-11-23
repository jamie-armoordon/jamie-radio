import { useAIStore } from '../store/aiStore';

interface VoiceCommand {
  type: 'play' | 'next' | 'previous' | 'volume_up' | 'volume_down' | 'mute' | 'unmute' | 'whats_playing';
  stationName?: string;
}

interface VoiceControlCallbacks {
  onCommand: (command: VoiceCommand) => void;
  onError?: (error: string) => void;
}

export class VoiceControl {
  private mediaRecorder: MediaRecorder | null = null;
  private audioStream: MediaStream | null = null;
  private callbacks: VoiceControlCallbacks | null = null;
  private isRecordingCommand = false;
  private recordingChunks: Blob[] = [];
  private recordingTimeout: NodeJS.Timeout | null = null;
  private readonly MAX_RECORDING_DURATION = 3000; // 3 seconds max for command (reduced to limit payload size)
  private stationList: string[] = []; // List of available station names
  // Wake word detection is now handled by WebSocket API

  constructor() {
    // Wake word detection is handled by WebSocket API
  }

  /**
   * Start recording command after wake word detection
   * This is called by the WebSocket wake word detection system
   */
  public async startCommandRecording(sharedStream?: MediaStream): Promise<void> {
    if (this.isRecordingCommand) {
      console.log('[VoiceControl] Already recording, ignoring duplicate start');
      return;
    }
    
    this.isRecordingCommand = true;
    this.recordingChunks = []; // Clear previous chunks
    
    // Update AI state: before recording starts → recording
    useAIStore.getState().setPhase('recording');
    
    // Wake word detection is handled by WebSocket API
    // No need to stop/restart here

    try {
      // Use shared stream if provided, otherwise get a new one
      if (sharedStream) {
        console.log('[VoiceControl] Using shared microphone stream');
        // Clone the stream so we don't interfere with wake word detector
        this.audioStream = new MediaStream(sharedStream.getTracks().map(track => track.clone()));
      } else {
        // Always get a fresh stream to ensure it's active
        // Stop any existing stream first
        if (this.audioStream) {
          console.log('[VoiceControl] Stopping existing audio stream');
          this.audioStream.getTracks().forEach(track => track.stop());
          this.audioStream = null;
        }
        
        console.log('[VoiceControl] Requesting microphone access...');
        this.audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        console.log('[VoiceControl] Microphone access granted');
      }
      
      // Check if stream is active
      const activeTracks = this.audioStream.getAudioTracks().filter(track => track.readyState === 'live');
      if (activeTracks.length === 0) {
        throw new Error('No active audio tracks');
      }
      console.log(`[VoiceControl] Active audio tracks: ${activeTracks.length}`);

      // Create MediaRecorder with lower bitrate to reduce file size
      const options: MediaRecorderOptions = {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 16000, // Lower bitrate (16kbps) to reduce payload size
      };

      // Fallback to default if webm not supported
      if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
        options.mimeType = 'audio/webm';
        // Remove audioBitsPerSecond if not supported
        if (!('audioBitsPerSecond' in options)) {
          delete (options as any).audioBitsPerSecond;
        }
      }

      this.mediaRecorder = new MediaRecorder(this.audioStream, options);
      this.recordingChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          console.log(`[VoiceControl] Received audio chunk: ${event.data.size} bytes`);
          this.recordingChunks.push(event.data);
        } else {
          console.warn('[VoiceControl] Received empty audio chunk');
        }
      };

      this.mediaRecorder.onstop = async () => {
        this.isRecordingCommand = false;
        
        console.log(`[VoiceControl] Recording stopped. Total chunks: ${this.recordingChunks.length}`);
        
        if (this.recordingChunks.length === 0) {
          console.error('[VoiceControl] No audio chunks captured!');
          // Wake word detection is handled by WebSocket API
          return;
        }

        // Calculate total size of chunks
        const totalChunkSize = this.recordingChunks.reduce((sum, chunk) => sum + chunk.size, 0);
        console.log(`[VoiceControl] Total chunk size: ${totalChunkSize} bytes (${(totalChunkSize / 1024).toFixed(2)}KB)`);
        
        // Combine all chunks into a single blob
        const audioBlob = new Blob(this.recordingChunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });
        
        // Check blob size
        const blobSizeMB = audioBlob.size / (1024 * 1024);
        const blobSizeKB = audioBlob.size / 1024;
        console.log(`[VoiceControl] Audio blob size: ${blobSizeKB.toFixed(2)}KB (${blobSizeMB.toFixed(2)}MB)`);
        
        if (audioBlob.size === 0) {
          console.error('[VoiceControl] Blob is empty despite having chunks!');
          console.error('[VoiceControl] Chunk details:', this.recordingChunks.map(c => ({ size: c.size, type: c.type })));
          return;
        }
        
        if (blobSizeMB > 10) {
          console.warn('[VoiceControl] Audio blob is large, may cause payload issues');
        }
        
        // Convert to base64 for API
        const reader = new FileReader();
        reader.onloadend = async () => {
          if (!reader.result || typeof reader.result !== 'string') {
            console.error('[VoiceControl] FileReader failed to read blob');
            return;
          }
          
          const base64Audio = reader.result.split(',')[1];
          
          if (!base64Audio || base64Audio.length === 0) {
            console.error('[VoiceControl] Base64 audio is empty!');
            return;
          }
          
          // Check base64 size
          const base64SizeMB = (base64Audio.length * 3) / 4 / (1024 * 1024);
          const base64SizeKB = (base64Audio.length * 3) / 4 / 1024;
          console.log(`[VoiceControl] Base64 size: ${base64SizeKB.toFixed(2)}KB (${base64SizeMB.toFixed(2)}MB)`);
          
          // Send to AI API for audio understanding (only after wake word detected)
          try {
            // Update AI state: when sending fetch → processing
            useAIStore.getState().setProcessing();
            
            console.log('[VoiceControl] Sending audio to AI API...');
            const response = await fetch('/api/ai-audio', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                audio: base64Audio,
                mimeType: this.mediaRecorder?.mimeType || 'audio/webm',
                stations: this.stationList, // Pass station list to AI
              }),
            });

            if (!response.ok) {
              console.error('[VoiceControl] AI API error:', response.status, response.statusText);
              useAIStore.getState().setError("Sorry, I didn't catch that");
              throw new Error(`AI API error: ${response.status}`);
            }
            
            console.log('[VoiceControl] AI API response received');

            const result = await response.json();
            
            // Store command JSON in AI store
            const aiStore = useAIStore.getState();
            if (result.command) {
              const command: typeof aiStore.lastCommand = {
                command: result.command,
                station: result.station,
                action: result.action,
                text: result.text,
                error: result.error,
              };
              aiStore.addToLog({
                phase: 'processing',
                command,
                spokenText: result.text,
              });
            }
            
            // Parse command from AI response (Gemini returns structured JSON)
            if (result.command && this.callbacks) {
              // Map AI command to VoiceCommand type
              let commandType: VoiceCommand['type'] = 'whats_playing';
              
              if (result.command === 'play') {
                commandType = 'play';
              } else if (result.command === 'next') {
                commandType = 'next';
              } else if (result.command === 'previous') {
                commandType = 'previous';
              } else if (result.command === 'volume') {
                commandType = result.action === 'up' ? 'volume_up' : 'volume_down';
              } else if (result.command === 'mute') {
                commandType = 'mute';
              } else if (result.command === 'unmute') {
                commandType = 'unmute';
              } else if (result.command === 'info') {
                commandType = 'whats_playing';
              }

              const command: VoiceCommand = {
                type: commandType,
                stationName: result.station,
              };
              
              // Play TTS audio if available from API response
              // The API now returns audio data directly
              if (result.audio && typeof result.audio === 'string') {
                console.log('[VoiceControl] Playing TTS audio from API response');
                try {
                  const { playAudioFromBase64 } = await import('./voiceFeedback');
                  await playAudioFromBase64(result.audio);
                  console.log('[VoiceControl] TTS audio played successfully');
                } catch (error) {
                  console.error('[VoiceControl] TTS audio playback failed:', error);
                  // Fallback to text-to-speech if audio playback fails
                  if (result.text) {
                    const { speakResponse } = await import('./voiceFeedback');
                    await speakResponse(result.text).catch((err) => {
                      console.error('[VoiceControl] Fallback TTS also failed:', err);
                    });
                  }
                }
              } else if (result.text) {
                // Fallback: use text-to-speech if no audio provided
                console.log('[VoiceControl] No audio in response, using text-to-speech for:', result.text);
                try {
                  const { speakResponse } = await import('./voiceFeedback');
                  await speakResponse(result.text);
                } catch (error) {
                  console.error('[VoiceControl] TTS failed:', error);
                }
              }
              
              // Call the command callback - Player component will handle command execution
              console.log('[VoiceControl] Calling onCommand callback with:', command);
              console.log('[VoiceControl] Callbacks object:', this.callbacks);
              console.log('[VoiceControl] onCommand function exists:', !!this.callbacks?.onCommand);
              if (this.callbacks?.onCommand) {
                try {
                  // Call the callback - it's async but we don't need to wait for it
                  const callbackResult = this.callbacks.onCommand(command) as any;
                  // If it returns a promise, catch errors
                  if (callbackResult && typeof callbackResult.then === 'function') {
                    callbackResult.catch((error: any) => {
                      console.error('[VoiceControl] Error in onCommand callback:', error);
                    });
                  }
                  console.log('[VoiceControl] onCommand callback executed (async)');
                } catch (error) {
                  console.error('[VoiceControl] Error executing onCommand callback:', error);
                }
              } else {
                console.error('[VoiceControl] onCommand callback is not set!');
              }
            }
          } catch (error) {
            console.error('Failed to process audio:', error);
            // Update AI state: fetch failure/timeout → error
            useAIStore.getState().setError("Sorry, I didn't catch that");
            if (this.callbacks?.onError) {
              this.callbacks.onError('Failed to process audio');
            }
          }

          // Wake word detection is handled by WebSocket API
        };

        reader.readAsDataURL(audioBlob);
      };

      // Wait a bit to ensure MediaRecorder is ready
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Start recording with timeslice to get data periodically
      // Request data every 250ms to ensure we capture audio
      // Using larger timeslice helps ensure data is available
      if (this.mediaRecorder.state === 'inactive') {
        this.mediaRecorder.start(250);
        console.log('[VoiceControl] Recording started, will stop after', this.MAX_RECORDING_DURATION, 'ms');
      } else {
        console.warn('[VoiceControl] MediaRecorder is not in inactive state:', this.mediaRecorder.state);
      }
      
      // Set max recording duration
      this.recordingTimeout = setTimeout(() => {
        console.log('[VoiceControl] Max recording duration reached, stopping...');
        console.log(`[VoiceControl] Chunks collected so far: ${this.recordingChunks.length}`);
        this.stopCommandRecording();
      }, this.MAX_RECORDING_DURATION);

    } catch (error: any) {
      console.error('Failed to start recording:', error);
      this.isRecordingCommand = false;
      // Update AI state: recording failure → error
      useAIStore.getState().setError(error.message || 'Failed to access microphone');
      if (this.callbacks?.onError) {
        this.callbacks.onError(error.message || 'Failed to access microphone');
      }
      // Wake word detection is handled by useWakeWord hook
    }
  }

  private stopCommandRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    
    if (this.recordingTimeout) {
      clearTimeout(this.recordingTimeout);
      this.recordingTimeout = null;
    }
  }

  public start(callbacks: VoiceControlCallbacks) {
    this.callbacks = callbacks;
    // Wake word detection is handled by WebSocket API
    // This method is kept for compatibility but doesn't start wake word detection
  }

  public setStationList(stations: string[]) {
    this.stationList = stations;
  }

  public stop() {
    this.isRecordingCommand = false;
    this.stopCommandRecording();
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }
  }

  public isSupported(): boolean {
    // Check for MediaRecorder support for command recording
    const hasMediaRecorder = typeof navigator !== 'undefined' &&
                             !!navigator.mediaDevices?.getUserMedia &&
                             'MediaRecorder' in window &&
                             typeof (window as any).MediaRecorder === 'function' &&
                             typeof (window as any).MediaRecorder.isTypeSupported === 'function';
    // Wake word detection is handled by WebSocket API
    return hasMediaRecorder;
  }
}

// Singleton instance
let voiceControlInstance: VoiceControl | null = null;

export function getVoiceControl(): VoiceControl {
  if (!voiceControlInstance) {
    voiceControlInstance = new VoiceControl();
  }
  return voiceControlInstance;
}
