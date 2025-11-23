import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'oled' | 'dynamic';
export type StartupView = 'home' | 'favourites' | 'largeControls';
export type EqPreset = 'flat' | 'bass' | 'treble' | 'voice';
export type LocationPermission = 'unknown' | 'granted' | 'denied';
export type TTSProvider = 'murf'; // Only Murf AI is supported

interface AudioSettings {
  eqPreset: EqPreset;
  normalizationEnabled: boolean;
}

interface FallbackLocation {
  city: string;
  lat: number | null;
  lon: number | null;
}

interface SettingsState {
  theme: Theme;
  visualizerEnabled: boolean;
  largeControls: boolean;
  autoplayLastStation: boolean;
  startupView: StartupView;
  audio: AudioSettings;
  useDeviceLocation: boolean;
  fallbackLocation: FallbackLocation;
  locationPermission: LocationPermission;
  enhancedOfflineVoice: boolean;
  aiVisualFeedback: boolean;
  ttsProvider: TTSProvider;
}

interface SettingsActions {
  setTheme: (theme: Theme) => void;
  toggleVisualizer: () => void;
  toggleLargeControls: () => void;
  setAutoplayLastStation: (enabled: boolean) => void;
  setStartupView: (view: StartupView) => void;
  setEqPreset: (preset: EqPreset) => void;
  toggleNormalization: () => void;
  setUseDeviceLocation: (value: boolean) => void;
  setFallbackLocation: (city: string, lat: number | null, lon: number | null) => void;
  setLocationPermission: (status: LocationPermission) => void;
  setEnhancedOfflineVoice: (enabled: boolean) => void;
  setAIVisualFeedback: (enabled: boolean) => void;
  setTTSProvider: (provider: TTSProvider) => void;
}

type SettingsStore = SettingsState & SettingsActions;

const defaultState: SettingsState = {
  theme: 'dark',
  visualizerEnabled: false,
  largeControls: false,
  autoplayLastStation: false,
  startupView: 'home',
  audio: {
    eqPreset: 'flat',
    normalizationEnabled: false,
  },
  useDeviceLocation: true,
  fallbackLocation: {
    city: '',
    lat: null,
    lon: null,
  },
  locationPermission: 'unknown',
  enhancedOfflineVoice: false,
  aiVisualFeedback: true,
      ttsProvider: 'murf' as TTSProvider,
};

// No need to load API keys anymore

export const useSettingsStore = create<SettingsStore>()(
  persist(
    subscribeWithSelector((set) => ({
      ...defaultState,
      setTheme: (theme) => set({ theme }),
      toggleVisualizer: () => set((state) => ({ visualizerEnabled: !state.visualizerEnabled })),
      toggleLargeControls: () => set((state) => ({ largeControls: !state.largeControls })),
      setAutoplayLastStation: (enabled) => set({ autoplayLastStation: enabled }),
      setStartupView: (view) => set({ startupView: view }),
      setEqPreset: (preset) => set((state) => ({ audio: { ...state.audio, eqPreset: preset } })),
      toggleNormalization: () =>
        set((state) => ({
          audio: { ...state.audio, normalizationEnabled: !state.audio.normalizationEnabled },
        })),
      setUseDeviceLocation: (value) => set({ useDeviceLocation: value }),
      setFallbackLocation: (city, lat, lon) =>
        set({
          fallbackLocation: {
            city,
            lat,
            lon,
          },
        }),
      setLocationPermission: (status) => set({ locationPermission: status }),
      setEnhancedOfflineVoice: (enabled) => {
        set({ enhancedOfflineVoice: enabled });
        // Update TTS manager
        import('../services/ttsManager').then(({ ttsManager }) => {
          ttsManager.setEnhancedOfflineVoice(enabled);
        });
      },
      setAIVisualFeedback: (enabled) => set({ aiVisualFeedback: enabled }),
      setTTSProvider: (provider) => set({ ttsProvider: provider }),
    })),
    {
      name: 'jamie_radio_settings',
      partialize: (state) => ({
        theme: state.theme,
        visualizerEnabled: state.visualizerEnabled,
        largeControls: state.largeControls,
        autoplayLastStation: state.autoplayLastStation,
        startupView: state.startupView,
        audio: state.audio,
        useDeviceLocation: state.useDeviceLocation,
        fallbackLocation: state.fallbackLocation,
        locationPermission: state.locationPermission,
        enhancedOfflineVoice: state.enhancedOfflineVoice,
        aiVisualFeedback: state.aiVisualFeedback,
        ttsProvider: state.ttsProvider,
      }),
    }
  )
);
