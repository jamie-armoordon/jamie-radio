import { motion } from 'framer-motion';
import { useState, useEffect, useMemo, useRef } from 'react';
import type { RadioStation } from '../types/station';
import { Play, Pause, Signal } from 'lucide-react';

interface StationCardProps {
  station: RadioStation;
  isPlaying: boolean;
  onPlay: () => void;
}

export default function StationCard({ station, isPlaying, onPlay }: StationCardProps) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  
  // Calculate logo source - use backend API for all logo resolution
  // Backend will discover homepage dynamically using RadioBrowser -> DuckDuckGo
  const logoSrc = useMemo(() => {
    const params = new URLSearchParams();
    
    // Primary: Use stationName for dynamic homepage discovery
    if (station.name) {
      params.set('stationName', station.name);
    }
    
    // Optional: Pass existing homepage if available (for faster resolution)
    if (station.homepage?.trim()) {
      const homepage = station.homepage.trim();
      const badValues = ["0", "/", "http://", "https://", "unknown", "none"];
      if (!badValues.includes(homepage.toLowerCase())) {
        params.set('url', homepage);
      }
    }
    
    // Optional: Pass favicon as fallback image URL
    if (station.favicon?.trim()) {
      params.set('fallback', station.favicon.trim());
    }
    
    // Optional: Pass stationId for special rules (BBC/Global/Bauer)
    if (station.id) {
      params.set('stationId', station.id);
    }
    
    const logoUrl = `/api/logo?${params.toString()}`;
    return logoUrl;
  }, [station.name, station.homepage, station.favicon, station.id]);
  
  
  // Reset error state when station changes
  useEffect(() => {
    setImgError(false);
    setImgLoaded(false);
  }, [station.stationuuid]);
  
  // Check if image is already loaded from cache (onLoad might not fire for cached images)
  useEffect(() => {
    if (!logoSrc || !imgRef.current) return;
    
    const img = imgRef.current;
    
    // Check if image is already loaded (cached images might not fire onLoad)
    if (img.complete && img.naturalWidth > 0 && !imgLoaded) {
      setImgLoaded(true);
    }
  }, [logoSrc, station.name, imgLoaded]);
  
  // Debug: Log when logoSrc changes to verify it's being set
  useEffect(() => {
    if (logoSrc) {
    }
  }, [logoSrc, station.name]);
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02, y: -4 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className={`
        group relative overflow-hidden rounded-2xl p-5 cursor-pointer transition-all duration-300
        ${
          isPlaying
            ? "bg-white/20 border-white/40 shadow-[0_0_30px_rgba(168,85,247,0.4)]"
            : "bg-white/10 border-white/10 hover:bg-white/15 hover:border-white/20 hover:shadow-xl"
        }
        border backdrop-blur-md
      `}
      onClick={onPlay}
    >
      <div className="flex items-start gap-5">
        {/* Station Icon */}
        <div className="relative flex-shrink-0">
          <div
            className={`
            relative w-20 h-20 rounded-xl overflow-hidden shadow-lg transition-transform duration-300
            ${isPlaying ? "scale-105 ring-2 ring-purple-400 ring-offset-2 ring-offset-transparent" : ""}
          `}
          >
            {logoSrc && !imgError ? (
              <>
                <img
                  ref={imgRef}
                  key={`${station.stationuuid}-${logoSrc}`}
                  src={logoSrc}
                  alt={station.name}
                  className={`w-full h-full object-contain p-4 bg-white/5 transition-opacity duration-300 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    console.warn(`[StationCard] Image failed to load for ${station.name}:`, {
                      logoSrc,
                      currentSrc: target.src,
                      naturalWidth: target.naturalWidth,
                      naturalHeight: target.naturalHeight,
                      complete: target.complete
                    });
                    setImgError(true);
                  }}
                  onLoad={() => {
                    setImgLoaded(true);
                  }}
                  onLoadStart={() => {
                  }}
                  loading="eager"
                  referrerPolicy="no-referrer"
                />
                {!imgLoaded && (
                  <div className="absolute inset-0 bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center text-white text-3xl font-bold">
                    {station.name.charAt(0).toUpperCase()}
                  </div>
                )}
              </>
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center text-white text-3xl font-bold">
                {station.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          {/* Playing Indicator Overlay */}
          {isPlaying && (
            <div className="absolute -bottom-2 -right-2 bg-green-500 text-white p-1.5 rounded-full shadow-lg animate-bounce">
              <Signal size={14} />
            </div>
          )}
        </div>

        {/* Station Info */}
        <div className="flex-1 min-w-0 flex flex-col justify-center h-20">
          <h3 className="text-white font-bold text-xl mb-1 truncate leading-tight tracking-tight">{station.name}</h3>

          <div className="flex items-center gap-3 text-white/60 text-sm mb-2">
            {station.state && <span className="flex items-center gap-1 truncate">{station.state}</span>}
            {station.bitrate > 0 && (
              <span className="px-2 py-0.5 bg-white/10 rounded-md text-xs font-medium text-white/80">
                {station.bitrate}k
              </span>
            )}
          </div>

          {/* Tags - Only show first 2 on mobile/card to keep it clean */}
          {station.tags && (
            <div className="flex flex-wrap gap-1.5">
              {station.tags
                .split(",")
                .slice(0, 2)
                .map((tag, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 bg-purple-500/20 border border-purple-500/20 text-purple-200 text-xs rounded-full capitalize"
                  >
                    {tag.trim()}
                  </span>
                ))}
            </div>
          )}
        </div>

        {/* Play Button - Always visible but highlighted on hover/active */}
        <div
          className={`
          flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300
          ${
            isPlaying
              ? "bg-white text-purple-900 shadow-lg scale-110"
              : "bg-white/10 text-white group-hover:bg-white group-hover:text-purple-900"
          }
        `}
        >
          {isPlaying ? (
            <Pause size={24} fill="currentColor" />
          ) : (
            <Play size={24} fill="currentColor" className="ml-1" />
          )}
        </div>
      </div>
    </motion.div>
  );
}
