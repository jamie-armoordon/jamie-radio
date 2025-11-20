import { motion } from 'framer-motion';
import type { RadioStation } from '../types/station';
import StationCard from './StationCard';
import { Radio } from 'lucide-react';

interface StationListProps {
  stations: RadioStation[];
  currentStation: RadioStation | null;
  isPlaying: boolean;
  onStationSelect: (station: RadioStation) => void;
}

export default function StationList({ stations, currentStation, isPlaying, onStationSelect }: StationListProps) {
  if (stations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-white/50">
        <Radio size={48} className="mb-4 opacity-50" />
        <p className="text-xl font-medium">No stations found</p>
        <p className="text-sm mt-2">Try adjusting your filters</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6 pb-32">
      {stations.map((station, index) => (
        <motion.div
          key={station.stationuuid}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
        >
          <StationCard
            station={station}
            isPlaying={isPlaying && currentStation?.stationuuid === station.stationuuid}
            onPlay={() => onStationSelect(station)}
          />
        </motion.div>
      ))}
    </div>
  );
}

