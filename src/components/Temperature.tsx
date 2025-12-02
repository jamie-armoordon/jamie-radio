import { useState, useEffect, useRef } from 'react';
import { Thermometer } from 'lucide-react';
import { useSettingsStore } from '../store/settingsStore';
import { getApiBasePath } from '../config/api';

type WeatherState = 'loading' | 'getting-location' | 'location-denied' | 'unavailable' | 'ready';

export default function Temperature() {
  const [temperature, setTemperature] = useState<number | null>(null);
  const [locationName, setLocationName] = useState<string>('');
  const [weatherState, setWeatherState] = useState<WeatherState>('loading');
  const hasRequestedPermissionRef = useRef(false);

  const {
    useDeviceLocation,
    fallbackLocation,
    locationPermission,
    setFallbackLocation,
    setLocationPermission,
  } = useSettingsStore();

  const fetchWeather = async (lat: number | null, lon: number | null, city: string) => {
    try {
      setWeatherState('loading');
      const params = new URLSearchParams();
      if (lat !== null && lon !== null) {
        params.set('lat', lat.toString());
        params.set('lon', lon.toString());
      }
      if (city) {
        params.set('city', city);
      }

      const response = await fetch(`${getApiBasePath()}/weather?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        if (data.temperature !== null && data.temperature !== undefined) {
          setTemperature(data.temperature);
          setLocationName(data.location || city);
          setWeatherState('ready');
        } else {
          setWeatherState('unavailable');
        }
      } else {
        setWeatherState('unavailable');
      }
    } catch (error) {
      console.error('Failed to fetch temperature:', error);
      setWeatherState('unavailable');
    }
  };

  const requestGeolocation = () => {
    if (!navigator.geolocation) {
      setLocationPermission('denied');
      return;
    }

    if (hasRequestedPermissionRef.current) {
      return;
    }

    hasRequestedPermissionRef.current = true;
    setWeatherState('getting-location');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        
        // Save coordinates to settings
        const cityName = fallbackLocation.city || 'Current Location';
        setFallbackLocation(cityName, lat, lon);
        setLocationPermission('granted');
        
        // Fetch weather with coordinates
        fetchWeather(lat, lon, cityName);
      },
      (error) => {
        console.error('Geolocation error:', error);
        setLocationPermission('denied');
        setWeatherState('location-denied');
        
        // Use fallback location if available, otherwise show unavailable
        if (fallbackLocation.lat !== null && fallbackLocation.lon !== null) {
          fetchWeather(fallbackLocation.lat, fallbackLocation.lon, fallbackLocation.city || 'Custom Location');
        } else {
          setWeatherState('unavailable');
          setTemperature(null);
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000, // 5 minutes
      }
    );
  };

  useEffect(() => {
    // Reset permission request flag when useDeviceLocation changes
    if (!useDeviceLocation) {
      hasRequestedPermissionRef.current = false;
    }
  }, [useDeviceLocation]);

  useEffect(() => {
    // Auto-refresh weather when settings change
    // On first visit, request permission if useDeviceLocation is true
    if (useDeviceLocation && locationPermission === 'unknown') {
      requestGeolocation();
    } else if (useDeviceLocation && locationPermission === 'granted' && fallbackLocation.lat !== null && fallbackLocation.lon !== null) {
      fetchWeather(fallbackLocation.lat, fallbackLocation.lon, fallbackLocation.city || 'Current Location');
    } else if (fallbackLocation.lat !== null && fallbackLocation.lon !== null) {
      // Use fallback location if set
      fetchWeather(fallbackLocation.lat, fallbackLocation.lon, fallbackLocation.city || 'Custom Location');
    } else {
      // No location available - don't fetch weather
      setWeatherState('unavailable');
      setTemperature(null);
    }

    // Refresh every 5 minutes
    const interval = setInterval(() => {
      if (useDeviceLocation && locationPermission === 'granted' && fallbackLocation.lat !== null && fallbackLocation.lon !== null) {
        fetchWeather(fallbackLocation.lat, fallbackLocation.lon, fallbackLocation.city || 'Current Location');
      } else if (fallbackLocation.lat !== null && fallbackLocation.lon !== null) {
        fetchWeather(fallbackLocation.lat, fallbackLocation.lon, fallbackLocation.city || 'Custom Location');
      }
      // If no location available, don't refresh
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useDeviceLocation, fallbackLocation.lat, fallbackLocation.lon, fallbackLocation.city, locationPermission]);

  // Show UI states
  if (weatherState === 'getting-location') {
    return (
      <div className="flex items-center gap-1.5">
        <Thermometer className="h-3.5 w-3.5 text-blue-400/80 animate-pulse" />
        <span className="text-xs text-white/60 whitespace-nowrap">Getting location…</span>
      </div>
    );
  }

  if (weatherState === 'location-denied') {
    return (
      <div className="flex items-center gap-1.5">
        <Thermometer className="h-3.5 w-3.5 text-yellow-400/80" />
        <span className="text-xs text-white/60 whitespace-nowrap hidden lg:inline">
          Location denied — using fallback
        </span>
      </div>
    );
  }

  if (weatherState === 'unavailable' || temperature === null) {
    return (
      <div className="flex items-center gap-1.5">
        <Thermometer className="h-3.5 w-3.5 text-red-400/80" />
        <span className="text-xs text-white/60 whitespace-nowrap hidden lg:inline">
          Weather unavailable
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Thermometer className="h-3.5 w-3.5 text-blue-400/80" />
      <span className="text-sm font-medium text-white/80 whitespace-nowrap">
        {temperature}°C
      </span>
      <span className="text-xs text-white/40 hidden lg:inline">{locationName}</span>
    </div>
  );
}
