import { useAIStore } from '../store/aiStore';
import { useSettingsStore } from '../store/settingsStore';
import { Timer } from '../utils/timer';
import { logger } from '../utils/logger';
import { AssemblyAI } from 'assemblyai';

interface VoiceCommand {
  type: 'play' | 'next' | 'previous' | 'next_station' | 'previous_station' | 'set_volume' | 'volume_up' | 'volume_down' | 'mute' | 'unmute' | 'whats_playing';
  stationName?: string;
  level?: number;
}

interface VoiceControlCallbacks {
  onCommand: (command: VoiceCommand) => void;
  onError?: (error: string) => void;
}

// Note: AssemblyAIMessage interface no longer needed - SDK handles types internally

export class VoiceControl {
  private audioStream: MediaStream | null = null;
  private sharedStreamRef: MediaStream | null = null; // Reference to original shared stream from WakeWord
  private callbacks: VoiceControlCallbacks | null = null;
  private isRecordingCommand = false;
  private recordingTimeout: NodeJS.Timeout | null = null;
  private readonly MAX_RECORDING_DURATION = 30000; // 30 seconds max safety timeout
  private stationList: string[] = []; // List of available station names
  
  // Volume ducking state
  private originalVolume: number | null = null;
  private duckingTimeout: NodeJS.Timeout | null = null;
  
  // AssemblyAI streaming state
  private assemblyAiClient: AssemblyAI | null = null;
  private transcriber: any = null; // AssemblyAI streaming transcriber
  private audioContext: AudioContext | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private accumulatedTranscript: string = '';
  private readonly ASSEMBLYAI_SAMPLE_RATE = 16000; // 16kHz target (will resample from browser's native rate)
  private bufferedAudioChunks: Float32Array[] = []; // Buffered audio from before wake word detection
  
  /**
   * Set buffered audio chunks to prepend (can be called after startCommandRecording)
   */
  public setBufferedAudio(bufferedAudio: Float32Array[]): void {
    this.bufferedAudioChunks = bufferedAudio;
    if (bufferedAudio && bufferedAudio.length > 0) {
      const totalSamples = bufferedAudio.reduce((sum, chunk) => sum + chunk.length, 0);
      const durationMs = (totalSamples / 16000) * 1000;
      logger.log('VoiceControl', `Updated buffered audio: ${bufferedAudio.length} chunks (${totalSamples} samples, ~${durationMs.toFixed(0)}ms)`);
    }
  }
  
  // Token caching (tokens expire in 600 seconds / 10 minutes)
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private readonly TOKEN_REFRESH_BUFFER = 30; // Refresh 30 seconds before expiration
  // Note: We now resample to 16kHz and send 50ms frames (800 samples), so ASSEMBLYAI_CHUNK_SIZE is no longer used
  
  // Wake word detection is now handled by WebSocket API

  constructor() {
    // Wake word detection is handled by WebSocket API
  }

  /**
   * Duck radio volume during command recording
   * Finds audio elements on the page and reduces their volume
   */
  private duckRadioVolume(): void {
    try {
      // Find all audio elements on the page
      const audioElements = document.querySelectorAll('audio');
      if (audioElements.length === 0) {
        logger.log('VoiceControl', 'No audio elements found for volume ducking');
        return;
      }

      // Store original volumes and duck to 20%
      audioElements.forEach((audio, index) => {
        if (this.originalVolume === null && index === 0) {
          // Store original volume from first audio element (assuming they share volume)
          this.originalVolume = audio.volume;
        }
        // Duck to 20% volume
        audio.volume = Math.max(0.2, audio.volume * 0.2);
      });

      logger.log('VoiceControl', `Ducked ${audioElements.length} audio element(s) to 20% volume`);
      
      // Auto-restore after 10 seconds as safety
      if (this.duckingTimeout) {
        clearTimeout(this.duckingTimeout);
      }
      this.duckingTimeout = setTimeout(() => {
        this.restoreRadioVolume();
      }, 10000);
    } catch (error) {
      logger.error('VoiceControl', 'Failed to duck radio volume:', error);
    }
  }

  /**
   * Restore radio volume after command recording
   */
  private restoreRadioVolume(): void {
    try {
      if (this.duckingTimeout) {
        clearTimeout(this.duckingTimeout);
        this.duckingTimeout = null;
      }

      if (this.originalVolume === null) {
        return;
      }

      // Restore all audio elements to original volume
      const audioElements = document.querySelectorAll('audio');
      audioElements.forEach((audio) => {
        audio.volume = this.originalVolume!;
      });

      logger.log('VoiceControl', `Restored ${audioElements.length} audio element(s) to original volume (${this.originalVolume})`);
      this.originalVolume = null;
    } catch (error) {
      logger.error('VoiceControl', 'Failed to restore radio volume:', error);
    }
  }

