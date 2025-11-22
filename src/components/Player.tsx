import { useState, useRef, useEffect, useMemo } from 'react';
import type { RadioStation } from '../types/station';
import { motion, AnimatePresence } from 'framer-motion';
import Hls from 'hls.js';
import { Play, Pause, Volume2, VolumeX, AlertCircle, Loader2, WifiOff } from 'lucide-react';
import { useStationMetadata } from '../hooks/useStationMetadata';
import { useSettingsStore } from '../store/settingsStore';
import { useIdleTimeout } from '../hooks/useIdleTimeout';
import Visualizer from './Visualizer';
import PlayerLargeControls from './PlayerLargeControls';

interface PlayerProps {
  station: RadioStation | null;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
}

export default function Player({ station, isPlaying, onPlay, onPause }: PlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const isInitializingRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [swipeProgress, setSwipeProgress] = useState(0);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const touchStartYRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // Settings
  const { largeControls, visualizerEnabled, audio: audioSettings } = useSettingsStore();
  
  // Audio pipeline refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const eqFilterRef = useRef<BiquadFilterNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const previousStationRef = useRef<RadioStation | null>(null);
  
  // Reconnect state
  const [isOffline, setIsOffline] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isReconnectingRef = useRef(false);
  
  // Idle timeout hook
  const isIdle = useIdleTimeout({ 
    timeout: 30000, // 30 seconds
    enabled: isPlaying && !!station && !isFullscreen 
  });
  
  const [volume, setVolume] = useState(() => {
    try {
      const stored = localStorage.getItem('jamie_radio_volume');
      if (stored) {
        const parsed = Number.parseFloat(stored);
        if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          return parsed;
        }
      }
    } catch (err) {
      console.error('Failed to load volume preference:', err);
    }
    return 1;
  });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  
  // Fetch metadata for current station
  const { data: metadata, loading: metadataLoading, error: metadataError } = useStationMetadata(
    station?.id || null,
    station?.name || null
  );
  
  // Calculate logo URL using backend API
  const logoSrc = useMemo(() => {
    if (!station) return null;
    const params = new URLSearchParams();
    if (station.homepage) params.set('url', station.homepage);
    if (station.favicon) params.set('fallback', station.favicon);
    if (station.id) params.set('stationId', station.id);
    if (station.domain) params.set('discoveryId', station.domain);
    if (station.name) params.set('stationName', station.name);
    return `/api/logo?${params.toString()}`;
  }, [station?.homepage, station?.favicon, station?.id, station?.domain, station?.name]);
  
  // Station and metadata tracking (no debug logs)

  // Haptic feedback helper
  const triggerHaptic = () => {
    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  };

  // Offline detection
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      if (isPlaying && station && error) {
        // Auto-retry when connection returns
        setReconnectAttempt(0);
        isReconnectingRef.current = false;
      }
    };
    const handleOffline = () => {
      setIsOffline(true);
    };

    setIsOffline(!navigator.onLine);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isPlaying, station, error]);

  // Audio pipeline setup with Web Audio API
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Create AudioContext (singleton)
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    const audioContext = audioContextRef.current;

    // Create source node from audio element
    if (!sourceNodeRef.current) {
      sourceNodeRef.current = audioContext.createMediaElementSource(audio);
    }

    // Create compressor for normalization
    if (!compressorRef.current) {
      compressorRef.current = audioContext.createDynamicsCompressor();
      compressorRef.current.threshold.value = -24;
      compressorRef.current.knee.value = 30;
      compressorRef.current.ratio.value = 12;
      compressorRef.current.attack.value = 0.003;
      compressorRef.current.release.value = 0.25;
    }

    // Create EQ filter
    if (!eqFilterRef.current) {
      eqFilterRef.current = audioContext.createBiquadFilter();
    }

    // Create gain node for crossfade and volume
    if (!gainNodeRef.current) {
      gainNodeRef.current = audioContext.createGain();
      gainNodeRef.current.gain.value = volume;
    }

    // Connect audio pipeline: source → compressor → EQ → gain → destination
    const source = sourceNodeRef.current;
    const compressor = compressorRef.current;
    const eq = eqFilterRef.current;
    const gain = gainNodeRef.current;

    // Disconnect existing connections
    source.disconnect();
    compressor.disconnect();
    eq.disconnect();
    gain.disconnect();

    // Reconnect based on settings
    if (audioSettings.normalizationEnabled) {
      source.connect(compressor);
      compressor.connect(eq);
    } else {
      source.connect(eq);
    }
    eq.connect(gain);
    gain.connect(audioContext.destination);

    // Apply EQ preset
    const applyEqPreset = (preset: typeof audioSettings.eqPreset) => {
      if (!eq) return;
      
      switch (preset) {
        case 'bass':
          eq.type = 'lowshelf';
          eq.frequency.value = 250;
          eq.gain.value = 8;
          break;
        case 'treble':
          eq.type = 'highshelf';
          eq.frequency.value = 4000;
          eq.gain.value = 8;
          break;
        case 'voice':
          eq.type = 'peaking';
          eq.frequency.value = 2000;
          eq.gain.value = 6;
          eq.Q.value = 1;
          break;
        case 'flat':
        default:
          eq.gain.value = 0;
          break;
      }
    };

    applyEqPreset(audioSettings.eqPreset);
    compressor.threshold.value = audioSettings.normalizationEnabled ? -24 : 0;

    return () => {
      // Cleanup handled by component unmount
    };
  }, [audioSettings.eqPreset, audioSettings.normalizationEnabled, volume]);

  // Update gain node volume
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Crossfade when changing stations
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

  // Handle Audio Events
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleError = (e: Event) => {
      const audio = e.target as HTMLAudioElement;
      const error = audio.error;
      const errorDetails = {
        code: error?.code,
        message: error?.message,
        networkState: audio.networkState,
        readyState: audio.readyState,
        src: audio.src,
        paused: audio.paused,
        errorName: error ? 
          (error.code === MediaError.MEDIA_ERR_ABORTED ? 'MEDIA_ERR_ABORTED' :
           error.code === MediaError.MEDIA_ERR_NETWORK ? 'MEDIA_ERR_NETWORK' :
           error.code === MediaError.MEDIA_ERR_DECODE ? 'MEDIA_ERR_DECODE' :
           error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? 'MEDIA_ERR_SRC_NOT_SUPPORTED' :
           'UNKNOWN') : 'NO_ERROR'
      };
      // Audio error event (only log fatal errors)
      
      // Only pause on fatal errors (network errors, decode errors)
      // Don't pause on MEDIA_ERR_ABORTED (user cancelled) or during initialization
      if (isInitializingRef.current) {
        // Ignoring error during initialization
        return;
      }
      
      if (error && (error.code === MediaError.MEDIA_ERR_NETWORK || error.code === MediaError.MEDIA_ERR_DECODE)) {
        // Fatal error - attempt reconnect with exponential backoff
        if (!isReconnectingRef.current && isPlaying) {
          isReconnectingRef.current = true;
          attemptReconnect();
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
      isInitializingRef.current = false; // Clear init flag when actually playing
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

  // Handle Stream Loading
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !station) return

    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    if (isPlaying) {
      let streamUrl = station.url_resolved || station.url
      if (!streamUrl) {
        setError("No URL")
        setIsLoading(false)
        onPause()
        return
      }
      
      // Universal HTTPS upgrade for mixed content compliance
      // Upgrade ALL HTTP URLs to HTTPS (safety net)
      if (streamUrl.startsWith('http://')) {
        // Global Radio: Special handling for media-ssl endpoint
        if (streamUrl.includes('media-the.musicradio.com') || streamUrl.includes('vis.media-ice.musicradio.com')) {
          streamUrl = streamUrl
            .replace(/http:\/\/(media-the|vis\.media-ice)\.musicradio\.com/, 'https://media-ssl.musicradio.com')
            .replace(/^http:/, 'https:');
        } else {
          // Universal upgrade: ALL HTTP URLs -> HTTPS
          streamUrl = streamUrl.replace(/^http:/, 'https:');
        }
      }

      // Mark as initializing to prevent premature pause
      isInitializingRef.current = true;
      setError(null)
      setIsLoading(true)
      // Starting stream
      
      // Clear initialization flag after a delay
      setTimeout(() => {
        isInitializingRef.current = false;
      }, 1000);

      const isHls =
        streamUrl.includes(".m3u8") ||
        streamUrl.includes("lsn.lv") ||
        streamUrl.includes("akamaized.net") ||
        station.name.toLowerCase().includes("bbc")

      if (isHls && Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true })
        hls.loadSource(streamUrl)
        hls.attachMedia(audio)
        hlsRef.current = hls

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          audio.play().catch((err) => {
            // Don't pause on autoplay policy failures - just log and keep ready
            if (err.name === 'NotAllowedError' || err.name === 'NotSupportedError') {
              // Autoplay blocked by browser policy
              setError(null); // Clear any previous errors
              setIsLoading(false);
              // Don't call onPause() - keep isPlaying true so user can click to play
            } else {
              // AbortError is expected in React StrictMode (double effect runs)
              // The second attempt will succeed, so we can ignore it
              if (err.name === 'AbortError') {
                // HLS play aborted (expected in StrictMode)
                return;
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
          if (err.name === 'NotAllowedError' || err.name === 'NotSupportedError') {
            console.log('[Player] Autoplay blocked by browser policy - user interaction required');
            setError(null); // Clear any previous errors
            setIsLoading(false);
            // Don't call onPause() - keep isPlaying true so user can click to play
          } else {
            // AbortError is expected in React StrictMode (double effect runs)
            // The second attempt will succeed, so we can ignore it
            if (err.name === 'AbortError') {
              // Play aborted (expected in StrictMode)
              return;
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
        return;
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
  }, [isPlaying, station, onPause])

  // Handle Volume
  useEffect(() => {
    const audio = audioRef.current
    if (audio) {
      audio.volume = isMuted ? 0 : volume
    }
  }, [volume, isMuted])

  // Persist volume to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('jamie_radio_volume', volume.toString());
    } catch (err) {
      console.error('Failed to save volume preference:', err);
    }
  }, [volume]);

  // Cleanup reconnect timeout
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  // Helper function to update MediaSession metadata
  const updateMediaSessionMetadata = (
    station: RadioStation | null,
    metadata: { title: string | null; artist: string | null; artwork_url: string | null; is_song: boolean } | null,
    logoSrc: string | null
  ) => {
    if (!('mediaSession' in navigator) || !station) return;

    const mediaSession = navigator.mediaSession;
    const artwork: MediaImage[] = [];

    // Use artwork proxy for iOS compatibility
    if (metadata?.artwork_url) {
      artwork.push({
        src: `/api/artwork?url=${encodeURIComponent(metadata.artwork_url)}`,
        sizes: '512x512',
        type: 'image/png',
      });
    } else if (logoSrc) {
      artwork.push({
        src: logoSrc,
        sizes: '512x512',
        type: 'image/png',
      });
    } else {
      // Fallback to app logo
      artwork.push({
        src: '/logo.png',
        sizes: '512x512',
        type: 'image/png',
      });
    }

    // Format: <StationName> — Now Playing: <TrackTitle>
    let title: string;
    let artist: string;

    if (metadata?.is_song && metadata.title) {
      title = `${station.name} — Now Playing: ${metadata.title}`;
      artist = metadata.artist || station.name;
    } else {
      title = station.name;
      artist = 'Live Radio';
    }

    mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album: station.name,
      artwork,
    });
  };

  // MediaSession API for iOS metadata support
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const mediaSession = navigator.mediaSession;

    // Set action handlers (only set once, not on every render)
    mediaSession.setActionHandler('play', () => {
      if (!isPlaying) {
        onPlay();
      }
    });

    mediaSession.setActionHandler('pause', () => {
      if (isPlaying) {
        onPause();
      }
    });

    mediaSession.setActionHandler('stop', () => {
      if (isPlaying) {
        onPause();
      }
    });

    // Disable unused actions for radio context
    mediaSession.setActionHandler('previoustrack', null);
    mediaSession.setActionHandler('nexttrack', null);

    return () => {
      // Cleanup handlers on unmount
      try {
        mediaSession.setActionHandler('play', null);
        mediaSession.setActionHandler('pause', null);
        mediaSession.setActionHandler('stop', null);
      } catch (e) {
        // Ignore errors during cleanup
      }
    };
  }, [isPlaying, onPlay, onPause]);

  // Update MediaSession metadata whenever station, metadata, or artwork changes
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    updateMediaSessionMetadata(station, metadata, logoSrc);

    // Update playback state
    const mediaSession = navigator.mediaSession;
    if (isPlaying) {
      mediaSession.playbackState = 'playing';
    } else {
      mediaSession.playbackState = 'paused';
    }

    // Clear position state for live radio streams (no progress bar/time indicator)
    // This prevents iOS from showing a song-like progress bar
    try {
      if ('setPositionState' in mediaSession) {
        // Clear position state to indicate it's a live stream
        mediaSession.setPositionState(null as any);
      }
    } catch (e) {
      // Some browsers may not support setPositionState or may throw errors
      // Ignore silently
    }
  }, [station, metadata, logoSrc, isPlaying]);

  // Reconnect with exponential backoff
  const attemptReconnect = () => {
    if (!isPlaying || !station || isOffline) return;

    const maxAttempts = 5;
    if (reconnectAttempt >= maxAttempts) {
      setError('Connection failed after multiple attempts');
      setIsLoading(false);
      isReconnectingRef.current = false;
      return;
    }

    const backoffDelays = [1000, 2000, 4000, 8000, 10000];
    const delay = backoffDelays[Math.min(reconnectAttempt, backoffDelays.length - 1)];
    
    setReconnectAttempt((prev) => prev + 1);
    setError(`Reconnecting… (attempt ${reconnectAttempt + 1})`);
    setIsLoading(true);

    reconnectTimeoutRef.current = setTimeout(() => {
      if (isPlaying && station) {
        // Trigger stream reload by updating isPlaying
        const audio = audioRef.current;
        if (audio) {
          audio.load();
          audio.play().catch(() => {
            // Retry again if play fails
            if (reconnectAttempt < maxAttempts) {
              attemptReconnect();
            }
          });
        }
      }
    }, delay);
  };

  // Idle detection for auto fullscreen using hook
  useEffect(() => {
    if (isIdle && isPlaying && station && !isFullscreen) {
      setIsFullscreen(true);
    } else if (!isIdle && isFullscreen) {
      // Exit fullscreen on interaction (optional - can be removed if you want manual exit only)
      // setIsFullscreen(false);
    }
  }, [isIdle, isPlaying, station, isFullscreen]);

  // Swipe down gesture detection with optimized animation (direct DOM manipulation)
  useEffect(() => {
    // Update header height CSS variable dynamically
    const updateHeaderHeight = () => {
      const header = document.querySelector('header');
      if (header) {
        // Use getBoundingClientRect for accurate height including borders
        const headerHeight = header.getBoundingClientRect().height;
        document.documentElement.style.setProperty('--header-height', `${headerHeight}px`);
      }
    };

    // Update immediately and after a short delay to ensure header is fully rendered
    updateHeaderHeight();
    const timeoutId = setTimeout(updateHeaderHeight, 100);
    
    // Update when fullscreen opens (header might have changed size)
    let fullscreenTimeoutId: NodeJS.Timeout | null = null;
    if (isFullscreen) {
      fullscreenTimeoutId = setTimeout(updateHeaderHeight, 50);
    }
    
    // Also update on window resize (for responsive header changes)
    window.addEventListener('resize', updateHeaderHeight);

    if (!isFullscreen) {
      setSwipeProgress(0);
      // Reset transforms
      if (fullscreenRef.current) {
        fullscreenRef.current.style.transform = 'translate3d(0, 0, 0)';
        fullscreenRef.current.style.opacity = '';
        fullscreenRef.current.style.transition = '';
      }
      if (indicatorRef.current) {
        indicatorRef.current.style.opacity = '0';
        indicatorRef.current.style.transition = '';
      }
      return;
    }

    const updateTransforms = (progress: number) => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      animationFrameRef.current = requestAnimationFrame(() => {
        const container = fullscreenRef.current;
        const indicator = indicatorRef.current;
        
        if (container) {
          // Allow pulling down much further - up to 300px
          const translateY = progress * 300;
          container.style.transform = `translate3d(0, ${translateY}px, 0)`;
          // Smooth opacity fade
          container.style.opacity = String(Math.max(0, 1 - progress * 0.8));
        }
        
        if (indicator) {
          const indicatorOpacity = Math.min(progress * 2, 1);
          indicator.style.opacity = String(indicatorOpacity);
        }
      });
    };

    const handleTouchStart = (e: TouchEvent) => {
      touchStartYRef.current = e.touches[0].clientY;
      updateTransforms(0);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (touchStartYRef.current === null) return;
      
      const currentY = e.touches[0].clientY;
      const deltaY = currentY - touchStartYRef.current;
      
      // Only allow downward swipes and prevent page scroll
      if (deltaY > 0) {
        e.preventDefault(); // Prevent page scroll
        // Allow pulling down up to 400px before capping
        const progress = Math.min(deltaY / 400, 1);
        updateTransforms(progress);
        setSwipeProgress(progress); // Only for indicator rotation
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (touchStartYRef.current === null) return;
      
      const currentY = e.changedTouches[0].clientY;
      const deltaY = currentY - touchStartYRef.current;
      
      // If swiped down more than 150px, exit fullscreen
      if (deltaY > 150) {
        // Exit fullscreen smoothly
        setIsFullscreen(false);
        // Unlock body scroll immediately to prevent freeze
        requestAnimationFrame(() => {
          document.body.style.overflow = '';
          document.body.style.position = '';
          document.body.style.width = '';
        });
      } else {
        // Smoothly animate back using CSS transition
        const container = fullscreenRef.current;
        const indicator = indicatorRef.current;
        
        if (container) {
          container.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease';
          container.style.transform = 'translate3d(0, 0, 0)';
          container.style.opacity = '1';
          
          // Remove transition after animation completes
          setTimeout(() => {
            if (container) {
              container.style.transition = '';
            }
          }, 250);
        }
        
        if (indicator) {
          indicator.style.transition = 'opacity 0.2s ease';
          indicator.style.opacity = '0';
          setTimeout(() => {
            if (indicator) {
              indicator.style.transition = '';
            }
          }, 200);
        }
        
        setSwipeProgress(0);
      }
      
      touchStartYRef.current = null;
    };

    // Prevent body scroll when fullscreen
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';

    const container = fullscreenRef.current;
    if (container) {
      // Use passive: false for touchmove so we can preventDefault
      container.addEventListener('touchstart', handleTouchStart, { passive: true });
      container.addEventListener('touchmove', handleTouchMove, { passive: false });
      container.addEventListener('touchend', handleTouchEnd, { passive: true });
    }

    return () => {
      // Restore body scroll
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      
      // Cancel any pending animation frames
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      // Remove resize listener and clear timeouts
      window.removeEventListener('resize', updateHeaderHeight);
      if (timeoutId) clearTimeout(timeoutId);
      if (fullscreenTimeoutId) clearTimeout(fullscreenTimeoutId);
      
      if (container) {
        container.removeEventListener('touchstart', handleTouchStart);
        container.removeEventListener('touchmove', handleTouchMove);
        container.removeEventListener('touchend', handleTouchEnd);
      }
    };
  }, [isFullscreen]);

  // Don't prevent body scroll - let fullscreen container handle it

  if (!station) return null;

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
            triggerHaptic();
            onPlay();
          }}
          onPause={() => {
            triggerHaptic();
            onPause();
          }}
          onVolumeChange={(vol) => {
            triggerHaptic();
            setVolume(vol);
            setIsMuted(false);
          }}
          onMuteToggle={() => {
            triggerHaptic();
            setIsMuted(!isMuted);
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
    );
  }

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
            style={{ cursor: 'pointer' }}
          >

        {/* Floating Player Container */}
        <div className="relative bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
          {/* Blurred Background Artwork */}
          {metadata?.artwork_url && (
            <div 
              className="absolute inset-0 opacity-20"
              style={{
                backgroundImage: `url(/api/artwork?url=${encodeURIComponent(metadata.artwork_url)})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: 'blur(40px)',
                transform: 'scale(1.1)',
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
                      const target = e.target as HTMLImageElement;
                      if (logoSrc) {
                        target.src = logoSrc;
                      }
                    }}
                  />
                ) : logoSrc ? (
                  <img
                    src={logoSrc}
                    alt={station.name}
                    className="w-16 h-16 md:w-20 md:h-20 rounded-2xl object-cover shadow-lg bg-slate-800"
                    onError={(e) => {
                      // If logo API fails, show placeholder
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
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
                      {metadataError.message.includes('404') || metadataError.message.includes('Failed to fetch') 
                        ? 'API not available - use "vercel dev" or deploy to Vercel'
                        : `Metadata error: ${metadataError.message}`}
                    </div>
                  </div>
                )}
                {!metadataError && metadata && (metadata.title || metadata.artist) && metadata.is_song ? (
                  <div className="mb-1">
                    <div className="text-white font-semibold text-sm md:text-base truncate">
                      {metadata.title || 'Unknown Title'}
                    </div>
                    <div className="text-white/70 text-xs md:text-sm truncate">
                      {metadata.artist || 'Unknown Artist'}
                    </div>
                  </div>
                ) : !metadataError && metadata && !metadata.is_song ? (
                  <div className="mb-1">
                    <div className="text-white/80 font-medium text-sm md:text-base">
                      Live Radio
                    </div>
                  </div>
                ) : !metadataError && metadataLoading ? (
                  <div className="mb-1">
                    <div className="text-white/60 text-xs md:text-sm animate-pulse">
                      Loading metadata...
                    </div>
                  </div>
                ) : !station?.id && (
                  <div className="mb-1">
                    <div className="text-yellow-400/80 text-xs md:text-sm">
                      Station ID not available
                    </div>
                  </div>
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
              {/* Volume - Hidden on small mobile, visible on tablet/desktop */}
              <div className="hidden md:flex items-center gap-3 bg-white/5 rounded-full px-4 py-2 border border-white/5" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerHaptic();
                    setIsMuted(!isMuted);
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
                    triggerHaptic();
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
                  e.stopPropagation();
                  triggerHaptic();
                  
                  // iOS autoplay unlock - ensure audio context is ready
                  const audio = audioRef.current;
                  if (audio && audio.paused) {
                    try {
                      await audio.play();
                      audio.pause();
                    } catch {
                      // Ignore autoplay errors
                    }
                  }
                  
                  if (isPlaying) {
                    onPause();
                  } else {
                    onPlay();
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
            ref={fullscreenRef}
            initial={{ opacity: 0 }}
            animate={{ 
              opacity: 1,
              transition: {
                duration: 0.3,
                ease: [0.4, 0, 0.2, 1]
              }
            }}
            exit={{ 
              opacity: 0, 
              y: 300,
              scale: 0.95,
              transition: {
                duration: 0.3,
                ease: [0.4, 0, 0.2, 1]
              }
            }}
            className="fixed top-0 left-0 right-0 bottom-0 z-[50] bg-slate-950"
            style={{
              touchAction: 'pan-y',
              overscrollBehavior: 'none',
              willChange: 'transform',
              transform: 'translate3d(0, 0, 0)',
              paddingTop: 'var(--header-height, 88px)',
            }}
            onAnimationComplete={() => {
              // Ensure body scroll is unlocked after exit animation
              document.body.style.overflow = '';
              document.body.style.position = '';
              document.body.style.width = '';
            }}
            onClick={(e) => {
              // Only close if clicking the background, not the content
              if (e.target === e.currentTarget) {
                setIsFullscreen(false);
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
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    filter: 'blur(60px)',
                    transform: 'scale(1.2)',
                    willChange: 'transform',
                  }}
                />
              )}
              
              {/* Simplified Gradient Orbs - CSS animations for better performance */}
              <div 
                className="absolute top-1/4 left-1/4 w-64 h-64 md:w-96 md:h-96 bg-purple-600/20 rounded-full blur-3xl"
                style={{
                  animation: 'float1 20s ease-in-out infinite',
                  willChange: 'transform',
                }}
              />
              <div 
                className="absolute bottom-1/4 right-1/4 w-64 h-64 md:w-96 md:h-96 bg-blue-600/20 rounded-full blur-3xl"
                style={{
                  animation: 'float2 25s ease-in-out infinite',
                  willChange: 'transform',
                }}
              />
              
              {/* Reduced Particles - Only on larger screens (hidden on mobile) */}
              <div className="hidden md:block">
              {[...Array(5)].map((_, i) => {
                const randomX = Math.random() * 100;
                const randomY = Math.random() * 100;
                const randomDelay = Math.random() * 2;
                const randomDuration = 10 + Math.random() * 10;
                return (
                  <motion.div
                    key={i}
                    className="absolute w-1.5 h-1.5 bg-white/15 rounded-full"
                    style={{
                      left: `${randomX}%`,
                      top: `${randomY}%`,
                      willChange: 'transform, opacity',
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
                );
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
                    willChange: 'transform',
                  }}
                >
                  ↓
                </div>
                <span>Release to exit</span>
              </div>
            </div>

            {/* Fullscreen Content - Compact to fit on screen */}
            <motion.div 
              className="flex flex-col items-center p-4 md:p-6 relative z-10"
              style={{
                minHeight: 'calc(100vh - var(--header-height, 88px))',
                paddingTop: '1.5rem',
                paddingBottom: '2rem',
                justifyContent: 'flex-start',
                overflowY: 'auto',
              }}
              initial={{ opacity: 0, y: 30 }}
              animate={{ 
                opacity: 1, 
                y: 0,
                transition: {
                  delay: 0.1,
                  duration: 0.4,
                  ease: [0.4, 0, 0.2, 1]
                }
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
                    ease: [0.34, 1.56, 0.64, 1]
                  }
                }}
              >
                {metadata?.artwork_url ? (
                  <img
                    src={`/api/artwork?url=${encodeURIComponent(metadata.artwork_url)}`}
                    alt={metadata.title || station.name}
                    className="w-40 h-40 md:w-56 md:h-56 rounded-2xl object-cover shadow-2xl bg-slate-800"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      if (logoSrc) {
                        target.src = logoSrc;
                      }
                    }}
                  />
                ) : logoSrc ? (
                  <img
                    src={logoSrc}
                    alt={station.name}
                    className="w-40 h-40 md:w-56 md:h-56 rounded-2xl object-cover shadow-2xl bg-slate-800"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
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
                    ease: [0.4, 0, 0.2, 1]
                  }
                }}
              >
                {/* Now Playing Metadata */}
                {metadata && (metadata.title || metadata.artist) && metadata.is_song ? (
                  <div className="mb-2 md:mb-3">
                    <div className="text-white font-semibold text-lg md:text-xl mb-1">
                      {metadata.title || 'Unknown Title'}
                    </div>
                    <div className="text-white/70 text-base md:text-lg">
                      {metadata.artist || 'Unknown Artist'}
                    </div>
                  </div>
                ) : metadata && !metadata.is_song ? (
                  <div className="mb-2 md:mb-3">
                    <div className="text-white/80 font-medium text-base md:text-lg">
                      Live Radio
                    </div>
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
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
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
                    ease: [0.4, 0, 0.2, 1]
                  }
                }}
              >
                {/* Play/Pause Button */}
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerHaptic();
                    if (isPlaying) {
                      onPause();
                    } else {
                      onPlay();
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
                      e.stopPropagation();
                      triggerHaptic();
                      setIsMuted(!isMuted);
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
                      triggerHaptic();
                      setVolume(Number.parseFloat(e.target.value));
                      setIsMuted(false);
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
                    duration: 0.3
                  }
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

