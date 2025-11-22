import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
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
    setTheme,
    toggleVisualizer,
    toggleLargeControls,
    setAutoplayLastStation,
    setStartupView,
    setEqPreset,
    toggleNormalization,
  } = useSettingsStore();

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
              <div className="mb-4">
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
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