  /**
   * Initialize audio stream for AssemblyAI streaming
   * Should be called once when voice control starts
   */
  public async initializeContinuousRecording(sharedStream?: MediaStream): Promise<void> {
    if (this.audioStream) {
      logger.log('VoiceControl', 'Audio stream already initialized');
      return;
    }

    try {
      // Use shared stream if provided, otherwise get a new one
      if (sharedStream) {
        logger.log('VoiceControl', 'Storing reference to shared stream (will clone fresh when needed)');
        // Store reference to original stream - we'll clone it fresh when we actually need it
        // This ensures we always get a fresh, active clone
        this.sharedStreamRef = sharedStream;
        
        // Verify the shared stream has active tracks
        const activeTracks = sharedStream.getAudioTracks().filter(track => track.readyState === 'live');
        if (activeTracks.length === 0) {
          logger.warn('VoiceControl', 'Shared stream has no active tracks yet, but storing reference anyway');
          // Don't throw - tracks might become active later
        } else {
          logger.log('VoiceControl', `Stored reference to shared stream with ${activeTracks.length} active track(s)`);
        }
      } else {
        logger.log('VoiceControl', 'Requesting microphone access for audio stream...');
        const constraints: MediaTrackConstraints = {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        };
        
        try {
          this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
        } catch (constraintError: any) {
          logger.warn('VoiceControl', 'Optimal constraints rejected, trying fallback:', constraintError.message);
          this.audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              channelCount: 1,
            },
          });
        }
        
