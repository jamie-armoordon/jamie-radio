"use client"

import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import type { RadioStation } from "../types/station"
import { motion, AnimatePresence } from "framer-motion"
import Hls from "hls.js"
import { Play, Pause, Volume2, VolumeX, AlertCircle, Loader2, WifiOff } from "lucide-react"
import { useStationMetadata } from "../hooks/useStationMetadata"
import { useSettingsStore } from "../store/settingsStore"
import { useAIStore } from "../store/aiStore"
import { useIdleTimeout } from "../hooks/useIdleTimeout"
import { useGestureControls } from "../hooks/useGestureControls"
import { useWakeWordDetector } from "../hooks/useWakeWordDetector"
import { getVoiceControl } from "../services/voiceControl"
import { setTTSStateChangeCallback } from "../services/voiceFeedback"
import { logger } from "../utils/logger"
import Visualizer from "./Visualizer"
import PlayerLargeControls from "./PlayerLargeControls"
import AIIntegratedStatus from "./AIIntegratedStatus" // imported AI component

interface PlayerProps {
  station: RadioStation | null
  isPlaying: boolean
  onPlay: () => void
  onPause: () => void
  onToggleMute?: () => void
  onExitFullscreen?: () => void
  recentStations?: RadioStation[]
  onNextStation?: () => void
  onPreviousStation?: () => void
  onPlayStation?: (stationName: string) => void
  currentMetadata?: { title: string | null; artist: string | null } | null
  availableStations?: RadioStation[] // List of all available stations for AI
}

