"use client"

import { useState, useEffect, useRef } from "react"
import { motion } from "framer-motion"
import type { RadioStation } from "./types/station"
import StationList from "./components/StationList"
import StationCard from "./components/StationCard"
import Player from "./components/Player"
import { Search, Wifi, Clock, Settings } from "lucide-react"
import { useStationHistory } from "./hooks/useStationHistory"
import { useSettingsStore } from "./store/settingsStore"
import { useGestureControls } from "./hooks/useGestureControls"
import { ThemeProvider } from "./components/ThemeProvider"
import SettingsPanel from "./components/settings/SettingsPanel"
import Temperature from "./components/Temperature"
import OfflineMode from "./components/OfflineMode"
import PWAInstallPrompt from "./components/PWAInstallPrompt"
import ClockComponent from "./components/ClockComponent"

function App() {
  // TTS is now handled by the API, no preloading needed
  const [stations, setStations] = useState<RadioStation[]>([])
  const [filteredStations, setFilteredStations] = useState<RadioStation[]>([])
  const [currentStation, setCurrentStation] = useState<RadioStation | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { recentStations, addToHistory, getLastPlayed, getLastPlayingState } = useStationHistory()
  const { autoplayLastStation, startupView, toggleLargeControls, largeControls } = useSettingsStore()
  const autoplayAttemptedRef = useRef(false)
  const isInitialMountRef = useRef(true)
  const lastPlayingStateRef = useRef<boolean | null>(null)
  const playingStateChangeTimeRef = useRef<number>(0)

  useEffect(() => {
    loadStations()

    // Handle startup view
    if (startupView === "largeControls" && !largeControls) {
      toggleLargeControls()
    } else if (startupView === "favourites") {
      // Scroll to favourites section (recent stations)
      // This is handled by the UI - recent stations are shown at top
    }

    // Restore last played station on mount
    const lastPlayed = getLastPlayed()
    // Restoring last played station
    if (lastPlayed) {
      setCurrentStation(lastPlayed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Separate effect to handle autoplay after station is set and Player is ready
  useEffect(() => {
    // Skip if already attempted or conditions not met
    if (autoplayAttemptedRef.current || !currentStation || loading || stations.length === 0) {
      if (!autoplayAttemptedRef.current) {
        // Autoplay conditions not met
      }
      return
    }

    const lastPlayed = getLastPlayed()
    const wasPlaying = getLastPlayingState()

    // Checking autoplay conditions

    // Auto-play if this is the restored station and autoplayLastStation is enabled
    // This ensures the station is ready to play even if browser blocks autoplay
    if (lastPlayed && lastPlayed.stationuuid === currentStation.stationuuid && !isPlaying) {
      autoplayAttemptedRef.current = true

      // Check if autoplay is enabled in settings
      if (autoplayLastStation && wasPlaying) {
        // Attempting autoplay
        // Wait for Player component to be fully mounted and ready
        const timer = setTimeout(() => {
          // Setting isPlaying to true
          setIsPlaying(true)
        }, 1500)
        return () => clearTimeout(timer)
      } else {
        // Station restored, ready to play on click
        autoplayAttemptedRef.current = true
      }
    } else {
      autoplayAttemptedRef.current = true // Mark as attempted even if conditions don't match
    }
  }, [currentStation, loading, stations.length, getLastPlayed, getLastPlayingState, isPlaying])

  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false
      lastPlayingStateRef.current = isPlaying
      return
    }

    if (currentStation) {
      const now = Date.now()
      const timeSinceLastChange = now - playingStateChangeTimeRef.current

      if (lastPlayingStateRef.current === true && isPlaying === false && timeSinceLastChange < 2000) {
        return
      }

      lastPlayingStateRef.current = isPlaying
      playingStateChangeTimeRef.current = now
      addToHistory(currentStation, isPlaying)
    }
  }, [isPlaying, currentStation, addToHistory])

  useEffect(() => {
    const filtered = stations.filter(
      (station) =>
        station.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        station.tags.toLowerCase().includes(searchQuery.toLowerCase()),
    )
    setFilteredStations(filtered)
  }, [searchQuery, stations])

  const loadStations = async () => {
    try {
      setLoading(true)
      console.log("[App] Loading stations from API...")

      const response = await fetch("/api/stations")
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = (await response.json()) as RadioStation[]
      console.log(`[App] Loaded ${data.length} stations from API`)

      setStations(data)

      data.slice(0, 20).forEach((station) => {
        const params = new URLSearchParams()
        if (station.homepage) params.set("url", station.homepage)
        if (station.favicon) params.set("fallback", station.favicon)
        if (station.id) params.set("stationId", station.id)
        if (station.domain) params.set("discoveryId", station.domain)
        if (station.name) params.set("stationName", station.name)
        const logoSrc = `/api/logo?${params.toString()}`

        const img = new Image()
        img.src = logoSrc
      })
    } catch (err) {
      console.error("[App] Failed to load stations:", err)
      setStations([])
    } finally {
      setLoading(false)
    }
  }

  const handleStationSelect = (station: RadioStation) => {
    if (currentStation?.stationuuid === station.stationuuid) {
      const newPlayingState = !isPlaying
      playingStateChangeTimeRef.current = Date.now()
      setIsPlaying(newPlayingState)
    } else {
      setCurrentStation(station)
      playingStateChangeTimeRef.current = Date.now()
      setIsPlaying(true)
    }
  }

  const handleNextStation = () => {
    if (recentStations.length === 0) return
    const currentIndex = recentStations.findIndex((s) => s.stationuuid === currentStation?.stationuuid)
    const nextIndex = currentIndex >= 0 && currentIndex < recentStations.length - 1 ? currentIndex + 1 : 0
    handleStationSelect(recentStations[nextIndex])
  }

  const handlePreviousStation = () => {
    if (recentStations.length === 0) return
    const currentIndex = recentStations.findIndex((s) => s.stationuuid === currentStation?.stationuuid)
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : recentStations.length - 1
    handleStationSelect(recentStations[prevIndex])
  }

  const handlePlayStationByName = (stationName: string) => {
    console.log(`[App] handlePlayStationByName called with: "${stationName}"`)
    console.log(`[App] Available stations: ${stations.length}`)

    const matched = stations.find(
      (s) =>
        s.name.toLowerCase().includes(stationName.toLowerCase()) ||
        stationName.toLowerCase().includes(s.name.toLowerCase()),
    )

    if (matched) {
      console.log(`[App] Matched station: "${matched.name}"`)
      handleStationSelect(matched)
    } else {
      console.warn(`[App] No station found matching: "${stationName}"`)
      console.log(`[App] Attempting RadioBrowser search for: "${stationName}"`)
    }
  }

  const appGestures = useGestureControls({
    onSwipeLeft: handleNextStation,
    onSwipeRight: handlePreviousStation,
    enabled: true,
  })

  return (
    <ThemeProvider currentStation={currentStation}>
      <PWAInstallPrompt />
      <OfflineMode onStationSelect={handleStationSelect} isPlaying={isPlaying} currentStation={currentStation} />
      <div
        className="min-h-screen bg-slate-950 text-white selection:bg-purple-500/30"
        ref={appGestures.setContainerRef}
      >
        <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-900/20 rounded-full blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-900/20 rounded-full blur-[120px]" />
        </div>

        <div className="relative z-10">
          <header
            className="sticky top-0 z-[100] bg-slate-950/80 backdrop-blur-xl border-b border-white/5"
            style={{ position: "sticky" }}
          >
            <div className="container mx-auto px-6 py-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center gap-3">
                  <img src="/logo.png" alt="JamieRadio Logo" className="w-14 h-14 md:w-16 md:h-16 object-contain" />
                  <div>
                    <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">
                      Jamie Radio
                    </h1>
                    <p className="text-xs text-white/50 font-medium tracking-wider uppercase">
                      High Quality Internet Radio
                    </p>
                  </div>
                </div>

                <div className="relative w-full md:w-96">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-5 w-5 text-white/30" />
                  </div>
                  <input
                    type="text"
                    placeholder="Search stations, genres..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="block w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:bg-white/10 transition-all"
                  />
                </div>

                <div className="flex items-center gap-4 flex-shrink-0">
                  <ClockComponent />
                  <Temperature />
                  <button
                    onClick={() => setSettingsOpen(true)}
                    className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                    aria-label="Settings"
                  >
                    <Settings size={20} className="text-white" />
                  </button>
                </div>
              </div>
            </div>
          </header>

          <main className="container mx-auto px-6 py-8">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-32">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
                  className="relative"
                >
                  <div className="w-16 h-16 border-4 border-purple-500/30 rounded-full" />
                  <div className="absolute top-0 left-0 w-16 h-16 border-4 border-t-purple-500 rounded-full" />
                </motion.div>
                <p className="mt-4 text-white/50 font-medium animate-pulse">Tuning in...</p>
              </div>
            ) : (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
                {recentStations.length > 0 && (
                  <div className="mb-8">
                    <div className="flex items-center gap-2 mb-4">
                      <Clock size={20} className="text-purple-400" />
                      <h2 className="text-xl font-semibold text-white/90">Recently Played</h2>
                    </div>
                    <div className="overflow-x-auto pb-4 -mx-6 px-6 scrollbar-hide">
                      <div className="flex gap-4 min-w-max">
                        {recentStations.map((station, index) => (
                          <motion.div
                            key={station.stationuuid}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.05 }}
                            className="flex-shrink-0 w-80"
                          >
                            <StationCard
                              station={station}
                              isPlaying={isPlaying && currentStation?.stationuuid === station.stationuuid}
                              onPlay={() => handleStationSelect(station)}
                            />
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-semibold text-white/90 flex items-center gap-2">
                    <Wifi size={20} className="text-purple-400" />
                    Available Stations
                  </h2>
                  <span className="px-3 py-1 bg-white/5 rounded-full text-sm text-white/50 border border-white/5">
                    {filteredStations.length} results
                  </span>
                </div>

                <StationList
                  stations={filteredStations}
                  currentStation={currentStation}
                  isPlaying={isPlaying}
                  onStationSelect={handleStationSelect}
                />
              </motion.div>
            )}
          </main>

          <Player
            station={currentStation}
            isPlaying={isPlaying}
            onPlay={() => {
              setIsPlaying(true)
            }}
            onPause={() => {
              setIsPlaying(false)
            }}
            onToggleMute={() => {}}
            onExitFullscreen={() => {}}
            recentStations={recentStations}
            onNextStation={handleNextStation}
            onPreviousStation={handlePreviousStation}
            onPlayStation={handlePlayStationByName}
            currentMetadata={null}
            availableStations={stations}
          />
        </div>
      </div>

      <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </ThemeProvider>
  )
}

export default App
