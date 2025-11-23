import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useSettingsStore, type Theme, type StartupView, type EqPreset } from '../../store/settingsStore';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const {
    theme,
    visualizerEnabled,
    largeControls,
    autoplayLastStation,
    startupView,
    audio,
    useDeviceLocation,
    fallbackLocation,
    locationPermission,
    enhancedOfflineVoice,
    aiVisualFeedback,
        setTheme,
    toggleVisualizer,
    toggleLargeControls,
    setAutoplayLastStation,
    setStartupView,
    setEqPreset,
    toggleNormalization,
    setUseDeviceLocation,
    setFallbackLocation,
    setLocationPermission,
    setEnhancedOfflineVoice,
    setAIVisualFeedback,
      } = useSettingsStore();

  const [manualCity, setManualCity] = useState(fallbackLocation.city);
  const [manualLat, setManualLat] = useState(fallbackLocation.lat?.toString() || '');
  const [manualLon, setManualLon] = useState(fallbackLocation.lon?.toString() || '');
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isDownloadingModel, setIsDownloadingModel] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isModelReady, setIsModelReady] = useState(false);

  // Sync manual inputs when fallbackLocation changes externally
  useEffect(() => {
    setManualCity(fallbackLocation.city);
    setManualLat(fallbackLocation.lat?.toString() || '');
    setManualLon(fallbackLocation.lon?.toString() || '');
  }, [fallbackLocation]);

  // Geocode city name to get coordinates
  const geocodeCity = async (cityName: string): Promise<{ lat: number; lon: number } | null> => {
    try {
      // Use OpenStreetMap Nominatim API (free, no API key required)
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cityName)}&limit=1`,
        {
          headers: {
            'User-Agent': 'JamieRadio/1.0',
          },
        }
      );

      if (!response.ok) return null;

      const data = await response.json();
      if (data && data.length > 0) {
        return {
          lat: Number.parseFloat(data[0].lat),
          lon: Number.parseFloat(data[0].lon),
        };
      }
      return null;
    } catch (error) {
      console.error('Geocoding error:', error);
      return null;
    }
  };

  const themes: { value: Theme; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'oled', label: 'OLED' },
    { value: 'dynamic', label: 'Dynamic' },
  ];

  const startupViews: { value: StartupView; label: string }[] = [
    { value: 'home', label: 'Home' },
    { value: 'favourites', label: 'Favourites' },
    { value: 'largeControls', label: 'Large Controls' },
  ];

  const eqPresets: { value: EqPreset; label: string }[] = [
    { value: 'flat', label: 'Flat' },
    { value: 'bass', label: 'Bass' },
    { value: 'treble', label: 'Treble' },
    { value: 'voice', label: 'Voice' },
  ];

  // Check if KittenTTS model is ready
  useEffect(() => {
    const checkModelStatus = async () => {
      try {
        const { KittenEngine } = await import('../../services/engines/kittenEngine');
        const engine = new KittenEngine();
        const available = await engine.isAvailable();
        setIsModelReady(available && engine.isModelDownloaded());
      } catch (error) {
        console.warn('[Settings] Failed to check KittenTTS model status:', error);
        setIsModelReady(false);
      }
    };
    
    if (enhancedOfflineVoice) {
      checkModelStatus();
    }
  }, [enhancedOfflineVoice]);

  const handleDownloadModel = async () => {
    try {
      setIsDownloadingModel(true);
      setDownloadProgress(0);
      
      const { KittenEngine } = await import('../../services/engines/kittenEngine');
      const engine = new KittenEngine();
      
      await engine.downloadModel((progress) => {
        setDownloadProgress(progress);
      });
      
      setIsModelReady(true);
    } catch (error) {
      console.error('[Settings] Model download failed:', error);
      alert('Failed to download voice model. Please try again or use Web Speech API.');
    } finally {
      setIsDownloadingModel(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200]"
          />

          {/* Panel */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-white/10 rounded-t-3xl z-[201] max-h-[90vh] overflow-y-auto"
          >
            <div className="p-6">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-white">Settings</h2>
                <button
                  onClick={onClose}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                >
                  <X size={24} className="text-white" />
                </button>
              </div>

              {/* Themes Section */}
              <div className="mb-8">
                <h3 className="text-lg font-semibold text-white mb-4">Theme</h3>
                <div className="grid grid-cols-2 gap-3">
                  {themes.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => setTheme(t.value)}
                      className={`
                        px-4 py-3 rounded-xl border-2 transition-all
                        ${
                          theme === t.value
                            ? 'border-purple-500 bg-purple-500/20 text-white'
                            : 'border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10'
                        }
                      `}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Visualizer Toggle */}
              <div className="mb-8">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-1">Audio Visualizer</h3>
                    <p className="text-sm text-white/60">Show frequency spectrum visualization</p>
                  </div>
                  <button
                    onClick={toggleVisualizer}
                    className={`
                      relative w-14 h-8 rounded-full transition-colors
                      ${visualizerEnabled ? 'bg-purple-500' : 'bg-white/20'}
                    `}
                  >
                    <motion.div
                      animate={{ x: visualizerEnabled ? 24 : 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      className="absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg"
                    />
                  </button>
                </div>
              </div>

              {/* Large Controls Toggle */}
              <div className="mb-8">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-1">Large Controls Mode</h3>
                    <p className="text-sm text-white/60">CarPlay-style large player controls</p>
                  </div>
                  <button
                    onClick={toggleLargeControls}
                    className={`
                      relative w-14 h-8 rounded-full transition-colors
                      ${largeControls ? 'bg-purple-500' : 'bg-white/20'}
                    `}
                  >
                    <motion.div
                      animate={{ x: largeControls ? 24 : 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      className="absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg"
                    />
                  </button>
                </div>
              </div>

              {/* Autoplay Toggle */}
              <div className="mb-8">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-1">Autoplay Last Station</h3>
                    <p className="text-sm text-white/60">Automatically play last station on startup</p>
                  </div>
                  <button
                    onClick={() => setAutoplayLastStation(!autoplayLastStation)}
                    className={`
                      relative w-14 h-8 rounded-full transition-colors
                      ${autoplayLastStation ? 'bg-purple-500' : 'bg-white/20'}
                    `}
                  >
                    <motion.div
                      animate={{ x: autoplayLastStation ? 24 : 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      className="absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg"
                    />
                  </button>
                </div>
              </div>

              {/* Startup View Selector */}
              <div className="mb-8">
                <h3 className="text-lg font-semibold text-white mb-4">Startup View</h3>
                <div className="space-y-2">
                  {startupViews.map((view) => (
                    <button
                      key={view.value}
                      onClick={() => setStartupView(view.value)}
                      className={`
                        w-full px-4 py-3 rounded-xl border-2 text-left transition-all
                        ${
                          startupView === view.value
                            ? 'border-purple-500 bg-purple-500/20 text-white'
                            : 'border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10'
                        }
                      `}
                    >
                      {view.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* EQ Presets */}
              <div className="mb-8">
                <h3 className="text-lg font-semibold text-white mb-4">Equalizer Preset</h3>
                <select
                  value={audio.eqPreset}
                  onChange={(e) => setEqPreset(e.target.value as EqPreset)}
                  className="w-full px-4 py-3 rounded-xl border-2 border-white/10 bg-white/5 text-white focus:outline-none focus:border-purple-500 focus:bg-white/10"
                >
                  {eqPresets.map((preset) => (
                    <option key={preset.value} value={preset.value} className="bg-slate-900">
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Normalization Toggle */}
              <div className="mb-8">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-1">Volume Normalization</h3>
                    <p className="text-sm text-white/60">Normalize audio levels across stations</p>
                  </div>
                  <button
                    onClick={toggleNormalization}
                    className={`
                      relative w-14 h-8 rounded-full transition-colors
                      ${audio.normalizationEnabled ? 'bg-purple-500' : 'bg-white/20'}
                    `}
                  >
                    <motion.div
                      animate={{ x: audio.normalizationEnabled ? 24 : 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      className="absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg"
                    />
                  </button>
                </div>
              </div>

              {/* Location & Weather Section */}
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-white mb-4">Location & Weather</h3>

                {/* Use Device Location Toggle */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h4 className="text-base font-semibold text-white mb-1">Use Device Location</h4>
                      <p className="text-sm text-white/60">Automatically detect your location for weather</p>
                    </div>
                    <button
                      onClick={() => {
                        const newValue = !useDeviceLocation;
                        setUseDeviceLocation(newValue);
                        if (newValue && locationPermission === 'unknown') {
                          // Request permission when toggling on
                          if (navigator.geolocation) {
                            navigator.geolocation.getCurrentPosition(
                              (position) => {
                                setFallbackLocation(
                                  fallbackLocation.city,
                                  position.coords.latitude,
                                  position.coords.longitude
                                );
                                setLocationPermission('granted');
                              },
                              () => {
                                setLocationPermission('denied');
                              }
                            );
                          }
                        }
                      }}
                      disabled={locationPermission === 'denied'}
                      className={`
                        relative w-14 h-8 rounded-full transition-colors
                        ${useDeviceLocation && locationPermission !== 'denied' ? 'bg-purple-500' : 'bg-white/20'}
                        ${locationPermission === 'denied' ? 'opacity-50 cursor-not-allowed' : ''}
                      `}
                    >
                      <motion.div
                        animate={{ x: useDeviceLocation && locationPermission !== 'denied' ? 24 : 0 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        className="absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg"
                      />
                    </button>
                  </div>

                  {/* Permission Status */}
                  {locationPermission === 'denied' && (
                    <div className="mt-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                      <p className="text-sm text-yellow-400/80">
                        Location permission denied. Enable location in your browser settings to use automatic location.
                      </p>
                    </div>
                  )}
                </div>

                {/* Manual Fallback Location */}
                <div className="space-y-3">
                  <h4 className="text-base font-semibold text-white">Manual Fallback Location</h4>
                  
                  <div>
                    <label className="block text-sm text-white/70 mb-1">City</label>
                    <input
                      type="text"
                      value={manualCity}
                      onChange={(e) => setManualCity(e.target.value)}
                      className="w-full px-4 py-2 rounded-xl border-2 border-white/10 bg-white/5 text-white focus:outline-none focus:border-purple-500 focus:bg-white/10"
                      placeholder="City name"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm text-white/70 mb-1">Latitude</label>
                      <input
                        type="number"
                        step="any"
                        value={manualLat}
                        onChange={(e) => setManualLat(e.target.value)}
                        className="w-full px-4 py-2 rounded-xl border-2 border-white/10 bg-white/5 text-white focus:outline-none focus:border-purple-500 focus:bg-white/10"
                        placeholder="51.1967"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-white/70 mb-1">Longitude</label>
                      <input
                        type="number"
                        step="any"
                        value={manualLon}
                        onChange={(e) => setManualLon(e.target.value)}
                        className="w-full px-4 py-2 rounded-xl border-2 border-white/10 bg-white/5 text-white focus:outline-none focus:border-purple-500 focus:bg-white/10"
                        placeholder="0.2733"
                      />
                    </div>
                  </div>

                  <button
                    onClick={async () => {
                      let lat = manualLat ? Number.parseFloat(manualLat) : null;
                      let lon = manualLon ? Number.parseFloat(manualLon) : null;
                      const cityName = manualCity || '';

                      // If city is provided but no coordinates, geocode it
                      if (cityName && (lat === null || lon === null || Number.isNaN(lat) || Number.isNaN(lon))) {
                        setIsGeocoding(true);
                        const coords = await geocodeCity(cityName);
                        if (coords) {
                          lat = coords.lat;
                          lon = coords.lon;
                          setManualLat(lat.toString());
                          setManualLon(lon.toString());
                        } else {
                          alert('Could not find coordinates for that city. Please enter coordinates manually.');
                          setIsGeocoding(false);
                          return;
                        }
                        setIsGeocoding(false);
                      }

                      setFallbackLocation(cityName, lat, lon);
                      // Temperature component will auto-refresh via useEffect
                    }}
                    disabled={isGeocoding}
                    className="w-full px-4 py-3 rounded-xl bg-purple-500 hover:bg-purple-600 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isGeocoding ? 'Looking up location...' : 'Save Location'}
                  </button>
                </div>
              </div>

              {/* AI Visual Feedback Toggle */}
              <div className="mb-8">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-1">AI Visual Feedback</h3>
                    <p className="text-sm text-white/60">Show animated AI status orb and toast messages</p>
                  </div>
                  <button
                    onClick={() => setAIVisualFeedback(!aiVisualFeedback)}
                    className={`
                      relative w-14 h-8 rounded-full transition-colors
                      ${aiVisualFeedback ? 'bg-purple-500' : 'bg-white/20'}
                    `}
                  >
                    <motion.div
                      animate={{ x: aiVisualFeedback ? 24 : 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      className="absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg"
                    />
                  </button>
                </div>
              </div>

              {/* TTS Provider Info */}
              <div className="mb-8">
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-white mb-1">Text-to-Speech</h3>
                  <p className="text-sm text-white/60">
                    Using Murf AI Gen 2 with professional male radio host voice (en-UK-theo).
                  </p>
                </div>
              </div>

              {/* Enhanced Offline Voice Section */}
              <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-1">Enhanced Offline Voice (Free)</h3>
                    <p className="text-sm text-white/60">
                      Downloads a small offline neural voice once, then works without Internet
                    </p>
                  </div>
                  <button
                    onClick={() => setEnhancedOfflineVoice(!enhancedOfflineVoice)}
                    className={`
                      relative w-14 h-8 rounded-full transition-colors
                      ${enhancedOfflineVoice ? 'bg-purple-500' : 'bg-white/20'}
                    `}
                  >
                    <motion.div
                      animate={{ x: enhancedOfflineVoice ? 24 : 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      className="absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg"
                    />
                  </button>
                </div>

                {enhancedOfflineVoice && (
                  <div className="mt-4 p-4 bg-white/5 border border-white/10 rounded-xl">
                    {isModelReady ? (
                      <div className="flex items-center gap-2 text-green-400">
                        <div className="w-2 h-2 bg-green-400 rounded-full" />
                        <span className="text-sm font-medium">Ready for offline use</span>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm text-white/70">
                          Download the voice model (~24-25MB) to enable offline high-quality speech.
                        </p>
                        {isDownloadingModel ? (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm text-white/70">
                              <span>Downloading model...</span>
                              <span>{Math.round(downloadProgress)}%</span>
                            </div>
                            <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                              <motion.div
                                className="h-full bg-purple-500"
                                initial={{ width: 0 }}
                                animate={{ width: `${downloadProgress}%` }}
                                transition={{ duration: 0.3 }}
                              />
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={handleDownloadModel}
                            className="w-full px-4 py-2 rounded-xl bg-purple-500 hover:bg-purple-600 text-white font-medium transition-colors"
                          >
                            Download Voice Model
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
