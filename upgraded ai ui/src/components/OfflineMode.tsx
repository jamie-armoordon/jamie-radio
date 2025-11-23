import { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import type { RadioStation } from '../types/station';
import { useStationHistory } from '../hooks/useStationHistory';
import StationCard from './StationCard';

interface OfflineModeProps {
  onStationSelect: (station: RadioStation) => void;
  isPlaying: boolean;
  currentStation: RadioStation | null;
}

export default function OfflineMode({ onStationSelect, isPlaying, currentStation }: OfflineModeProps) {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [cachedStations, setCachedStations] = useState<RadioStation[]>([]);
  const { recentStations, getLastPlayed } = useStationHistory();

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Load cached stations
    try {
      const cached = localStorage.getItem('jamie_radio_stations_cache');
      if (cached) {
        const parsed = JSON.parse(cached) as RadioStation[];
        setCachedStations(parsed);
      }
    } catch (error) {
      console.error('Failed to load cached stations:', error);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!isOffline) return null;

  const lastPlayed = getLastPlayed();
  const stationsToShow = cachedStations.length > 0 ? cachedStations : recentStations;

  return (
    <div className="fixed inset-0 z-[200] bg-slate-950/95 backdrop-blur-xl flex flex-col items-center justify-center p-6">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-8">
          <WifiOff className="w-16 h-16 mx-auto mb-4 text-yellow-400/80" />
          <h2 className="text-3xl font-bold text-white mb-2">Offline Mode</h2>
          <p className="text-white/60">You're currently offline. Here are your cached stations.</p>
        </div>

        {lastPlayed && (
          <div className="mb-8">
            <h3 className="text-xl font-semibold text-white mb-4">Last Played</h3>
            <StationCard
              station={lastPlayed}
              isPlaying={isPlaying}
              onPlay={() => onStationSelect(lastPlayed)}
            />
          </div>
        )}

        {stationsToShow.length > 0 && (
          <div>
            <h3 className="text-xl font-semibold text-white mb-4">
              {cachedStations.length > 0 ? 'Cached Stations' : 'Recent Stations'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {stationsToShow.slice(0, 12).map((station) => (
                <StationCard
                  key={station.stationuuid}
                  station={station}
                  isPlaying={isPlaying && currentStation?.stationuuid === station.stationuuid}
                  onPlay={() => onStationSelect(station)}
                />
              ))}
            </div>
          </div>
        )}

        {stationsToShow.length === 0 && (
          <div className="text-center text-white/60">
            <p>No cached stations available.</p>
            <p className="text-sm mt-2">Connect to the internet to load stations.</p>
          </div>
        )}
      </div>
    </div>
  );
}
