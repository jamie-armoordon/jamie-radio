import { useState, useEffect, useCallback } from 'react';
import type { RadioStation } from '../types/station';

const HISTORY_STORAGE_KEY = 'jamie_radio_history';
const LAST_PLAYED_STORAGE_KEY = 'jamie_radio_last_played';
const LAST_PLAYING_STATE_KEY = 'jamie_radio_last_playing';
const MAX_HISTORY = 8;

export function useStationHistory() {
  const [recentStations, setRecentStations] = useState<RadioStation[]>([]);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as RadioStation[];
        setRecentStations(parsed);
      }
    } catch (err) {
      console.error('Failed to load station history:', err);
    }
  }, []);

  const addToHistory = useCallback((station: RadioStation, isPlaying: boolean = false) => {
    setRecentStations((prev) => {
      // Remove the station if it already exists (deduplicate)
      const filtered = prev.filter((s) => s.stationuuid !== station.stationuuid);
      
      // Add to the front
      const updated = [station, ...filtered];
      
      // Limit to MAX_HISTORY items
      const limited = updated.slice(0, MAX_HISTORY);
      
      // Save to localStorage
      try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(limited));
        localStorage.setItem(LAST_PLAYED_STORAGE_KEY, JSON.stringify(station));
        localStorage.setItem(LAST_PLAYING_STATE_KEY, JSON.stringify(isPlaying));
      } catch (err) {
        console.error('Failed to save station history:', err);
      }
      
      return limited;
    });
  }, []);

  const getLastPlayed = useCallback((): RadioStation | null => {
    try {
      const stored = localStorage.getItem(LAST_PLAYED_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored) as RadioStation;
      }
    } catch (err) {
      console.error('Failed to load last played station:', err);
    }
    return null;
  }, []);

  const getLastPlayingState = useCallback((): boolean => {
    try {
      const stored = localStorage.getItem(LAST_PLAYING_STATE_KEY);
      if (stored) {
        return JSON.parse(stored) as boolean;
      }
    } catch (err) {
      console.error('Failed to load last playing state:', err);
    }
    return false;
  }, []);

  return {
    recentStations,
    addToHistory,
    getLastPlayed,
    getLastPlayingState,
  };
}

