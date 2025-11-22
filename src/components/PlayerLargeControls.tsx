import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, Volume2, VolumeX, Loader2 } from 'lucide-react';
import type { RadioStation } from '../types/station';
import { useStationMetadata } from '../hooks/useStationMetadata';

interface PlayerLargeControlsProps {
  station: RadioStation | null;
  isPlaying: boolean;
  isLoading: boolean;
  volume: number;
  isMuted: boolean;
  onPlay: () => void;
  onPause: () => void;
  onVolumeChange: (volume: number) => void;
  onMuteToggle: () => void;
}

export default function PlayerLargeControls({
  station,
  isPlaying,
  isLoading,
  volume,
  isMuted,
  onPlay,
  onPause,
  onVolumeChange,
  onMuteToggle,
}: PlayerLargeControlsProps) {
  const { data: metadata } = useStationMetadata(station?.id || null, station?.name || null);

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

  if (!station) return null;

  return (
    <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center z-50">
      {/* Extra-large Station Logo */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
        className="mb-8"
      >
        {metadata?.artwork_url ? (
          <img
            src={`/api/artwork?url=${encodeURIComponent(metadata.artwork_url)}`}
            alt={metadata.title || station.name}
            className="w-64 h-64 md:w-80 md:h-80 rounded-3xl object-cover shadow-2xl bg-slate-800"
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
            className="w-64 h-64 md:w-80 md:h-80 rounded-3xl object-contain bg-slate-800/50 p-8 shadow-2xl"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
            }}
          />
        ) : (
          <div className="w-64 h-64 md:w-80 md:h-80 rounded-3xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center text-white text-6xl md:text-7xl font-bold shadow-2xl">
            {station.name.charAt(0)}
          </div>
        )}
      </motion.div>

      {/* Simplified Metadata */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="text-center mb-12 max-w-2xl px-6"
      >
        {metadata && (metadata.title || metadata.artist) && metadata.is_song ? (
          <>
            <div className="text-white font-semibold text-2xl md:text-3xl mb-2">
              {station.name} — Now Playing: {metadata.title || 'Unknown Title'}
            </div>
            <div className="text-white/70 text-xl md:text-2xl mb-4">
              {metadata.artist || station.name}
            </div>
          </>
        ) : null}
        <div className="text-white font-bold text-3xl md:text-4xl">{station.name}</div>
      </motion.div>

      {/* 3× Normal Size Play/Pause Button */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="mb-12"
      >
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={isPlaying ? onPause : onPlay}
          className={`
            w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center shadow-2xl transition-all
            ${
              isPlaying
                ? 'bg-white text-slate-900 hover:bg-gray-100'
                : 'bg-gradient-to-br from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500'
            }
          `}
        >
          {isLoading ? (
            <Loader2 size={64} className="animate-spin" />
          ) : isPlaying ? (
            <Pause size={64} fill="currentColor" />
          ) : (
            <Play size={64} fill="currentColor" className="ml-2" />
          )}
        </motion.button>
      </motion.div>

      {/* Large Volume Slider */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.4 }}
        className="flex items-center gap-4 bg-white/5 rounded-full px-6 py-4 border border-white/10 w-full max-w-md"
      >
        <button
          onClick={onMuteToggle}
          className="text-white/70 hover:text-white transition-colors"
        >
          {isMuted || volume === 0 ? <VolumeX size={28} /> : <Volume2 size={28} />}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={isMuted ? 0 : volume}
          onChange={(e) => {
            onVolumeChange(Number.parseFloat(e.target.value));
          }}
          className="flex-1 h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-purple-500 hover:accent-purple-400"
        />
      </motion.div>
    </div>
  );
}

