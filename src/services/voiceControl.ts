interface VoiceCommand {
  type: 'play' | 'next' | 'previous' | 'volume_up' | 'volume_down' | 'mute' | 'unmute' | 'whats_playing';
  stationName?: string;
}

interface VoiceControlCallbacks {
  onCommand: (command: VoiceCommand) => void;
  onError?: (error: string) => void;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

export class VoiceControl {
  private wakeWordRecognition: SpeechRecognition | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioStream: MediaStream | null = null;
  private callbacks: VoiceControlCallbacks | null = null;
  private isListening = false;
  private isRecordingCommand = false;
  private recordingChunks: Blob[] = [];
  private recordingTimeout: NodeJS.Timeout | null = null;
  private readonly MAX_RECORDING_DURATION = 5000; // 5 seconds max for command
  private readonly WAKE_WORD = 'jamie';

  constructor() {
    // Initialize wake word detection using Web Speech API (lightweight, local)
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (SpeechRecognitionClass) {
      this.wakeWordRecognition = new SpeechRecognitionClass() as SpeechRecognition;
      this.wakeWordRecognition.continuous = true;
      this.wakeWordRecognition.interimResults = true; // Use interim for faster detection
      this.wakeWordRecognition.lang = 'en-GB';

      this.wakeWordRecognition.onresult = (event: SpeechRecognitionEvent) => {
        // Check interim results for faster wake word detection
        for (let i = event.results.length - 1; i >= 0; i--) {
          const result = event.results[i];
          const transcript = result[0].transcript.trim().toLowerCase();
          
          // Check if wake word is detected (even in interim results)
          if (transcript.includes(this.WAKE_WORD) && !this.isRecordingCommand) {
            // Wake word detected - start recording for Gemini
            this.startCommandRecording();
            break;
          }
        }
      };

      this.wakeWordRecognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        // Silently restart on errors
        if (event.error === 'no-speech' || event.error === 'audio-capture') {
          this.restartWakeWordDetection();
        }
      };

      this.wakeWordRecognition.onend = () => {
        // Restart wake word detection if still listening
        if (this.isListening && !this.isRecordingCommand) {
          this.restartWakeWordDetection();
        }
      };
    }
  }

  private async startCommandRecording(): Promise<void> {
    if (this.isRecordingCommand) return;
    
    this.isRecordingCommand = true;
    
    // Stop wake word detection temporarily
    if (this.wakeWordRecognition) {
      try {
        this.wakeWordRecognition.stop();
      } catch (e) {
        // Ignore errors
      }
    }

    try {
      // Request microphone access (reuse if already available)
      if (!this.audioStream) {
        this.audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      }

      // Create MediaRecorder
      const options: MediaRecorderOptions = {
        mimeType: 'audio/webm;codecs=opus',
      };

      // Fallback to default if webm not supported
      if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
        options.mimeType = 'audio/webm';
      }

      this.mediaRecorder = new MediaRecorder(this.audioStream, options);
      this.recordingChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordingChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        this.isRecordingCommand = false;
        
        if (this.recordingChunks.length === 0) {
          this.restartWakeWordDetection();
          return;
        }

        // Combine all chunks into a single blob
        const audioBlob = new Blob(this.recordingChunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });
        
        // Convert to base64 for API
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64Audio = (reader.result as string).split(',')[1]; // Remove data:audio/webm;base64, prefix
          
          // Send to AI API for audio understanding (only after wake word detected)
          try {
            const response = await fetch('/api/ai-audio', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                audio: base64Audio,
                mimeType: this.mediaRecorder?.mimeType || 'audio/webm',
              }),
            });

            if (!response.ok) {
              throw new Error(`AI API error: ${response.status}`);
            }

            const result = await response.json();
            
            // Parse command from AI response (Gemini returns structured JSON)
            if (result.command && this.callbacks) {
              // Speak the response text if available (from AI)
              if (result.text && 'speechSynthesis' in window) {
                const utterance = new SpeechSynthesisUtterance(result.text);
                utterance.lang = 'en-GB';
                window.speechSynthesis.speak(utterance);
              }

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
              this.callbacks.onCommand(command);
            }
          } catch (error) {
            console.error('Failed to process audio:', error);
            if (this.callbacks?.onError) {
              this.callbacks.onError('Failed to process audio');
            }
          }

          // Restart wake word detection
          this.restartWakeWordDetection();
        };

        reader.readAsDataURL(audioBlob);
      };

      // Start recording
      this.mediaRecorder.start();
      
      // Set max recording duration
      this.recordingTimeout = setTimeout(() => {
        this.stopCommandRecording();
      }, this.MAX_RECORDING_DURATION);

    } catch (error: any) {
      console.error('Failed to start recording:', error);
      this.isRecordingCommand = false;
      if (this.callbacks?.onError) {
        this.callbacks.onError(error.message || 'Failed to access microphone');
      }
      this.restartWakeWordDetection();
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

  private startWakeWordDetection(): void {
    if (!this.wakeWordRecognition || !this.isListening) return;

    try {
      this.wakeWordRecognition.start();
    } catch (error) {
      // Recognition might already be running
      this.restartWakeWordDetection();
    }
  }

  private restartWakeWordDetection(): void {
    if (!this.isListening || this.isRecordingCommand) return;

    setTimeout(() => {
      this.startWakeWordDetection();
    }, 100);
  }

  public start(callbacks: VoiceControlCallbacks) {
    this.callbacks = callbacks;
    this.isListening = true;

    // Start wake word detection (uses Web Speech API - lightweight, local)
    if (this.wakeWordRecognition) {
      this.startWakeWordDetection();
    } else {
      // Fallback: if no Web Speech API, use continuous recording (less efficient)
      console.warn('Web Speech API not available, using continuous recording');
      this.startCommandRecording();
    }
  }

  public stop() {
    this.isListening = false;
    this.isRecordingCommand = false;
    
    // Stop wake word detection
    if (this.wakeWordRecognition) {
      try {
        this.wakeWordRecognition.stop();
      } catch (e) {
        // Ignore errors
      }
    }
    
    // Stop recording
    this.stopCommandRecording();

    // Stop audio stream
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }
  }

  public isSupported(): boolean {
    // Check for either Web Speech API (preferred) or MediaRecorder (fallback)
    const hasSpeechRecognition = !!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition;
    
    let hasMediaRecorder = false;
    try {
      hasMediaRecorder = typeof navigator !== 'undefined' && 
                        !!navigator.mediaDevices?.getUserMedia && 
                        'MediaRecorder' in window &&
                        typeof (window as any).MediaRecorder === 'function' &&
                        typeof (window as any).MediaRecorder.isTypeSupported === 'function';
    } catch {
      hasMediaRecorder = false;
    }
    
    return hasSpeechRecognition || hasMediaRecorder;
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
