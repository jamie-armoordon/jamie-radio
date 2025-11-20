import { useState, useEffect } from 'react';
import { Thermometer } from 'lucide-react';

export default function Temperature() {
  const [temperature, setTemperature] = useState<number | null>(null);

  useEffect(() => {
    const fetchTemperature = async () => {
      try {
        const response = await fetch('/api/weather');
        if (response.ok) {
          const data = await response.json();
          if (data.temperature !== null && data.temperature !== undefined) {
            setTemperature(data.temperature);
          }
        }
      } catch (error) {
        console.error('Failed to fetch temperature:', error);
      }
    };

    fetchTemperature();
    // Refresh every 5 minutes
    const interval = setInterval(fetchTemperature, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (temperature === null) return null;

  return (
    <div className="flex items-center gap-1.5">
      <Thermometer className="h-3.5 w-3.5 text-blue-400/80" />
      <span className="text-sm font-medium text-white/80 whitespace-nowrap">
        {temperature}°C
      </span>
      <span className="text-xs text-white/40 hidden lg:inline">Tonbridge</span>
    </div>
  );
}