export default function Player({
  station,
  isPlaying,
  onPlay,
  onPause,
  onToggleMute,
  onExitFullscreen,
  recentStations = [],
  onNextStation,
  onPreviousStation,
  onPlayStation,
  currentMetadata,
  availableStations = [],
}: PlayerProps) {
  // recentStations is available for future use (e.g., showing next/prev station preview)
  if (false) void recentStations
  const audioRef = useRef<HTMLAudioElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const isInitializingRef = useRef(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [swipeProgress, setSwipeProgress] = useState(0)
  const fullscreenRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)
  const touchStartYRef = useRef<number | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  // Settings
  const { largeControls, visualizerEnabled, audio: audioSettings } = useSettingsStore()

  // Audio pipeline refs
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null)
  const compressorRef = useRef<DynamicsCompressorNode | null>(null)
  const eqFilterRef = useRef<BiquadFilterNode | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  // const previousStationRef = useRef<RadioStation | null>(null); // Removed - was only used by crossfade effect

  // Reconnect state
  const [isOffline, setIsOffline] = useState(false)
  const [reconnectAttempt, setReconnectAttempt] = useState(0)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isReconnectingRef = useRef(false)

  // Idle timeout hook
  const isIdle = useIdleTimeout({
    timeout: 30000, // 30 seconds
    enabled: isPlaying && !!station && !isFullscreen,
  })

  // Track resolved URL for on-demand resolution
  const [resolvedStreamUrl, setResolvedStreamUrl] = useState<string | null>(null);
  
  const [volume, setVolume] = useState(() => {
    try {
      const stored = localStorage.getItem("jamie_radio_volume")
      if (stored) {
        const parsed = Number.parseFloat(stored)
        if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          return parsed
        }
      }
    } catch (err) {
      console.error("Failed to load volume preference:", err)
    }
    return 1
  })
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isMuted, setIsMuted] = useState(false)

  // Fetch metadata for current station
  const {
    data: metadata,
    loading: metadataLoading,
    error: metadataError,
  } = useStationMetadata(station?.id || null, station?.name || null)

  // Calculate logo URL using backend API
  const logoSrc = useMemo(() => {
    if (!station) return null
    const params = new URLSearchParams()
    if (station.homepage) params.set("url", station.homepage)
    if (station.favicon) params.set("fallback", station.favicon)
    if (station.id) params.set("stationId", station.id)
    if (station.domain) params.set("discoveryId", station.domain)
    if (station.name) params.set("stationName", station.name)
    return `/api/logo?${params.toString()}`
  }, [station]) // <-- Updated dependency array

  // Station and metadata tracking (no debug logs)

  // Haptic feedback helper
  const triggerHaptic = () => {
    if (navigator.vibrate) {
      navigator.vibrate(10)
    }
  }

  // Offline detection
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false)
      if (isPlaying && station && error) {
        // Auto-retry when connection returns
        setReconnectAttempt(0)
        isReconnectingRef.current = false
      }
    }
    const handleOffline = () => {
      setIsOffline(true)
    }

    setIsOffline(!navigator.onLine)
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [isPlaying, station, error])

  // Audio pipeline setup with Web Audio API
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) {
      console.log("[Player] Audio pipeline setup: audio element not available yet")
      return
    }
    console.log("[Player] Audio pipeline setup: audio element available, creating gain node")

    // Create AudioContext (singleton)
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    }

    const audioContext = audioContextRef.current
    
    // CRITICAL: Resume AudioContext if suspended (fixes muffled audio on first load)
    if (audioContext.state === "suspended") {
      audioContext.resume().then(() => {
        console.log("[Player] AudioContext resumed from suspended state")
      }).catch((err) => {
        console.error("[Player] Failed to resume AudioContext:", err)
      })
    }

    // Create source node from audio element
    if (!sourceNodeRef.current) {
      sourceNodeRef.current = audioContext.createMediaElementSource(audio)
    }

    // Create compressor for normalization
    if (!compressorRef.current) {
      compressorRef.current = audioContext.createDynamicsCompressor()
      compressorRef.current.threshold.value = -24
      compressorRef.current.knee.value = 30
      compressorRef.current.ratio.value = 12
      compressorRef.current.attack.value = 0.003
      compressorRef.current.release.value = 0.25
    }

    // Create EQ filter
    if (!eqFilterRef.current) {
      eqFilterRef.current = audioContext.createBiquadFilter()
      // CRITICAL: Initialize with flat EQ to prevent muffled audio on first load
      // Default BiquadFilter type is "lowpass" which causes muffled sound
      eqFilterRef.current.type = "allpass" // Flat response - no filtering
      eqFilterRef.current.gain.value = 0
      eqFilterRef.current.frequency.value = 3500 // Default frequency
      eqFilterRef.current.Q.value = 1
      console.log("[Player] EQ filter created and initialized with flat settings")
    }

    // Create gain node for crossfade and volume
    if (!gainNodeRef.current) {
      gainNodeRef.current = audioContext.createGain()
      // CRITICAL: Set immediate value on creation.
      // Do not rely on the other effect for the very first split-second.
      gainNodeRef.current.gain.value = isMuted ? 0 : volume
      console.log("[Player] Gain node created, initial volume:", gainNodeRef.current.gain.value)
    }

    // CRITICAL FIX: Ensure the HTML element source is at 100%
    // The Web Audio API GainNode will handle the actual volume scaling.
    // If this is < 1, you are amplifying a quiet signal or playing silence.
    audio.volume = 1.0

    // Connect audio pipeline: source → compressor → EQ → gain → destination
    const source = sourceNodeRef.current
    const compressor = compressorRef.current
    const eq = eqFilterRef.current
    const gain = gainNodeRef.current

    // Disconnect existing connections
    source.disconnect()
    compressor.disconnect()
    eq.disconnect()
    gain.disconnect()

    // Reconnect based on settings
    if (audioSettings.normalizationEnabled) {
      source.connect(compressor)
      compressor.connect(eq)
    } else {
      source.connect(eq)
    }
    eq.connect(gain)
    gain.connect(audioContext.destination)

    // Apply EQ preset
    const applyEqPreset = (preset: typeof audioSettings.eqPreset) => {
      if (!eq) return

      switch (preset) {
        case "bass":
          eq.type = "lowshelf"
          eq.frequency.value = 250
          eq.gain.value = 8
          eq.Q.value = 1
          break
        case "treble":
          eq.type = "highshelf"
          eq.frequency.value = 4000
          eq.gain.value = 8
          eq.Q.value = 1
          break
        case "voice":
          eq.type = "peaking"
          eq.frequency.value = 2000
          eq.gain.value = 6
          eq.Q.value = 1
          break
        case "flat":
        default:
          // Use allpass type for truly flat response (no filtering)
          eq.type = "allpass"
          eq.frequency.value = 3500
          eq.gain.value = 0
          eq.Q.value = 1
          break
      }
      console.log("[Player] EQ preset applied:", preset, "type:", eq.type, "gain:", eq.gain.value)
    }

    // Always apply EQ preset to ensure proper initialization
    applyEqPreset(audioSettings.eqPreset)
    compressor.threshold.value = audioSettings.normalizationEnabled ? -24 : 0

    return () => {
      // Cleanup handled by component unmount
    }
    // REMOVED volume and isMuted from dependencies to prevent overrides
  }, [audioSettings.eqPreset, audioSettings.normalizationEnabled, station])

  // TTS volume ducking state
  const [isTTSSpeaking, setIsTTSSpeaking] = useState(false)
  const originalVolumeRef = useRef(volume)

  // Debounce wake word detections to prevent multiple recordings
  const lastDetectionTimeRef = useRef<number>(0)
  const DEBOUNCE_MS = 2000 // 2 seconds between detections
  const hasInitContinuousRef = useRef(false)
  const getDetectorRef = useRef<(() => any) | null>(null)

  // Memoize the detection callback to prevent detector recreation
  const handleWakeWordDetection = useCallback((detection: any) => {
    const now = Date.now()
    const timeSinceLastDetection = now - lastDetectionTimeRef.current

    // Debounce: ignore detections within 2 seconds of each other
    if (timeSinceLastDetection < DEBOUNCE_MS) {
      logger.log('WakeWord', `Detection ignored (debounced, ${timeSinceLastDetection}ms since last)`)
      return
    }

    lastDetectionTimeRef.current = now
    logger.log('WakeWord', 'Detection triggered:', detection)

    // Wake word detected - trigger command recording
    const voiceControl = getVoiceControl()
    if (voiceControl.isSupported()) {
      logger.log('WakeWord', 'Starting command recording')
      // Get the shared stream from wake word detector if available
      const getDetector = getDetectorRef.current
      const wakeWordDetector = getDetector?.() || null
      let sharedStream = wakeWordDetector?.getMediaStream() || null
      
      // If stream is not available but detector exists, try to get it from the detector's internal state
      // This is a fallback in case getMediaStream() has issues
      if (!sharedStream && wakeWordDetector) {
        logger.warn('WakeWord', 'getMediaStream() returned null, attempting fallback initialization')
        // Try to initialize continuous recording on-demand if not already done
        if (!hasInitContinuousRef.current) {
          // Retry getting the stream - sometimes it's available but getMediaStream() fails
          const retryStream = wakeWordDetector.getMediaStream()
          if (retryStream) {
            sharedStream = retryStream
            logger.log('WakeWord', 'Got stream on retry, initializing continuous recording')
            voiceControl.initializeContinuousRecording(sharedStream).catch((err) => {
              logger.error('WakeWord', 'Failed to init continuous recording on-demand', err)
            })
          }
        }
      }
      
      // Get buffered audio IMMEDIATELY when wake word is detected (before any delays)
      // This captures audio from before the wake word through the gap
      let immediateBufferedAudio: Float32Array[] | undefined = undefined
      if (wakeWordDetector) {
        immediateBufferedAudio = wakeWordDetector.getBufferedAudio()
        if (immediateBufferedAudio && immediateBufferedAudio.length > 0) {
          const totalSamples = immediateBufferedAudio.reduce((sum: number, chunk: Float32Array) => sum + chunk.length, 0)
          const durationMs = (totalSamples / 16000) * 1000
          logger.log('WakeWord', `Got immediate buffered audio: ${immediateBufferedAudio.length} chunks (${totalSamples} samples, ~${durationMs.toFixed(0)}ms)`)
        }
      }
      
      // Set up callback to get UPDATED buffered audio right before streaming starts
      // This captures any additional audio during the gap between wake word detection and stream start
      if (wakeWordDetector) {
        voiceControl.setBufferedAudioCallback(() => {
          // Get latest buffered audio (includes gap audio accumulated since wake word detection)
          const latestBufferedAudio = wakeWordDetector.getBufferedAudio()
          if (latestBufferedAudio && latestBufferedAudio.length > 0) {
            const totalSamples = latestBufferedAudio.reduce((sum: number, chunk: Float32Array) => sum + chunk.length, 0)
            const durationMs = (totalSamples / 16000) * 1000
            logger.log('WakeWord', `Callback: Got updated buffered audio: ${latestBufferedAudio.length} chunks (${totalSamples} samples, ~${durationMs.toFixed(0)}ms)`)
            
            // NOW pause wakeword (right before streaming starts, so no gap)
            wakeWordDetector.pause()
            logger.log('WakeWord', 'Paused chunk sending right before streaming starts')
            
            // Clear the buffer after we've captured it
            wakeWordDetector.clearBuffer()
            logger.log('WakeWord', 'Cleared audio buffer after capturing for command recording')
            
            return latestBufferedAudio
          }
          // Fallback to immediate buffered audio if callback buffer is empty
          return immediateBufferedAudio || []
        })
      }
      
      // Also pass immediate buffered audio to startCommandRecording as initial buffer
      // This ensures we have at least the pre-wake-word audio even if callback fails
      
      // Start command recording (this sets up the stream and will call startAudioStreaming when ready)
      // Pass immediate buffered audio as initial buffer (will be updated by callback with gap audio)
      voiceControl.startCommandRecording(sharedStream || undefined, immediateBufferedAudio).catch((err) => {
        logger.error('WakeWord', 'Command recording failed', err)
        // Resume on error too
        if (wakeWordDetector) {
          wakeWordDetector.resume()
          logger.log('WakeWord', 'Resumed chunk sending after command recording error')
        }
      })
    }
  }, []) // Empty deps - uses refs and stable functions only

  // Wake word detection via WebSocket API
  const {
    getDetector,
    isListening: isWakeWordListening,
  } = useWakeWordDetector({
    wsUrl: import.meta.env.VITE_WAKE_WORD_WS_URL || "ws://localhost:8000/ws",
    onDetection: handleWakeWordDetection,
    enabled: true, // Auto-start
  })

  // Store getDetector in ref so callback can access it
  getDetectorRef.current = getDetector

  // Initialize continuous recording using WakeWord stream
  // Wait for detector to be listening (which means it has a stream)
  // Use polling to retry if stream isn't immediately available
  useEffect(() => {
    if (hasInitContinuousRef.current) return
    if (!isWakeWordListening) return // Wait for detector to start

    const vc = getVoiceControl()
    if (!vc.isSupported()) return

    const tryInit = () => {
      const detector = getDetector()
      if (!detector) {
        logger.warn("Player", "Detector not available yet")
        return false
      }

      const sharedStream = detector.getMediaStream()
      logger.log("Player", "Checking for shared stream", {
        hasDetector: !!detector,
        hasStream: !!sharedStream,
        streamActive: sharedStream?.active,
        streamTracks: sharedStream?.getTracks().length || 0,
      })

      if (sharedStream) {
        // Verify stream has tracks before using it
        const tracks = sharedStream.getAudioTracks()
        if (tracks.length === 0) {
          logger.warn("Player", "Shared stream has no audio tracks yet, will retry")
          return false
        }
        
        // Check if at least one track is live or ready
        const hasActiveTrack = tracks.some(t => t.readyState === 'live' || t.readyState === 'ended')
        if (!hasActiveTrack) {
          logger.warn("Player", "Shared stream tracks not ready yet, will retry", {
            trackStates: tracks.map(t => ({ enabled: t.enabled, readyState: t.readyState }))
          })
          return false
        }
        
        hasInitContinuousRef.current = true
        logger.log("Player", "Initializing continuous recording with shared WakeWord stream", {
          trackCount: tracks.length,
          activeTracks: tracks.filter(t => t.readyState === 'live').length
        })
        vc.initializeContinuousRecording(sharedStream).catch((err) => {
          hasInitContinuousRef.current = false
          logger.error("Player", "Failed to init continuous recording with shared stream", err)
        })
        return true
      }
      return false
    }

    // Try immediately
    if (tryInit()) return

    // If not available, retry with polling (stream might not be ready yet)
    logger.log("Player", "Stream not immediately available, will retry")
    const retryInterval = setInterval(() => {
      if (hasInitContinuousRef.current) {
        clearInterval(retryInterval)
        return
      }
      if (tryInit()) {
        clearInterval(retryInterval)
      }
    }, 500) // Retry every 500ms

    // Stop retrying after 10 seconds
    const timeout = setTimeout(() => {
      clearInterval(retryInterval)
      if (!hasInitContinuousRef.current) {
        logger.error("Player", "Failed to initialize continuous recording after 10 seconds")
      }
    }, 10000)

    return () => {
      clearInterval(retryInterval)
      clearTimeout(timeout)
    }
  }, [getDetector, isWakeWordListening])

  // Set up TTS state change callback for volume ducking
  // Must be after getDetector is defined
  useEffect(() => {
    console.log("[Player] Setting up TTS state change callback, current volume:", volume)
    const callback = (isSpeaking: boolean) => {
      console.log("[Player] TTS state change callback called:", isSpeaking, "current isTTSSpeaking:", isTTSSpeaking)
      setIsTTSSpeaking(isSpeaking)
      if (isSpeaking) {
        // Store original volume before ducking
        originalVolumeRef.current = volume
        console.log("[Player] TTS started, storing original volume:", volume, "will duck to:", volume * 0.2)
      } else {
        console.log("[Player] TTS ended, will restore volume to:", originalVolumeRef.current)
      }
    }
    
    const ttsCallback = (isSpeaking: boolean) => {
      callback(isSpeaking)
      // Resume wakeword when TTS finishes (after command handling completes)
      if (!isSpeaking) {
        const detector = getDetector()
        detector?.resume()
      }
    }
    
    // Set callback in voiceFeedback.ts (for HTTP TTS fallback and playAudioFromBase64)
    setTTSStateChangeCallback(ttsCallback)
    
    // Also set callback in murfWebSocketTTS.ts (for WebSocket TTS used by voiceControl)
    // This ensures ducking works when voiceControl calls speakWithWebSocket directly
    // Note: Dynamic import to avoid circular dependencies, but set immediately
    import('../services/murfWebSocketTTS').then(({ setTTSStateChangeCallback: setMurfCallback }) => {
      setMurfCallback(ttsCallback)
      console.log("[Player] Murf WS TTS callback registered")
    }).catch((err) => {
      console.warn("[Player] Failed to set Murf WS callback:", err)
    })
    
    console.log("[Player] TTS callback registered")
  }, [volume, isTTSSpeaking, getDetector])

  // Update gain node volume with TTS ducking
  // This is the SINGLE SOURCE OF TRUTH for volume control
  useEffect(() => {
    const applyDucking = () => {
      const gainNode = gainNodeRef.current
      const audioContext = audioContextRef.current

      if (!gainNode || !audioContext) {
        return false
      }

      // Check for suspended state - frequent cause of "no sound"
      if (audioContext.state === "suspended") {
        audioContext.resume().then(() => {
          console.log("[Player] AudioContext resumed")
        })
      }

      const currentTime = audioContext.currentTime

      // Cancel any scheduled changes to take immediate control
      gainNode.gain.cancelScheduledValues(currentTime)

      if (isMuted) {
        gainNode.gain.setValueAtTime(0, currentTime)
        console.log("[Player] Muted (immediate)")
      } else if (isTTSSpeaking) {
        // Duck: Smooth fade down to 20%
        gainNode.gain.setTargetAtTime(volume * 0.2, currentTime, 0.1)
        console.log("[Player] Ducking started")
      } else {
        // Restore: Use linear ramp or set value immediately.
        // setTargetAtTime can get stuck if the current value is 0.
        // We use setValueAtTime to ensure it snaps to the correct volume instantly
        // which fixes the "silence on load" bug.
        gainNode.gain.setValueAtTime(volume, currentTime)
        console.log("[Player] RESTORED volume to:", volume)
      }
      return true
    }

    // Retry logic if gain node isn't ready
    if (!gainNodeRef.current) {
      const retryId = setInterval(() => {
        if (gainNodeRef.current) {
          clearInterval(retryId)
          applyDucking()
        }
      }, 100) // Increased to 100ms to reduce CPU thrashing
      return () => clearInterval(retryId)
    }

    applyDucking()
  }, [volume, isMuted, isTTSSpeaking, station])

  // Crossfade when changing stations
  // REMOVED: This effect was conflicting with the Volume/Ducking effect.
  // The crossfade was ramping volume to 0 when changing stations, which was
  // overriding the ducking effect and causing "no sound" issues.
  // Crossfade functionality can be re-implemented later if needed, but it must
  // coordinate with the ducking effect to avoid conflicts.
  /*
  useEffect(() => {
    if (!gainNodeRef.current || !station) return;
    
    const gain = gainNodeRef.current;
    const previousStation = previousStationRef.current;
    
    // Only crossfade if we're switching stations (not initial load)
    if (previousStation && previousStation.stationuuid !== station.stationuuid && isPlaying) {
      const fadeDuration = 0.3; // 300ms
      const currentTime = audioContextRef.current?.currentTime || 0;
      
      // Fade out
      gain.gain.cancelScheduledValues(currentTime);
      gain.gain.setValueAtTime(volume, currentTime);
      gain.gain.linearRampToValueAtTime(0, currentTime + fadeDuration);
      
      // Fade in after a short delay
      setTimeout(() => {
        if (gainNodeRef.current && audioContextRef.current) {
          const newTime = audioContextRef.current.currentTime;
          gainNodeRef.current.gain.cancelScheduledValues(newTime);
          gainNodeRef.current.gain.setValueAtTime(0, newTime);
          gainNodeRef.current.gain.linearRampToValueAtTime(isMuted ? 0 : volume, newTime + fadeDuration);
        }
      }, fadeDuration * 1000);
    }
    
    previousStationRef.current = station;
  }, [station?.stationuuid, isPlaying, volume, isMuted]);
  */

  // Handle Audio Events
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleError = (e: Event) => {
      const audio = e.target as HTMLAudioElement
      const error = audio.error
      const errorDetails = {
        code: error?.code,
        message: error?.message,
        networkState: audio.networkState,
        readyState: audio.readyState,
        src: audio.src,
        paused: audio.paused,
        errorName: error
          ? error.code === MediaError.MEDIA_ERR_ABORTED
            ? "MEDIA_ERR_ABORTED"
            : error.code === MediaError.MEDIA_ERR_NETWORK
              ? "MEDIA_ERR_NETWORK"
              : error.code === MediaError.MEDIA_ERR_DECODE
                ? "MEDIA_ERR_DECODE"
                : error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
                  ? "MEDIA_ERR_SRC_NOT_SUPPORTED"
                  : "UNKNOWN"
          : "NO_ERROR",
      }
      // Audio error event (only log fatal errors)

      // Only pause on fatal errors (network errors, decode errors)
      // Don't pause on MEDIA_ERR_ABORTED (user cancelled) or during initialization
      if (isInitializingRef.current) {
        // Ignoring error during initialization
        return
      }

      if (error && (error.code === MediaError.MEDIA_ERR_NETWORK || error.code === MediaError.MEDIA_ERR_DECODE)) {
        // Fatal error - attempt reconnect with exponential backoff
        if (!isReconnectingRef.current && isPlaying) {
          isReconnectingRef.current = true
          attemptReconnect()
        } else {
          setError(`Stream unavailable (${errorDetails.errorName})`)
          setIsLoading(false)
          if (!isInitializingRef.current) {
            onPause()
          }
        }
      } else if (error && error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        // Format not supported - pausing
        setError("Stream format not supported")
        setIsLoading(false)
        if (!isInitializingRef.current) {
          onPause()
        }
      } else {
        // For other errors, just show error but don't pause (might recover)
        // Non-fatal error - not pausing
        setError(`Stream issue (${errorDetails.errorName}) - retrying...`)
        setIsLoading(false)
      }
    }
    const handleLoadStart = () => {
      setIsLoading(true)
      setError(null)
    }
    const handleCanPlay = () => {
      // Audio can play
      setIsLoading(false)
      setError(null)
    }
    const handlePlaying = () => {
      // Audio is playing
      setIsLoading(false)
      setError(null)
      isInitializingRef.current = false // Clear init flag when actually playing
    }
    const handlePause = () => {
      // Audio paused event
      // Don't call onPause here - let the parent control it
    }
    const handleStalled = () => {
      // Audio stalled
    }
    const handleSuspend = () => {
      // Audio suspended
    }

    audio.addEventListener("error", handleError)
    audio.addEventListener("loadstart", handleLoadStart)
    audio.addEventListener("canplay", handleCanPlay)
    audio.addEventListener("playing", handlePlaying)
    audio.addEventListener("pause", handlePause)
    audio.addEventListener("stalled", handleStalled)
    audio.addEventListener("suspend", handleSuspend)

    return () => {
      audio.removeEventListener("error", handleError)
      audio.removeEventListener("loadstart", handleLoadStart)
      audio.removeEventListener("canplay", handleCanPlay)
      audio.removeEventListener("playing", handlePlaying)
      audio.removeEventListener("pause", handlePause)
      audio.removeEventListener("stalled", handleStalled)
      audio.removeEventListener("suspend", handleSuspend)
    }
  }, [onPause])

  // Clear resolved URL when station changes
  useEffect(() => {
    setResolvedStreamUrl(null);
  }, [station?.stationuuid]);

  // Handle Stream Loading
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !station) return

    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    if (isPlaying) {
      // Use resolved URL from state if available, otherwise use station URL
      let streamUrl = resolvedStreamUrl || station.url_resolved || station.url
      if (!streamUrl) {
        // Try to resolve URL on-demand if missing
        logger.log('Player', `No URL for ${station.name}, attempting to resolve...`);
        (async () => {
          try {
            // Import dynamically to avoid circular dependencies
            const { streamUrlManager } = await import('../services/streamManager');
            const { getStationByName } = await import('../config/stations');
            
            const metadata = getStationByName(station.name);
            if (metadata) {
              const result = await streamUrlManager.getStreamUrl(metadata);
              if (result && result.url) {
                logger.log('Player', `Resolved URL for ${station.name}: ${result.url.substring(0, 50)}...`);
                // Update state to trigger re-render and re-run of this effect
                setResolvedStreamUrl(result.url);
                return;
              }
            }
          } catch (error) {
            logger.warn('Player', `Failed to resolve URL for ${station.name}:`, error);
          }
          
          setError("No URL")
          setIsLoading(false)
          onPause()
        })();
        return
      }

      // Universal HTTPS upgrade for mixed content compliance
      // Upgrade ALL HTTP URLs to HTTPS (safety net)
      if (streamUrl.startsWith("http://")) {
        // Global Radio: Special handling for media-ssl endpoint
        if (streamUrl.includes("media-the.musicradio.com") || streamUrl.includes("vis.media-ice.musicradio.com")) {
          streamUrl = streamUrl
            .replace(/http:\/\/(media-the|vis\.media-ice)\.musicradio\.com/, "https://media-ssl.musicradio.com")
            .replace(/^http:/, "https:")
        } else {
          // Universal upgrade: ALL HTTP URLs -> HTTPS
          streamUrl = streamUrl.replace(/^http:/, "https:")
        }
      }

      // Mark as initializing to prevent premature pause
      isInitializingRef.current = true
      setError(null)
      setIsLoading(true)
      // Starting stream

      // Clear initialization flag after a delay
      setTimeout(() => {
        isInitializingRef.current = false
      }, 1000)

      const isHls =
        streamUrl.includes(".m3u8") ||
        streamUrl.includes("lsn.lv") ||
        streamUrl.includes("akamaized.net") ||
        station.name.toLowerCase().includes("bbc")

      if (isHls && Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true })
        // CRITICAL FIX: Web Audio API requires CORS to be set for the audio element
        audio.crossOrigin = "anonymous"
        hls.loadSource(streamUrl)
        hls.attachMedia(audio)
        hlsRef.current = hls

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          audio.play().catch((err) => {
            // Don't pause on autoplay policy failures - just log and keep ready
            if (err.name === "NotAllowedError" || err.name === "NotSupportedError") {
              // Autoplay blocked by browser policy
              setError(null) // Clear any previous errors
              setIsLoading(false)
              // Don't call onPause() - keep isPlaying true so user can click to play
            } else {
              // AbortError is expected in React StrictMode (double effect runs)
              // The second attempt will succeed, so we can ignore it
              if (err.name === "AbortError") {
                // HLS play aborted (expected in StrictMode)
                return
              }
              // HLS play failed (silent)
              setError("Playback failed")
              setIsLoading(false)
              if (!isInitializingRef.current) {
                onPause()
              }
            }
          })
        })

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            setError("Stream Error")
            setIsLoading(false)
          }
        })
      } else {
        audio.src = streamUrl
        audio.crossOrigin = "anonymous"
        audio.play().catch((err) => {
          // Don't pause on autoplay policy failures - just log and keep ready
          if (err.name === "NotAllowedError" || err.name === "NotSupportedError") {
            setError(null) // Clear any previous errors
            setIsLoading(false)
            // Don't call onPause() - keep isPlaying true so user can click to play
          } else {
            // AbortError is expected in React StrictMode (double effect runs)
            // The second attempt will succeed, so we can ignore it
            if (err.name === "AbortError") {
              // Play aborted (expected in StrictMode)
              return
            }
            // Audio play failed (silent)
            setError("Playback failed")
            setIsLoading(false)
            if (!isInitializingRef.current) {
              onPause()
            }
          }
        })
      }
    } else {
      // Don't pause if we're in the middle of initializing (prevents React StrictMode double-run issue)
      if (isInitializingRef.current) {
        // Skipping pause - still initializing
        return
      }

      // Only pause if audio is actually playing
      if (!audio.paused || audio.readyState > 0) {
        // Pausing audio
        audio.pause()
        setIsLoading(false)
      } else {
        // Skipping pause - audio not playing yet
      }
    }
  }, [isPlaying, station, onPause, resolvedStreamUrl])

  // Handle Volume - DISABLED when using Web Audio API
  // When using Web Audio API with gain node, the audio element volume should stay at 1.0
  // and the gain node controls the actual output volume
  // useEffect(() => {
  //   const audio = audioRef.current
  //   if (audio) {
  //     audio.volume = isMuted ? 0 : volume
  //   }
  // }, [volume, isMuted])

  // Persist volume to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("jamie_radio_volume", volume.toString())
    } catch (err) {
      console.error("Failed to save volume preference:", err)
    }
  }, [volume])

  // Cleanup reconnect timeout
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [])

  // Helper function to update MediaSession metadata
  const updateMediaSessionMetadata = (
    station: RadioStation | null,
    metadata: { title: string | null; artist: string | null; artwork_url: string | null; is_song: boolean } | null,
    logoSrc: string | null,
  ) => {
    if (!("mediaSession" in navigator) || !station) return

    const mediaSession = navigator.mediaSession
    const artwork: MediaImage[] = []

    // Use artwork proxy for iOS compatibility
    if (metadata?.artwork_url) {
      artwork.push({
        src: `/api/artwork?url=${encodeURIComponent(metadata.artwork_url)}`,
        sizes: "512x512",
        type: "image/png",
      })
    } else if (logoSrc) {
      artwork.push({
        src: logoSrc,
        sizes: "512x512",
        type: "image/png",
      })
    } else {
      // Fallback to app logo
      artwork.push({
        src: "/logo.png",
        sizes: "512x512",
        type: "image/png",
      })
    }

    // Format: <StationName> — Now Playing: <TrackTitle>
    let title: string
    let artist: string

    if (metadata?.is_song && metadata.title) {
      title = `${station.name} — Now Playing: ${metadata.title}`
      artist = metadata.artist || station.name
    } else {
      title = station.name
      artist = "Live Radio"
    }

    mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album: station.name,
      artwork,
    })
  }

  // MediaSession API for iOS metadata support
  useEffect(() => {
    if (!("mediaSession" in navigator)) return

    const mediaSession = navigator.mediaSession

    // Set action handlers (only set once, not on every render)
    mediaSession.setActionHandler("play", () => {
      if (!isPlaying) {
        onPlay()
      }
    })

    mediaSession.setActionHandler("pause", () => {
      if (isPlaying) {
        onPause()
      }
    })

    mediaSession.setActionHandler("stop", () => {
      if (isPlaying) {
        onPause()
      }
    })

    // Disable unused actions for radio context
    mediaSession.setActionHandler("previoustrack", null)
    mediaSession.setActionHandler("nexttrack", null)

    return () => {
      // Cleanup handlers on unmount
      try {
        mediaSession.setActionHandler("play", null)
        mediaSession.setActionHandler("pause", null)
        mediaSession.setActionHandler("stop", null)
      } catch (e) {
        // Ignore errors during cleanup
      }
    }
  }, [isPlaying, onPlay, onPause])

  // Gesture controls for fullscreen
  const fullscreenGestures = useGestureControls({
    onSwipeDown: () => {
      if (isFullscreen && onExitFullscreen && !isTTSSpeaking) {
        setIsFullscreen(false)
        onExitFullscreen()
      }
    },
    onSwipeLeft: () => {
      // Next station - disabled while TTS is speaking
      if (onNextStation && !isTTSSpeaking) {
        onNextStation()
      }
    },
    onSwipeRight: () => {
      // Previous station - disabled while TTS is speaking
      if (onPreviousStation && !isTTSSpeaking) {
        onPreviousStation()
      }
    },
    onTwoFingerTap: () => {
      if (!isTTSSpeaking) {
        setIsMuted(!isMuted)
        if (onToggleMute) {
          onToggleMute()
        }
      }
    },
    isFullscreen,
    enabled: isFullscreen,
  })


  // Voice control with Gemini audio understanding
  useEffect(() => {
    const voiceControl = getVoiceControl()

    if (!voiceControl.isSupported()) {
      return
    }

    // Set station list for AI context
    const stationNames = availableStations.map((s) => s.name)
    voiceControl.setStationList(stationNames)

    // Initialize voice control service (it will be triggered by wake word detection)
    voiceControl.start({
      onCommand: async (command) => {
        console.log("[Player] onCommand callback received:", command)

        // Prevent commands while TTS is speaking
        if (isTTSSpeaking) {
          console.log("[Player] Command ignored - TTS is currently speaking")
          return
        }

        try {
          // Update AI state: before executing → executing
          const { setExecuting } = useAIStore.getState()
          const aiCommand = {
            command: command.type,
            station: command.stationName,
            text: command.type === "play" ? `Playing ${command.stationName}` : undefined,
          }
          setExecuting(aiCommand)

          // Command is already parsed by Gemini from audio
          // Execute the command directly
          switch (command.type) {
            case "play":
              if (command.stationName && onPlayStation) {
                logger.log('Player', `Executing play command for station: "${command.stationName}"`)
                onPlayStation(command.stationName)
                // TTS is already handled by voiceControl.ts, no need to call it again
              } else {
                console.warn(
                  "[Player] Play command received but stationName is missing or onPlayStation is not available",
                )
              }
              break
            case "next":
            case "next_station":
              if (onNextStation) {
                onNextStation()
                // TTS is already handled by voiceControl.ts
              }
              break
            case "previous":
            case "previous_station":
              if (onPreviousStation) {
                onPreviousStation()
                // TTS is already handled by voiceControl.ts
              }
              break
            case "set_volume":
              if (command.level != null) {
                setVolume(command.level / 100)
              }
              // TTS is already handled by voiceControl.ts
              break
            case "volume_up":
              setVolume((v) => Math.min(1, v + 0.1))
              // TTS is already handled by voiceControl.ts
              break
            case "volume_down":
              setVolume((v) => Math.max(0, v - 0.1))
              // TTS is already handled by voiceControl.ts
              break
            case "mute":
              setIsMuted(true)
              // TTS is already handled by voiceControl.ts
              break
            case "unmute":
              setIsMuted(false)
              // TTS is already handled by voiceControl.ts
              break
            case "whats_playing":
              // TTS is already handled by voiceControl.ts
              break
          }
        } catch (error) {
          console.error("Voice command error:", error)
        }
      },
      onError: (error) => {
        console.error("Voice control error:", error)
      },
    })

    return () => {
      voiceControl.stop()
    }
  }, [onNextStation, onPreviousStation, onPlayStation, onToggleMute, currentMetadata, metadata, availableStations])

  // Update MediaSession metadata whenever station, metadata, or artwork changes
  useEffect(() => {
    if (!("mediaSession" in navigator)) return

    updateMediaSessionMetadata(station, metadata, logoSrc)

    // Update playback state
    const mediaSession = navigator.mediaSession
    if (isPlaying) {
      mediaSession.playbackState = "playing"
    } else {
      mediaSession.playbackState = "paused"
    }

    // Clear position state for live radio streams (no progress bar/time indicator)
    // This prevents iOS from showing a song-like progress bar
    try {
      if ("setPositionState" in mediaSession) {
        // Clear position state to indicate it's a live stream
        mediaSession.setPositionState(null as any)
      }
    } catch (e) {
      // Some browsers may not support setPositionState or may throw errors
      // Ignore silently
    }
  }, [station, metadata, logoSrc, isPlaying])

  // Reconnect with exponential backoff
  const attemptReconnect = () => {
    if (!isPlaying || !station || isOffline) return

    const maxAttempts = 5
    if (reconnectAttempt >= maxAttempts) {
      setError("Connection failed after multiple attempts")
      setIsLoading(false)
      isReconnectingRef.current = false
      return
    }

    const backoffDelays = [1000, 2000, 4000, 8000, 10000]
    const delay = backoffDelays[Math.min(reconnectAttempt, backoffDelays.length - 1)]

    setReconnectAttempt((prev) => prev + 1)
    setError(`Reconnecting… (attempt ${reconnectAttempt + 1})`)
    setIsLoading(true)

    reconnectTimeoutRef.current = setTimeout(() => {
      if (isPlaying && station) {
        // Trigger stream reload by updating isPlaying
        const audio = audioRef.current
        if (audio) {
          audio.load()
          audio.play().catch(() => {
            // Retry again if play fails
            if (reconnectAttempt < maxAttempts) {
              attemptReconnect()
            }
          })
        }
      }
    }, delay)
  }

  // Idle detection for auto fullscreen using hook
  useEffect(() => {
    if (isIdle && isPlaying && station && !isFullscreen) {
      setIsFullscreen(true)
    } else if (!isIdle && isFullscreen) {
      // Exit fullscreen on interaction (optional - can be removed if you want manual exit only)
      // setIsFullscreen(false);
    }
  }, [isIdle, isPlaying, station, isFullscreen])

  // Swipe down gesture detection with optimized animation (direct DOM manipulation)
  useEffect(() => {
    // Update header height CSS variable dynamically
    const updateHeaderHeight = () => {
      const header = document.querySelector("header")
      if (header) {
        // Use getBoundingClientRect for accurate height including borders
        const headerHeight = header.getBoundingClientRect().height
        document.documentElement.style.setProperty("--header-height", `${headerHeight}px`)
      }
    }

    // Update immediately and after a short delay to ensure header is fully rendered
    updateHeaderHeight()
    const timeoutId = setTimeout(updateHeaderHeight, 100)

    // Update when fullscreen opens (header might have changed size)
    let fullscreenTimeoutId: NodeJS.Timeout | null = null
    if (isFullscreen) {
      fullscreenTimeoutId = setTimeout(updateHeaderHeight, 50)
    }

    // Also update on window resize (for responsive header changes)
    window.addEventListener("resize", updateHeaderHeight)

    if (!isFullscreen) {
      setSwipeProgress(0)
      // Reset transforms
      if (fullscreenRef.current) {
        fullscreenRef.current.style.transform = "translate3d(0, 0, 0)"
        fullscreenRef.current.style.opacity = ""
        fullscreenRef.current.style.transition = ""
      }
      if (indicatorRef.current) {
        indicatorRef.current.style.opacity = "0"
        indicatorRef.current.style.transition = ""
      }
      return
    }

    const updateTransforms = (progress: number) => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }

      animationFrameRef.current = requestAnimationFrame(() => {
        const container = fullscreenRef.current
        const indicator = indicatorRef.current

        if (container) {
          // Allow pulling down much further - up to 300px
          const translateY = progress * 300
          container.style.transform = `translate3d(0, ${translateY}px, 0)`
          // Smooth opacity fade
          container.style.opacity = String(Math.max(0, 1 - progress * 0.8))
        }

        if (indicator) {
          const indicatorOpacity = Math.min(progress * 2, 1)
          indicator.style.opacity = String(indicatorOpacity)
        }
      })
    }

    const handleTouchStart = (e: TouchEvent) => {
      touchStartYRef.current = e.touches[0].clientY
      updateTransforms(0)
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (touchStartYRef.current === null) return

      const currentY = e.touches[0].clientY
      const deltaY = currentY - touchStartYRef.current

      // Only allow downward swipes and prevent page scroll
      if (deltaY > 0) {
        e.preventDefault() // Prevent page scroll
        // Allow pulling down up to 400px before capping
        const progress = Math.min(deltaY / 400, 1)
        updateTransforms(progress)
        setSwipeProgress(progress) // Only for indicator rotation
      }
    }

    const handleTouchEnd = (e: TouchEvent) => {
      if (touchStartYRef.current === null) return

      const currentY = e.changedTouches[0].clientY
      const deltaY = currentY - touchStartYRef.current

      // If swiped down more than 150px, exit fullscreen
      if (deltaY > 150) {
        // Exit fullscreen smoothly
        setIsFullscreen(false)
        // Unlock body scroll immediately to prevent freeze
        requestAnimationFrame(() => {
          document.body.style.overflow = ""
          document.body.style.position = ""
          document.body.style.width = ""
        })
      } else {
        // Smoothly animate back using CSS transition
        const container = fullscreenRef.current
        const indicator = indicatorRef.current

        if (container) {
          container.style.transition = "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease"
          container.style.transform = "translate3d(0, 0, 0)"
          container.style.opacity = "1"

          // Remove transition after animation completes
          setTimeout(() => {
            if (container) {
              container.style.transition = ""
            }
          }, 250)
        }

        if (indicator) {
          indicator.style.transition = "opacity 0.2s ease"
          indicator.style.opacity = "0"
          setTimeout(() => {
            if (indicator) {
              indicator.style.transition = ""
            }
          }, 200)
        }

        setSwipeProgress(0)
      }

      touchStartYRef.current = null
    }

    // Prevent body scroll when fullscreen
    document.body.style.overflow = "hidden"
    document.body.style.position = "fixed"
    document.body.style.width = "100%"

    const container = fullscreenRef.current
    if (container) {
      // Use passive: false for touchmove so we can preventDefault
      container.addEventListener("touchstart", handleTouchStart, { passive: true })
      container.addEventListener("touchmove", handleTouchMove, { passive: false })
      container.addEventListener("touchend", handleTouchEnd, { passive: true })
    }

    return () => {
      // Restore body scroll
      document.body.style.overflow = ""
      document.body.style.position = ""
      document.body.style.width = ""

      // Cancel any pending animation frames
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }

      // Remove resize listener and clear timeouts
      window.removeEventListener("resize", updateHeaderHeight)
      if (timeoutId) clearTimeout(timeoutId)
      if (fullscreenTimeoutId) clearTimeout(fullscreenTimeoutId)

      if (container) {
        container.removeEventListener("touchstart", handleTouchStart)
        container.removeEventListener("touchmove", handleTouchMove)
        container.removeEventListener("touchend", handleTouchEnd)
      }
    }
  }, [isFullscreen])

  // Don't prevent body scroll - let fullscreen container handle it

  if (!station) return null

  // Large controls mode
  if (largeControls) {
    return (
      <>
        <audio ref={audioRef} />
        <PlayerLargeControls
          station={station}
          isPlaying={isPlaying}
          isLoading={isLoading}
          volume={volume}
          isMuted={isMuted}
          onPlay={() => {
            triggerHaptic()
            onPlay()
          }}
          onPause={() => {
            triggerHaptic()
            onPause()
          }}
          onVolumeChange={(vol) => {
            triggerHaptic()
            setVolume(vol)
            setIsMuted(false)
          }}
          onMuteToggle={() => {
            triggerHaptic()
            setIsMuted(!isMuted)
          }}
        />
        {visualizerEnabled && <Visualizer audioElement={audioRef.current} enabled={visualizerEnabled} />}
        {/* Offline overlay */}
        {isOffline && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[300] flex items-center justify-center">
            <div className="bg-slate-900 rounded-2xl p-6 border border-white/10 text-center">
              <WifiOff size={48} className="text-red-400 mx-auto mb-4" />
              <h3 className="text-white text-xl font-bold mb-2">Offline Mode</h3>
              <p className="text-white/60">Please check your internet connection</p>
            </div>
          </div>
        )}
      </>
    )
  }

  // Removed unused handleAITrigger function

  return (
    <>
      <audio ref={audioRef} />
      <AnimatePresence>
        {/* Regular Player */}
        {!isFullscreen && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-6 left-4 right-4 md:left-8 md:right-8 z-50"
            onClick={() => setIsFullscreen(true)}
            style={{ cursor: "pointer" }}
          >
            {/* Floating Player Container */}
            <div className="relative bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
              {/* Blurred Background Artwork */}
              {metadata?.artwork_url && (
                <div
                  className="absolute inset-0 opacity-20"
                  style={{
                    backgroundImage: `url(/api/artwork?url=${encodeURIComponent(metadata.artwork_url)})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    filter: "blur(40px)",
                    transform: "scale(1.1)",
                  }}
                />
              )}
              {/* Progress Bar (Visual only for live radio) */}
              <div className="h-1 w-full bg-white/5">
                <motion.div
                  className="h-full bg-gradient-to-r from-purple-500 to-blue-500"
                  animate={{
                    opacity: [0.5, 1, 0.5],
                    width: isPlaying ? "100%" : "0%",
                  }}
                  transition={{
                    opacity: { duration: 2, repeat: Number.POSITIVE_INFINITY },
                    width: { duration: 0.5 },
                  }}
                />
              </div>

              <div className="relative p-4 md:p-6 flex items-center gap-4 md:gap-8">
                {/* Station Info & Art */}
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="relative group">
                    {/* Show artwork_url if available (album art), otherwise use backend logo API */}
                    {metadata?.artwork_url ? (
                      <img
                        src={`/api/artwork?url=${encodeURIComponent(metadata.artwork_url)}`}
                        alt={metadata.title || station.name}
                        className="w-16 h-16 md:w-20 md:h-20 rounded-2xl object-cover shadow-lg bg-slate-800"
                        onError={(e) => {
                          // Fallback to backend logo API if artwork fails
                          const target = e.target as HTMLImageElement
                          if (logoSrc) {
                            target.src = logoSrc
                          }
                        }}
                      />
                    ) : logoSrc ? (
                      <img
                        src={logoSrc || "/placeholder.svg"}
                        alt={station.name}
                        className="w-16 h-16 md:w-20 md:h-20 rounded-2xl object-cover shadow-lg bg-slate-800"
                        onError={(e) => {
                          // If logo API fails, show placeholder
                          const target = e.target as HTMLImageElement
                          target.style.display = "none"
                        }}
                      />
                    ) : (
                      <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg">
                        {station.name.charAt(0)}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Now Playing Metadata */}
                    {metadataError && (
                      <div className="mb-1">
                        <div className="text-red-400/80 text-xs md:text-sm">
                          {metadataError.message.includes("404") || metadataError.message.includes("Failed to fetch")
                            ? 'API not available - use "vercel dev" or deploy to Vercel'
                            : `Metadata error: ${metadataError.message}`}
                        </div>
                      </div>
                    )}
                    {!metadataError && metadata && (metadata.title || metadata.artist) && metadata.is_song ? (
                      <div className="mb-1">
                        <div className="text-white font-semibold text-sm md:text-base truncate">
                          {metadata.title || "Unknown Title"}
                        </div>
                        <div className="text-white/70 text-xs md:text-sm truncate">
                          {metadata.artist || "Unknown Artist"}
                        </div>
                      </div>
                    ) : !metadataError && metadata && !metadata.is_song ? (
                      <div className="mb-1">
                        <div className="text-white/80 font-medium text-sm md:text-base">Live Radio</div>
                      </div>
                    ) : !metadataError && metadataLoading ? (
                      <div className="mb-1">
                        <div className="text-white/60 text-xs md:text-sm animate-pulse">Loading metadata...</div>
                      </div>
                    ) : (
                      !station?.id && (
                        <div className="mb-1">
                          <div className="text-yellow-400/80 text-xs md:text-sm">Station ID not available</div>
                        </div>
                      )
                    )}

                    <h3 className="text-white font-bold text-lg md:text-xl truncate leading-tight">{station.name}</h3>
                    <div className="flex items-center gap-2 text-white/60 text-sm md:text-base mt-1">
                      <span className="truncate">{station.state || station.country}</span>
                      <span className="w-1 h-1 rounded-full bg-white/40" />
                      <span className="font-mono text-xs bg-white/10 px-1.5 py-0.5 rounded">{station.bitrate}k</span>
                    </div>
                    {error ? (
                      <div className="flex items-center gap-1.5 text-red-400 text-sm mt-1 animate-pulse">
                        <AlertCircle size={14} />
                        <span>{error}</span>
                      </div>
                    ) : isLoading ? (
                      reconnectAttempt > 0 ? (
                        <div className="flex items-center gap-1.5 text-purple-300 text-sm mt-1">
                          <Loader2 size={14} className="animate-spin" />
                          <span>Reconnecting… (attempt {reconnectAttempt})</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-purple-300 text-sm mt-1">
                          <Loader2 size={14} className="animate-spin" />
                          <span>Connecting...</span>
                        </div>
                      )
                    ) : null}
                  </div>
                </div>

                {/* Main Controls */}
                <div className="flex items-center gap-4 md:gap-6">
                  <div onClick={(e) => e.stopPropagation()}>
                    <AIIntegratedStatus variant="compact" />
                  </div>

                  {/* Volume - Hidden on small mobile, visible on tablet/desktop */}
                  <div
                    className="hidden md:flex items-center gap-3 bg-white/5 rounded-full px-4 py-2 border border-white/5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        triggerHaptic()
                        setIsMuted(!isMuted)
                      }}
                      className="text-white/70 hover:text-white transition-colors"
                    >
                      {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={isMuted ? 0 : volume}
                      onChange={(e) => {
                        triggerHaptic()
                        setVolume(Number.parseFloat(e.target.value))
                        setIsMuted(false)
                      }}
                      className="w-24 h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-purple-500 hover:accent-purple-400"
                    />
                  </div>

                  {/* Play/Pause Button */}
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={async (e) => {
                      e.stopPropagation()
                      triggerHaptic()

                      // Resume AudioContext if suspended (common browser policy fix)
                      if (audioContextRef.current && audioContextRef.current.state === "suspended") {
                        try {
                          await audioContextRef.current.resume()
                        } catch (err) {
                          console.error("Failed to resume AudioContext:", err)
                        }
                      }

                      // iOS autoplay unlock - ensure audio context is ready
                      const audio = audioRef.current
                      if (audio && audio.paused) {
                        try {
                          await audio.play()
                          audio.pause()
                        } catch {
                          // Ignore autoplay errors
                        }
                      }

                      if (isPlaying) {
                        onPause()
                      } else {
                        onPlay()
                      }
                    }}
                    className={`
                  w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center shadow-xl transition-all
                  ${
                    isPlaying
                      ? "bg-white text-slate-900 hover:bg-gray-100"
                      : "bg-gradient-to-br from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500"
                  }
                `}
                  >
                    {isLoading ? (
                      <Loader2 size={32} className="animate-spin" />
                    ) : isPlaying ? (
                      <Pause size={32} fill="currentColor" />
                    ) : (
                      <Play size={32} fill="currentColor" className="ml-2" />
                    )}
                  </motion.button>
                </div>
              </div>
            </div>
            {/* Visualizer */}
            {visualizerEnabled && <Visualizer audioElement={audioRef.current} enabled={visualizerEnabled} />}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fullscreen Player */}
      <AnimatePresence>
        {isFullscreen && (
          <motion.div
            ref={(el) => {
              fullscreenRef.current = el
              fullscreenGestures.setContainerRef(el)
            }}
            initial={{ opacity: 0 }}
            animate={{
              opacity: 1,
              transition: {
                duration: 0.3,
                ease: [0.4, 0, 0.2, 1],
              },
            }}
            exit={{
              opacity: 0,
              y: 300,
              scale: 0.95,
              transition: {
                duration: 0.3,
                ease: [0.4, 0, 0.2, 1],
              },
            }}
            className="fixed top-0 left-0 right-0 bottom-0 z-[50] bg-slate-950"
            style={{
              touchAction: "pan-y",
              overscrollBehavior: "none",
              willChange: "transform",
              transform: "translate3d(0, 0, 0)",
              paddingTop: "var(--header-height, 88px)",
            }}
            onAnimationComplete={() => {
              // Ensure body scroll is unlocked after exit animation
              document.body.style.overflow = ""
              document.body.style.position = ""
              document.body.style.width = ""
            }}
            onClick={(e) => {
              // Only close if clicking the background, not the content
              if (e.target === e.currentTarget) {
                setIsFullscreen(false)
              }
            }}
          >
            {/* Animated Background Effects - Optimized for Mobile */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {/* Blurred Artwork Background */}
              {metadata?.artwork_url && (
                <div
                  className="absolute inset-0 opacity-10"
                  style={{
                    backgroundImage: `url(/api/artwork?url=${encodeURIComponent(metadata.artwork_url)})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    filter: "blur(60px)",
                    transform: "scale(1.2)",
                    willChange: "transform",
                  }}
                />
              )}

              {/* Simplified Gradient Orbs - CSS animations for better performance */}
              <div
                className="absolute top-1/4 left-1/4 w-64 h-64 md:w-96 md:h-96 bg-purple-600/20 rounded-full blur-3xl"
                style={{
                  animation: "float1 20s ease-in-out infinite",
                  willChange: "transform",
                }}
              />
              <div
                className="absolute bottom-1/4 right-1/4 w-64 h-64 md:w-96 md:h-96 bg-blue-600/20 rounded-full blur-3xl"
                style={{
                  animation: "float2 25s ease-in-out infinite",
                  willChange: "transform",
                }}
              />

              {/* Reduced Particles - Only on larger screens (hidden on mobile) */}
              <div className="hidden md:block">
                {[...Array(5)].map((_, i) => {
                  const randomX = Math.random() * 100
                  const randomY = Math.random() * 100
                  const randomDelay = Math.random() * 2
                  const randomDuration = 10 + Math.random() * 10
                  return (
                    <motion.div
                      key={i}
                      className="absolute w-1.5 h-1.5 bg-white/15 rounded-full"
                      style={{
                        left: `${randomX}%`,
                        top: `${randomY}%`,
                        willChange: "transform, opacity",
                      }}
                      animate={{
                        y: [0, (Math.random() - 0.5) * 150, 0],
                        x: [0, (Math.random() - 0.5) * 150, 0],
                        opacity: [0.1, 0.3, 0.1],
                      }}
                      transition={{
                        duration: randomDuration,
                        delay: randomDelay,
                        repeat: Number.POSITIVE_INFINITY,
                        ease: "easeInOut",
                      }}
                    />
                  )
                })}
              </div>
            </div>

            {/* CSS Keyframes for orb animations */}
            <style>{`
              @keyframes float1 {
                0%, 100% { transform: translate(0, 0) scale(1); }
                50% { transform: translate(50px, -25px) scale(1.1); }
              }
              @keyframes float2 {
                0%, 100% { transform: translate(0, 0) scale(1); }
                50% { transform: translate(-50px, 25px) scale(1.1); }
              }
            `}</style>

            {/* Swipe Indicator */}
            <div
              ref={indicatorRef}
              className="fixed top-[100px] left-1/2 -translate-x-1/2 z-[101] pointer-events-none"
              style={{ opacity: 0 }}
            >
              <div className="flex items-center gap-2 text-white/60 text-sm">
                <div
                  style={{
                    transform: `rotate(${swipeProgress * 180}deg)`,
                    willChange: "transform",
                  }}
                >
                  ↓
                </div>
                <span>Release to exit</span>
              </div>
            </div>

            <div className="absolute top-6 right-6 z-50">
              <AIIntegratedStatus variant="pill" />
            </div>

            {/* Fullscreen Content - Compact to fit on screen */}
            <motion.div
              className="flex flex-col items-center p-4 md:p-6 relative z-10"
              style={{
                minHeight: "calc(100vh - var(--header-height, 88px))",
                paddingTop: "1.5rem",
                paddingBottom: "2rem",
                justifyContent: "flex-start",
                overflowY: "auto",
              }}
              initial={{ opacity: 0, y: 30 }}
              animate={{
                opacity: 1,
                y: 0,
                transition: {
                  delay: 0.1,
                  duration: 0.4,
                  ease: [0.4, 0, 0.2, 1],
                },
              }}
            >
              {/* Artwork - Smaller */}
              <motion.div
                className="mb-3 md:mb-4"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{
                  opacity: 1,
                  scale: 1,
                  transition: {
                    delay: 0.2,
                    duration: 0.5,
                    ease: [0.34, 1.56, 0.64, 1],
                  },
                }}
              >
                {metadata?.artwork_url ? (
                  <img
                    src={`/api/artwork?url=${encodeURIComponent(metadata.artwork_url)}`}
                    alt={metadata.title || station.name}
                    className="w-40 h-40 md:w-56 md:h-56 rounded-2xl object-cover shadow-2xl bg-slate-800"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      if (logoSrc) {
                        target.src = logoSrc
                      }
                    }}
                  />
                ) : logoSrc ? (
                  <img
                    src={logoSrc || "/placeholder.svg"}
                    alt={station.name}
                    className="w-40 h-40 md:w-56 md:h-56 rounded-2xl object-cover shadow-2xl bg-slate-800"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.style.display = "none"
                    }}
                  />
                ) : (
                  <div className="w-40 h-40 md:w-56 md:h-56 rounded-2xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center text-white text-4xl md:text-5xl font-bold shadow-2xl">
                    {station.name.charAt(0)}
                  </div>
                )}
              </motion.div>

              {/* Station Info - Compact */}
              <motion.div
                className="text-center mb-3 md:mb-4 max-w-2xl"
                initial={{ opacity: 0, y: 20 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: {
                    delay: 0.3,
                    duration: 0.4,
                    ease: [0.4, 0, 0.2, 1],
                  },
                }}
              >
                {/* Now Playing Metadata */}
                {metadata && (metadata.title || metadata.artist) && metadata.is_song ? (
                  <div className="mb-2 md:mb-3">
                    <div className="text-white font-semibold text-lg md:text-xl mb-1">
                      {metadata.title || "Unknown Title"}
                    </div>
                    <div className="text-white/70 text-base md:text-lg">{metadata.artist || "Unknown Artist"}</div>
                  </div>
                ) : metadata && !metadata.is_song ? (
                  <div className="mb-2 md:mb-3">
                    <div className="text-white/80 font-medium text-base md:text-lg">Live Radio</div>
                  </div>
                ) : null}

                {/* Station Name with Logo */}
                <div className="flex items-center justify-center gap-3 mb-2">
                  {logoSrc && (
                    <motion.img
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.2, duration: 0.4 }}
                      src={logoSrc}
                      alt={station.name}
                      className="w-10 h-10 md:w-12 md:h-12 rounded-lg object-contain bg-white/5 p-1.5 border border-white/10"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement
                        target.style.display = "none"
                      }}
                    />
                  )}
                  <h2 className="text-white font-bold text-xl md:text-2xl">{station.name}</h2>
                </div>
                <div className="flex items-center justify-center gap-2 text-white/60 text-sm md:text-base mb-2">
                  <span>{station.state || station.country}</span>
                  <span className="w-1 h-1 rounded-full bg-white/40" />
                  <span className="font-mono text-xs bg-white/10 px-1.5 py-0.5 rounded">{station.bitrate}k</span>
                </div>
                {error ? (
                  <div className="flex items-center justify-center gap-2 text-red-400 text-sm md:text-base mt-2">
                    <AlertCircle size={16} />
                    <span>{error}</span>
                  </div>
                ) : isLoading ? (
                  reconnectAttempt > 0 ? (
                    <div className="flex items-center justify-center gap-2 text-purple-300 text-sm md:text-base mt-2">
                      <Loader2 size={16} className="animate-spin" />
                      <span>Reconnecting… (attempt {reconnectAttempt})</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2 text-purple-300 text-sm md:text-base mt-2">
                      <Loader2 size={16} className="animate-spin" />
                      <span>Connecting...</span>
                    </div>
                  )
                ) : null}
              </motion.div>

              {/* Controls - Compact */}
              <motion.div
                className="flex flex-col items-center gap-3 md:gap-4"
                initial={{ opacity: 0, y: 20 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: {
                    delay: 0.4,
                    duration: 0.4,
                    ease: [0.4, 0, 0.2, 1],
                  },
                }}
              >
                {/* Play/Pause Button */}
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={async (e) => {
                    e.stopPropagation()
                    triggerHaptic()

                    // Ensure AudioContext is running (Fix for Chrome/Safari)
                    if (audioContextRef.current && audioContextRef.current.state === "suspended") {
                      await audioContextRef.current.resume()
                    }

                    if (isPlaying) {
                      onPause()
                    } else {
                      onPlay()
                    }
                  }}
                  className={`
                    w-20 h-20 md:w-24 md:h-24 rounded-full flex items-center justify-center shadow-2xl transition-all
                    ${
                      isPlaying
                        ? "bg-white text-slate-900 hover:bg-gray-100"
                        : "bg-gradient-to-br from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500"
                    }
                  `}
                >
                  {isLoading ? (
                    <Loader2 size={32} className="animate-spin" />
                  ) : isPlaying ? (
                    <Pause size={32} fill="currentColor" />
                  ) : (
                    <Play size={32} fill="currentColor" className="ml-1" />
                  )}
                </motion.button>

                {/* Volume Control */}
                <div className="flex items-center gap-3 bg-white/5 rounded-full px-4 py-2 border border-white/10">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      triggerHaptic()
                      setIsMuted(!isMuted)
                    }}
                    className="text-white/70 hover:text-white transition-colors"
                  >
                    {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={isMuted ? 0 : volume}
                    onChange={(e) => {
                      triggerHaptic()
                      setVolume(Number.parseFloat(e.target.value))
                      setIsMuted(false)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-28 h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-purple-500 hover:accent-purple-400"
                  />
                </div>
              </motion.div>

              {/* Swipe hint - Smaller and less prominent */}
              <motion.div
                className="mt-2 md:mt-3 text-white/30 text-xs"
                initial={{ opacity: 0 }}
                animate={{
                  opacity: 1,
                  transition: {
                    delay: 0.6,
                    duration: 0.3,
                  },
                }}
              >
                Swipe down to exit
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Offline overlay */}
      {isOffline && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[300] flex items-center justify-center">
          <div className="bg-slate-900 rounded-2xl p-6 border border-white/10 text-center">
            <WifiOff size={48} className="text-red-400 mx-auto mb-4" />
            <h3 className="text-white text-xl font-bold mb-2">Offline Mode</h3>
            <p className="text-white/60">Please check your internet connection</p>
          </div>
        </div>
      )}
    </>
  )
}