        // Verify tracks are active for newly created stream
        const activeTracks = this.audioStream.getAudioTracks().filter(track => track.readyState === 'live');
        if (activeTracks.length === 0) {
          throw new Error('No active audio tracks');
        }
      }

      logger.log('VoiceControl', 'Audio stream initialized successfully');
    } catch (error: any) {
      logger.error('VoiceControl', 'Failed to initialize audio stream:', error);
      throw error;
    }
  }

  /**
   * Start AssemblyAI streaming transcription when wake word is detected
   * This is called by the WebSocket wake word detection system
   */
  public async startCommandRecording(sharedStream?: MediaStream, bufferedAudio?: Float32Array[]): Promise<void> {
    logger.log('VoiceControl', 'startCommandRecording() called', {
      isRecordingCommand: this.isRecordingCommand,
      hasAudioStream: !!this.audioStream,
      hasSharedStream: !!sharedStream,
      bufferedAudioChunks: bufferedAudio?.length || 0,
    });
    
    // Store buffered audio to prepend to stream
    if (bufferedAudio && bufferedAudio.length > 0) {
      this.bufferedAudioChunks = bufferedAudio;
      const totalSamples = bufferedAudio.reduce((sum, chunk) => sum + chunk.length, 0);
      const durationMs = (totalSamples / 16000) * 1000; // 16kHz sample rate
      logger.log('VoiceControl', `Stored ${bufferedAudio.length} buffered audio chunks (${totalSamples} samples, ~${durationMs.toFixed(0)}ms) to prepend`);
    } else {
      this.bufferedAudioChunks = [];
    }
    
    if (this.isRecordingCommand) {
      logger.log('VoiceControl', 'Already recording, ignoring duplicate start');
      return;
    }

    // Ensure audio stream is available
    // Always clone fresh from the original shared stream to ensure we get active audio
    // Priority: 1) sharedStream param, 2) stored sharedStreamRef, 3) existing audioStream
    const streamToClone = sharedStream || this.sharedStreamRef;
    
    if (!this.audioStream || !streamToClone) {
      if (streamToClone) {
        logger.log("VoiceControl", "Cloning fresh track from shared stream for AssemblyAI streaming");
        // Always clone fresh to ensure we get an active track
        const clonedTracks = streamToClone.getTracks().map((track) => {
          const cloned = track.clone();
          cloned.enabled = true;
          logger.log("VoiceControl", `Cloned track: ${track.kind}, enabled: ${cloned.enabled}, readyState: ${cloned.readyState}`);
          return cloned;
        });
        this.audioStream = new MediaStream(clonedTracks);
        
        // Verify the cloned stream has active tracks
        const activeTracks = this.audioStream.getAudioTracks().filter(t => t.readyState === 'live');
        if (activeTracks.length === 0) {
          logger.error("VoiceControl", "Cloned stream has no active tracks", {
            totalTracks: this.audioStream.getAudioTracks().length,
            trackStates: this.audioStream.getAudioTracks().map(t => ({ enabled: t.enabled, readyState: t.readyState }))
          });
          throw new Error("Cloned audio stream has no active tracks");
        }
        logger.log("VoiceControl", `Fresh cloned stream verified: ${activeTracks.length} active track(s)`);
      } else {
        // Log detailed error for debugging
        logger.error("VoiceControl", "No audio stream available", {
          hasAudioStream: !!this.audioStream,
          hasSharedStream: !!sharedStream,
          hasSharedStreamRef: !!this.sharedStreamRef,
        });
        throw new Error(
          "VoiceControl has no audio stream. Call initializeContinuousRecording(sharedStream) before starting a command."
        );
      }
    } else {
      // Reuse existing audioStream but verify it's still active
      logger.log("VoiceControl", "Reusing existing audio stream");
    }
    
    if (!this.audioStream) {
      logger.error('VoiceControl', 'No audio stream available for AssemblyAI streaming');
      throw new Error('No audio stream available');
    }
    
    // Verify stream has active tracks before proceeding
    const activeTracks = this.audioStream.getAudioTracks().filter(t => t.readyState === 'live' && t.enabled);
    if (activeTracks.length === 0) {
      logger.error('VoiceControl', 'Audio stream has no active enabled tracks', {
        totalTracks: this.audioStream.getAudioTracks().length,
        trackStates: this.audioStream.getAudioTracks().map(t => ({ enabled: t.enabled, readyState: t.readyState }))
      });
      throw new Error('Audio stream has no active enabled tracks');
    }

    this.isRecordingCommand = true;
    this.accumulatedTranscript = '';
    
    // Update AI state to recording IMMEDIATELY so user knows they can speak
    // This happens before setupAssemblyAIStreaming() to give immediate feedback
    useAIStore.getState().setPhase('recording');
    
    // Duck radio volume during command capture
    this.duckRadioVolume();
    
    // Connect to AssemblyAI streaming API
    await this.setupAssemblyAIStreaming();
    
    // Set max recording duration as safety timeout
    this.recordingTimeout = setTimeout(() => {
      if (this.isRecordingCommand) {
        logger.log('VoiceControl', 'Max recording duration reached, stopping streaming...');
        this.stopAssemblyAIStreaming();
      }
    }, this.MAX_RECORDING_DURATION);
  }

  /**
   * Get AssemblyAI token with caching and automatic refresh
   * Tokens expire in 600 seconds (10 minutes), we refresh 30 seconds before expiration
   */
  private async getAssemblyAIToken(): Promise<string> {
    const now = Date.now();
    const expiresInMs = this.tokenExpiresAt - now;
    
    // Check if we have a valid cached token (with 30s buffer for refresh)
    if (this.cachedToken && expiresInMs > this.TOKEN_REFRESH_BUFFER * 1000) {
      logger.log('VoiceControl', `Using cached AssemblyAI token (expires in ${Math.round(expiresInMs / 1000)}s)`);
      return this.cachedToken;
    }
    
    // Token expired or doesn't exist, fetch new one
    logger.log('VoiceControl', 'Fetching new AssemblyAI token...');
    const tokenResponse = await fetch('/api/assemblyai-token');
    if (!tokenResponse.ok) {
      throw new Error('Failed to get AssemblyAI token from backend');
    }
    const { token } = await tokenResponse.json();
    
    if (!token) {
      throw new Error('No AssemblyAI token available');
    }
    
    // Cache the token (expires in 600 seconds = 10 minutes)
    this.cachedToken = token;
    this.tokenExpiresAt = now + (600 * 1000); // 600 seconds in milliseconds
    logger.log('VoiceControl', 'AssemblyAI token cached, will expire in 600 seconds');
    
    return token;
  }

  /**
   * Set up AssemblyAI SDK streaming connection
   */
  private async setupAssemblyAIStreaming(): Promise<void> {
    if (!this.audioStream) {
      logger.error('VoiceControl', 'Cannot setup AssemblyAI: no audio stream');
      return;
    }

    try {
      // Get token (with caching and automatic refresh)
      const token = await this.getAssemblyAIToken();

      // Initialize AssemblyAI client (token will be passed to transcriber)
      this.assemblyAiClient = new AssemblyAI({
        apiKey: '', // Not used when token is provided
      });

      // Create streaming transcriber with token (required for browser)
      // Create streaming transcriber with token and endpointing configuration
      // Configure endpointing for balanced performance
      // Based on AssemblyAI docs: 0.5 threshold, balanced silence settings
      this.transcriber = this.assemblyAiClient.streaming.transcriber({
        sampleRate: this.ASSEMBLYAI_SAMPLE_RATE,
        formatTurns: false, // voice agent best practice - reduces latency
        token: token, // Use token instead of API key for browser compatibility
        // Balanced endpointing settings - with word_is_final check and 50ms frames, we can use more balanced values
        endOfTurnConfidenceThreshold: 0.5, // Balanced threshold
        minEndOfTurnSilenceWhenConfident: 560, // docs recommend 560ms for multi-speaker/captioning
        maxTurnSilence: 2000, // Allow longer commands while staying responsive
      });

      // Set up event handlers
      this.transcriber.on("open", ({ id }: { id: string }) => {
        logger.log("VoiceControl", `AssemblyAI session opened with ID: ${id}`);

      // Reduced delay - socket should be ready quickly, and we want to start capturing audio ASAP
      // The SDK needs minimal time to initialize its internal WebSocket connection
      // Reduced delay to minimize gap between wake word detection and audio capture
      setTimeout(() => {
        this.startAudioStreaming();
      }, 100); // Reduced from 300ms to 100ms to start capturing audio faster
      });

      this.transcriber.on('error', (error: any) => {
        logger.error('VoiceControl', 'AssemblyAI SDK error:', error);
        useAIStore.getState().setError("Failed to connect to transcription service");
        this.stopAssemblyAIStreaming();
      });

      this.transcriber.on('close', (code: number, reason: string) => {
        logger.log('VoiceControl', `AssemblyAI session closed: code=${code}, reason=${reason}`);
        if (code !== 1000 && this.isRecordingCommand) {
          logger.warn('VoiceControl', 'AssemblyAI session closed unexpectedly');
          useAIStore.getState().setError("Transcription connection lost");
        }
        this.transcriber = null;
      });

      // Timer to wait for formatted final transcript
      let endTimer: any = null;
      // Timeout to detect if no transcripts are received
      let noTranscriptTimer: any = null;
      let hasReceivedAnyEvent = false;

      // Set timeout to detect if no transcripts are received after 5 seconds
      // This helps diagnose audio format or connection issues
      noTranscriptTimer = setTimeout(() => {
        if (!hasReceivedAnyEvent) {
          logger.warn('VoiceControl', 'No transcript events received after 5 seconds - check audio format and connection');
        }
      }, 5000);

      // Listen for transcript events (partial updates)
      this.transcriber.on('transcript', (transcript: any) => {
        hasReceivedAnyEvent = true;
        if (noTranscriptTimer) {
          clearTimeout(noTranscriptTimer);
          noTranscriptTimer = null;
        }
        logger.log('VoiceControl', `AssemblyAI transcript event (partial):`, JSON.stringify(transcript));
        // Accumulate partial transcripts for better real-time feedback
        if (transcript?.text) {
          this.accumulatedTranscript = transcript.text;
        }
      });

      this.transcriber.on("turn", (turn: any) => {
        hasReceivedAnyEvent = true;
        if (noTranscriptTimer) {
          clearTimeout(noTranscriptTimer);
          noTranscriptTimer = null;
        }
        logger.log('VoiceControl', `AssemblyAI turn event received:`, JSON.stringify(turn));
        const raw = (turn.transcript || "").trim();
        if (!raw) {
          logger.warn('VoiceControl', 'AssemblyAI turn event has empty transcript');
          return;
        }

        this.accumulatedTranscript = raw;
        logger.log(
          "VoiceControl",
          `AssemblyAI transcript update (end_of_turn: ${turn.end_of_turn}, formatted: ${turn.turn_is_formatted}): ${raw}`
        );

        if (turn.end_of_turn) {
          const words = turn.words || [];
          const last = words[words.length - 1];

          // If last word isn't final, wait for another Turn
          if (last && last.word_is_final === false) {
            logger.log("VoiceControl", "EOT but last word not final yet; continuing.");
            return;
          }

          const wordCount = raw.split(/\s+/).filter(Boolean).length;
          const eotConf =
            turn.end_of_turn_confidence ??
            turn.endOfTurnConfidence ??
            1;

          // Ignore super-short endpoints - likely false positives
          // Require at least 2 words OR very high confidence (>0.9) for single words
          if (wordCount < 2 && eotConf < 0.9) {
            logger.log(
              "VoiceControl",
              `Ignoring short endpoint (words=${wordCount}, conf=${eotConf.toFixed(3)})`
            );
            return;
          }

          // Finalize immediately on EOT (formatTurns is false, so no formatted version to wait for)
          clearTimeout(endTimer);
          this.finalizeTranscript(raw);
        }
      });

      // Connect to AssemblyAI
      logger.log('VoiceControl', 'Connecting to AssemblyAI streaming service...');
      await this.transcriber.connect();

    } catch (error) {
      logger.error('VoiceControl', 'Failed to setup AssemblyAI streaming:', error);
      useAIStore.getState().setError("Failed to setup transcription");
      this.stopAssemblyAIStreaming();
    }
  }

  // Note: handleAssemblyAIMessage is no longer needed - SDK handles events via callbacks

  /**
   * Callback to get buffered audio right before streaming starts
   * This allows Player.tsx to update buffered audio after stream setup but before streaming
   */
  private getBufferedAudioCallback: (() => Float32Array[]) | null = null;
  
  /**
   * Set callback to get buffered audio right before streaming starts
   */
  public setBufferedAudioCallback(callback: () => Float32Array[]): void {
    this.getBufferedAudioCallback = callback;
  }

  /**
   * Start streaming audio to AssemblyAI (using SDK)
   */
  private startAudioStreaming(): void {
    if (!this.audioStream || !this.transcriber) {
      logger.error("VoiceControl", "Cannot start audio streaming: missing stream or transcriber");
      return;
    }

    try {
      // Get latest buffered audio right before streaming starts (captures gap audio)
      if (this.getBufferedAudioCallback) {
        const latestBufferedAudio = this.getBufferedAudioCallback();
        if (latestBufferedAudio && latestBufferedAudio.length > 0) {
          this.bufferedAudioChunks = latestBufferedAudio;
          const totalSamples = latestBufferedAudio.reduce((sum, chunk) => sum + chunk.length, 0);
          const durationMs = (totalSamples / 16000) * 1000;
          logger.log('VoiceControl', `Updated buffered audio before streaming: ${latestBufferedAudio.length} chunks (${totalSamples} samples, ~${durationMs.toFixed(0)}ms)`);
        }
        // Clear callback after use
        this.getBufferedAudioCallback = null;
      }
      
      // Verify transcriber is still valid
      if (!this.transcriber) {
        logger.error("VoiceControl", "Transcriber is null, cannot start streaming");
        return;
      }

      // Check if transcriber has a stream method
      if (!this.transcriber.stream) {
        logger.error("VoiceControl", "Transcriber stream method not available");
        this.stopAssemblyAIStreaming();
        return;
      }

      const audioStream = this.createAudioReadableStream();
      const transcriberStream = this.transcriber.stream();

      // Verify the stream is valid before piping
      if (!transcriberStream) {
        logger.error("VoiceControl", "Transcriber stream() returned null");
        this.stopAssemblyAIStreaming();
        return;
      }

      logger.log("VoiceControl", "Piping audio stream to transcriber");
      audioStream.pipeTo(transcriberStream).catch((error: any) => {
        logger.error("VoiceControl", "Error piping audio to transcriber:", error);
        // Don't stop if it's just a socket error - might recover
        if (error?.message?.includes("Socket is not open")) {
          logger.warn("VoiceControl", "Socket not ready yet, will retry on next chunk");
        } else {
          this.stopAssemblyAIStreaming();
        }
      });
      logger.log("VoiceControl", "Audio streaming to AssemblyAI SDK started");
    } catch (error) {
      logger.error("VoiceControl", "Failed to start audio streaming:", error);
      this.stopAssemblyAIStreaming();
    }
  }

  /**
   * Downsample audio buffer from input rate to target rate using linear interpolation
   * This provides better quality than averaging and reduces aliasing artifacts
   */
  private downsampleBuffer(
    input: Float32Array,
    inRate: number,
    outRate: number
  ): Float32Array {
    if (inRate === outRate) return input;

    const ratio = inRate / outRate;
    const newLength = Math.round(input.length / ratio);
    const result = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
      // Calculate the exact position in the input array
      const exactPos = i * ratio;
      const pos = Math.floor(exactPos);
      const frac = exactPos - pos;

      // Linear interpolation between two samples
      if (pos + 1 < input.length) {
        result[i] = input[pos] * (1 - frac) + input[pos + 1] * frac;
      } else if (pos < input.length) {
        // Last sample, no interpolation possible
        result[i] = input[pos];
      } else {
        result[i] = 0;
      }
    }
    return result;
  }

  /**
   * Convert Float32 samples to Int16 PCM16
   */
  private floatTo16BitPCM(samples: Float32Array): Int16Array {
    const out = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7FFF);
    }
    return out;
  }

  /**
   * Create a ReadableStream from MediaStream audio (for SDK)
   * Properly resamples to 16kHz and sends stable 50ms frames (800 samples)
   * AssemblyAI recommends 50ms frames for best accuracy and minimal tail loss
   */
  private createAudioReadableStream(): ReadableStream<any> {
    const targetRate = this.ASSEMBLYAI_SAMPLE_RATE; // 16000
    const FRAME_MS = 50; // docs-recommended
    const targetFrameSamples = Math.round(targetRate * (FRAME_MS / 1000)); // 50ms => 800 samples @ 16kHz

    let processor: ScriptProcessorNode | null = null;
    let ctx: AudioContext | null = null;
    let sink: GainNode | null = null;
    let floatRing: number[] = [];
    let chunkCount = 0;

    return new ReadableStream<any>({
      start: async (ctrl) => {
        try {
          // Prepend buffered audio first (before live stream starts)
          if (this.bufferedAudioChunks.length > 0) {
            logger.log("VoiceControl", `Prepending ${this.bufferedAudioChunks.length} buffered audio chunks`);
            
            // Combine all buffered chunks into a single Float32Array
            const totalSamples = this.bufferedAudioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const combinedBuffer = new Float32Array(totalSamples);
            let offset = 0;
            for (const chunk of this.bufferedAudioChunks) {
              combinedBuffer.set(chunk, offset);
              offset += chunk.length;
            }
            
            // Trim the wake word from the END of the buffer (newest audio)
            // The buffer is a ring buffer: [oldest ... newest]
            // Wake word detection happens, then there's a gap, then streaming starts
            // The wake word itself is in the buffer, followed by gap audio with command start
            // We want to remove the wake word (~1-1.5s) but keep the gap audio
            // Actually, we should keep MORE recent audio (gap + command start) and trim OLD audio
            // Keep only the last 1.5-2 seconds (gap audio + command start), trim older pre-wake-word audio
            const KEEP_DURATION_MS = 2000; // Keep last 2 seconds (gap audio + command start)
            const KEEP_SAMPLES = Math.round((KEEP_DURATION_MS / 1000) * targetRate);
            const samplesToKeep = Math.min(KEEP_SAMPLES, totalSamples);
            
            let trimmedBuffer = combinedBuffer;
            if (samplesToKeep < totalSamples && samplesToKeep > 0) {
              // Keep only the most recent portion (gap audio + command start, after wake word)
              trimmedBuffer = combinedBuffer.slice(totalSamples - samplesToKeep);
              const trimmedMs = (trimmedBuffer.length / targetRate) * 1000;
              const removedMs = ((totalSamples - trimmedBuffer.length) / targetRate) * 1000;
              logger.log("VoiceControl", `Trimmed buffered audio: removed ${totalSamples - trimmedBuffer.length} samples (~${removedMs.toFixed(0)}ms old audio), keeping ${trimmedBuffer.length} samples (~${trimmedMs.toFixed(0)}ms recent audio)`);
            } else {
              logger.log("VoiceControl", `Using full buffered audio: ${totalSamples} samples (~${(totalSamples / targetRate * 1000).toFixed(0)}ms)`);
            }
            
            // Convert to Int16Array and then to Uint8Array in 50ms chunks (800 samples @ 16kHz)
            let bufferOffset = 0;
            while (bufferOffset < trimmedBuffer.length) {
              const chunkSize = Math.min(targetFrameSamples, trimmedBuffer.length - bufferOffset);
              const chunk = trimmedBuffer.slice(bufferOffset, bufferOffset + chunkSize);
              
              // Convert Float32Array to Int16Array
              const pcm16 = this.floatTo16BitPCM(chunk);
              
              // Convert Int16Array to Uint8Array
              const uint8Array = new Uint8Array(pcm16.buffer);
              
              ctrl.enqueue(uint8Array);
              bufferOffset += chunkSize;
              
              logger.log("VoiceControl", `Enqueued buffered audio chunk: ${chunkSize} samples (${uint8Array.length} bytes)`);
            }
            
            logger.log("VoiceControl", `Finished prepending buffered audio: ${trimmedBuffer.length} samples (~${(trimmedBuffer.length / targetRate * 1000).toFixed(0)}ms)`);
            
            // Clear buffered audio after using it
            this.bufferedAudioChunks = [];
          }
          
          const Ctor = window.AudioContext || (window as any).webkitAudioContext;

          // Try to lock to 48k to avoid weird 192k capture; fallback if unsupported
          try {
            ctx = new Ctor({ sampleRate: 48000 });
          } catch {
            ctx = new Ctor();
          }

          const inRate = ctx.sampleRate;

          logger.log(
            "VoiceControl",
            `Input sampleRate=${inRate}Hz, target=${targetRate}Hz, frame size=${targetFrameSamples} samples (${FRAME_MS}ms)`
          );

          // Verify the stream is active before creating source
          const tracks = this.audioStream!.getAudioTracks();
          logger.log("VoiceControl", `Creating audio source with ${tracks.length} track(s)`, {
            trackStates: tracks.map(t => ({ enabled: t.enabled, readyState: t.readyState, muted: t.muted }))
          });

          const source = ctx.createMediaStreamSource(this.audioStream!);

          // Ensure AudioContext is running before creating processor
          if (ctx.state === 'suspended') {
            logger.log("VoiceControl", "AudioContext suspended, resuming...");
            await ctx.resume();
          }

          // Larger buffer so callbacks aren't tiny at 48k
          processor = ctx.createScriptProcessor(4096, 1, 1);

          // Track if we've seen any non-silent audio
          let hasSeenAudio = false;
          let silentChunkCount = 0;

          processor.onaudioprocess = (event) => {
            if (!this.isRecordingCommand) return;

            const input = event.inputBuffer.getChannelData(0);
            
            // Normalize audio levels to prevent clipping and improve quality
            // Find peak amplitude
            let maxAmplitude = 0;
            for (let i = 0; i < input.length; i++) {
              const abs = Math.abs(input[i]);
              if (abs > maxAmplitude) maxAmplitude = abs;
            }
            
            // Check if this is actual audio (not silence)
            // Threshold: 0.001 (very quiet but not zero)
            if (maxAmplitude > 0.001) {
              hasSeenAudio = true;
              silentChunkCount = 0;
            } else {
              silentChunkCount++;
              // If we've seen 10 consecutive silent chunks (2.5 seconds) after seeing audio,
              // something might be wrong, but we'll still process it
              if (hasSeenAudio && silentChunkCount > 10) {
                logger.warn(
                  "VoiceControl",
                  `Received ${silentChunkCount} consecutive silent chunks after audio started`
                );
              }
            }
            
            // Apply normalization if audio is too quiet or too loud
            // Target: peak around 0.7-0.8 to leave headroom
            let normalized = input;
            if (maxAmplitude > 0.001 && maxAmplitude < 0.95) {
              // Only normalize if audio is in reasonable range
              const gain = maxAmplitude > 0.8 ? 0.8 / maxAmplitude : (maxAmplitude < 0.3 ? 0.7 / maxAmplitude : 1.0);
              if (gain !== 1.0) {
                normalized = new Float32Array(input.length);
                for (let i = 0; i < input.length; i++) {
                  normalized[i] = input[i] * gain;
                }
              }
            }
            
            const down = this.downsampleBuffer(normalized, inRate, targetRate);

            for (let i = 0; i < down.length; i++) floatRing.push(down[i]);

            while (floatRing.length >= targetFrameSamples) {
              const frame = floatRing.splice(0, targetFrameSamples);
              const pcm16 = this.floatTo16BitPCM(Float32Array.from(frame));

              chunkCount++;
              if (chunkCount === 1) {
                logger.log(
                  "VoiceControl",
                  `First audio frame: ${pcm16.length} samples (${pcm16.buffer.byteLength} bytes), peak amplitude: ${maxAmplitude.toFixed(3)}, hasSeenAudio: ${hasSeenAudio}`
                );
                
                // Check if first chunk is silent - this might indicate a timing issue
                if (maxAmplitude < 0.001) {
                  logger.warn(
                    "VoiceControl",
                    "First audio chunk is silent - audio stream may not be ready yet"
                  );
                }
              }
              if (chunkCount % 4 === 0) {
                logger.log(
                  "VoiceControl",
                  `Sent audio frame ${chunkCount} to SDK (${pcm16.buffer.byteLength} bytes, ${FRAME_MS}ms @ 16kHz), peak: ${maxAmplitude.toFixed(3)}`
                );
              }

              // Convert Int16Array to Uint8Array for proper byte format
              // Int16Array uses little-endian, which is correct for PCM16
              const uint8Array = new Uint8Array(pcm16.buffer);
              
              // Log first chunk details for debugging
              if (chunkCount === 1) {
                logger.log(
                  "VoiceControl",
                  `First chunk details: Int16Array length=${pcm16.length}, Uint8Array length=${uint8Array.length}, first 4 bytes: [${uint8Array[0]}, ${uint8Array[1]}, ${uint8Array[2]}, ${uint8Array[3]}], first 2 Int16 values: [${pcm16[0]}, ${pcm16[1]}]`
                );
              }
              
              ctrl.enqueue(uint8Array);
            }
          };

          source.connect(processor);

          // Prevent monitoring mic into speakers (avoids AEC/warble),
          // but keep graph alive with a silent sink.
          sink = ctx.createGain();
          sink.gain.value = 0;
          processor.connect(sink);
          sink.connect(ctx.destination);

          this.scriptProcessor = processor;
          this.audioContext = ctx;
        } catch (err) {
          logger.error("VoiceControl", "Audio stream start failed:", err);
          ctrl.error(err);
        }
      },
      cancel: () => {
        if (processor) processor.disconnect();
        if (sink) sink.disconnect();
        if (ctx) ctx.close();
      },
    });
  }

  /**
   * Finalize transcript and send to AI
   * Called when end_of_turn is detected (after waiting for formatted version if needed)
   */
  private finalizeTranscript(text: string): void {
    logger.log('VoiceControl', 'Finalizing transcript:', text);
    
    // Allow one last frame to flush out before stopping
    const FRAME_MS = 50; // keep in sync with chunk size
    setTimeout(() => this.stopAssemblyAIStreaming(), FRAME_MS);
    
    if (text && text.trim().length > 0) {
      // Filter out wake word phrases (case-insensitive)
      let cleanedText = text.trim();
      
      // Remove "hey jarvis" and variations at the start of the transcript
      // Handles: "hey jarvis", "hey, jarvis", "hey jarvis,", "hey jarvis.", etc.
      cleanedText = cleanedText.replace(/^hey\s*[,.]?\s*jarvis\s*[,.]?\s*/i, '');
      
      // Also remove standalone "jarvis" or "hey" at the start
      cleanedText = cleanedText.replace(/^jarvis\s*[,.]?\s*/i, '');
      cleanedText = cleanedText.replace(/^hey\s*[,.]?\s*/i, '');
      
      cleanedText = cleanedText.trim();
      
      // Remove any leading punctuation/whitespace that might remain
      cleanedText = cleanedText.replace(/^[,.\s]+/, '');
      
      if (cleanedText.length > 0) {
        logger.log('VoiceControl', `Cleaned transcript: "${text}" -> "${cleanedText}"`);
        this.sendTranscriptToAI(cleanedText);
      } else {
        logger.warn('VoiceControl', 'Transcript only contained wake word, ignoring');
        useAIStore.getState().setError("Sorry, I didn't catch that");
        this.restoreRadioVolume();
      }
    } else {
      logger.warn('VoiceControl', 'End of turn but transcript is empty');
      useAIStore.getState().setError("Sorry, I didn't catch that");
      this.restoreRadioVolume();
    }
  }

  /**
   * Stop AssemblyAI streaming and clean up
   */
  private stopAssemblyAIStreaming(): void {
    this.isRecordingCommand = false;

    // Clean up audio processing
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(err => {
        logger.error('VoiceControl', 'Error closing audio context:', err);
      });
      this.audioContext = null;
    }

    // Close transcriber connection
    if (this.transcriber) {
      try {
        this.transcriber.close();
      } catch (error) {
        logger.warn('VoiceControl', 'Error closing transcriber:', error);
      }
      this.transcriber = null;
    }
    
    // Close client
    this.assemblyAiClient = null;

    // Clear timeout
    if (this.recordingTimeout) {
      clearTimeout(this.recordingTimeout);
      this.recordingTimeout = null;
    }
  }

  /**
   * Send transcript text to AI API for processing
   */
  private async sendTranscriptToAI(transcript: string): Promise<void> {
    if (!transcript || transcript.trim().length === 0) {
      logger.warn('VoiceControl', 'Empty transcript, not sending to AI');
      useAIStore.getState().setError("Sorry, I didn't catch that");
      this.restoreRadioVolume();
      return;
    }

    try {
      // Create timer for this voice interaction
      const interactionId = `voice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const timer = new Timer(interactionId);
      
      // Update AI state: when sending fetch → processing
      useAIStore.getState().setProcessing();
      
      timer.mark('transcript ready');
      timer.mark('AI request sent');
      
      logger.log('VoiceControl', 'Sending transcript to AI API:', transcript);
      
      // Get location from settings store if available
      const settings = useSettingsStore.getState();
      const location = settings.useDeviceLocation && settings.fallbackLocation.lat && settings.fallbackLocation.lon
        ? {
            lat: settings.fallbackLocation.lat,
            lon: settings.fallbackLocation.lon,
            city: settings.fallbackLocation.city || undefined,
          }
        : undefined;
      
      // Use SSE streaming API
      const response = await fetch('/api/ai-text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: transcript,
          stations: this.stationList, // Pass station list to AI
          location: location, // Pass location if available for weather queries
        }),
      });

      if (!response.ok) {
        logger.error('VoiceControl', 'AI API error:', response.status, response.statusText);
        useAIStore.getState().setError("Sorry, I didn't catch that");
        throw new Error(`AI API error: ${response.status}`);
      }
      
      timer.mark('SSE/stream opened');
      
      logger.log('[VoiceControl] Response Content-Type:', response.headers.get('Content-Type'));
      logger.log('[VoiceControl] Response status:', response.status);
      logger.log('[VoiceControl] Response body available:', !!response.body);
      
      // Read SSE stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let speakTextAccumulated = '';
      let finalCommand: any = null;
      let firstSpeakTextChunk = true;
      let ttsPromise: Promise<void> | null = null;
      
      // Import Murf WS TTS for progressive feeding
      const { speakWithWebSocket } = await import('./murfWebSocketTTS');
      
      if (!reader) {
        logger.error('[VoiceControl] Response body is not readable!');
        throw new Error('Response body is not readable');
      }
      
      logger.log('[VoiceControl] Starting to read SSE stream...');
      
      // Process SSE stream
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          logger.log('VoiceControl', 'SSE stream ended. Buffer remaining:', buffer);
          break;
        }
        
        const chunk = decoder.decode(value, { stream: true });
        logger.log('[VoiceControl] Received SSE chunk:', chunk.substring(0, 100));
        buffer += chunk;
        
        // Parse SSE events (format: "data: {...}\n\n")
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (line.trim() === '') continue; // Skip empty lines
          
          logger.log('[VoiceControl] Processing SSE line:', line.substring(0, 100));
          
          if (line.startsWith('data: ')) {
            const dataStr = line.substring(6).trim();
            
            if (dataStr === '[DONE]') {
              logger.log('[VoiceControl] Received [DONE] marker');
              continue;
            }
            
            try {
              const event = JSON.parse(dataStr);
              logger.log('[VoiceControl] Parsed SSE event:', event);
              
              if (event.type === 'speak_text' && event.text) {
                logger.log('[VoiceControl] Received speak_text:', event.text);
                if (firstSpeakTextChunk && timer) {
                  timer.mark('first speak_text chunk arrived');
                  firstSpeakTextChunk = false;
                }
                
                speakTextAccumulated += event.text;
                
                // Start TTS immediately with accumulated text for low latency
                // speakWithWebSocket will handle chunking internally (5 words at a time)
                if (!ttsPromise && speakTextAccumulated.trim().length > 0) {
                  timer.mark('Murf WS opened');
                  logger.log('[VoiceControl] Starting TTS with text:', speakTextAccumulated);
                  ttsPromise = speakWithWebSocket(speakTextAccumulated);
                }
              } else if (event.type === 'command' && event.command) {
                logger.log('[VoiceControl] Received command:', event.command);
                finalCommand = event.command;
              } else if (event.type === 'error') {
                logger.error('[VoiceControl] Received error from AI API:', event.error);
                throw new Error(event.error || 'Unknown error from AI API');
              }
            } catch (parseError) {
              logger.warn('[VoiceControl] Failed to parse SSE event:', parseError, 'Data:', dataStr);
            }
          } else {
            logger.log('[VoiceControl] Non-data line:', line);
          }
        }
      }
      
      logger.log('[VoiceControl] SSE stream ended. Buffer remaining:', buffer);
      
      // If we have accumulated text but didn't start TTS yet, start it now
      if (speakTextAccumulated && !ttsPromise) {
        if (timer) {
          timer.mark('Murf WS opened');
        }
        logger.log('[VoiceControl] Starting TTS with accumulated text:', speakTextAccumulated);
        ttsPromise = speakWithWebSocket(speakTextAccumulated);
      }
      
      // Wait for TTS to complete before executing command
      if (ttsPromise) {
        try {
          logger.log('[VoiceControl] Waiting for TTS to complete...');
          await ttsPromise;
          logger.log('[VoiceControl] TTS completed successfully');
          if (timer) {
            timer.mark('TTS playback finished');
          }
        } catch (ttsError) {
          logger.error('[VoiceControl] TTS failed, not executing command:', ttsError);
          useAIStore.getState().setError("Sorry, I had trouble speaking that");
          // Restore radio volume even on TTS failure
          this.restoreRadioVolume();
          // Don't execute command if TTS failed
          return;
        }
      }
      
      // Restore radio volume after TTS completes
      this.restoreRadioVolume();
      
      // Now execute command after TTS finishes successfully
      if (finalCommand && this.callbacks) {
        // Map AI command to VoiceCommand type
        let commandType: VoiceCommand['type'] = 'whats_playing';
        
        if (finalCommand.type === 'play') {
          commandType = 'play';
        } else if (finalCommand.type === 'next' || finalCommand.type === 'next_station') {
          commandType = 'next';
        } else if (finalCommand.type === 'previous' || finalCommand.type === 'previous_station') {
          commandType = 'previous';
        } else if (finalCommand.type === 'volume_up') {
          commandType = 'volume_up';
        } else if (finalCommand.type === 'volume_down') {
          commandType = 'volume_down';
        } else if (finalCommand.type === 'mute') {
          commandType = 'mute';
        } else if (finalCommand.type === 'unmute') {
          commandType = 'unmute';
        } else if (finalCommand.type === 'whats_playing') {
          commandType = 'whats_playing';
        } else if (finalCommand.type === 'set_volume') {
          commandType = 'set_volume';
        }

        const command: VoiceCommand = {
          type: commandType,
          stationName: finalCommand.stationName || undefined,
          level: finalCommand.level ?? undefined,
        };
        
        timer.mark('command executed');
        
        // Execute command now that TTS is done
        logger.log('[VoiceControl] Calling onCommand callback with:', command);
        if (this.callbacks?.onCommand) {
          try {
            await this.callbacks.onCommand(command);
            logger.log('[VoiceControl] onCommand callback executed');
          } catch (error) {
            logger.error('[VoiceControl] Error executing onCommand callback:', error);
          }
        } else {
          logger.error('[VoiceControl] onCommand callback is not set!');
        }
      }
      
      // Store command JSON in AI store
      const aiStore = useAIStore.getState();
      if (finalCommand) {
        const command: typeof aiStore.lastCommand = {
          command: finalCommand.type,
          station: finalCommand.stationName,
          text: speakTextAccumulated,
        };
        aiStore.addToLog({
          phase: 'processing',
          command,
          spokenText: speakTextAccumulated,
        });
      }
      
    } catch (error) {
      logger.error('VoiceControl', 'Failed to process transcript:', error);
      // Restore radio volume on error
      this.restoreRadioVolume();
      // Update AI state: fetch failure/timeout → error
      useAIStore.getState().setError("Sorry, I didn't catch that");
      if (this.callbacks?.onError) {
        this.callbacks.onError('Failed to process transcript');
      }
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
    
    // Stop AssemblyAI streaming
    this.stopAssemblyAIStreaming();
    
    // Stop audio stream
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }
    
    // Clear timeouts
    if (this.recordingTimeout) {
      clearTimeout(this.recordingTimeout);
      this.recordingTimeout = null;
    }
    
    // Restore radio volume
    this.restoreRadioVolume();
  }

  public isSupported(): boolean {
    // Check for WebSocket and AudioContext support
    const hasWebSocket = typeof WebSocket !== 'undefined';
    const hasAudioContext = typeof AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined';
    const hasGetUserMedia = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
    
    return hasWebSocket && hasAudioContext && hasGetUserMedia;
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
