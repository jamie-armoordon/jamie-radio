import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'oled' | 'dynamic';
export type StartupView = 'home' | 'favourites' | 'largeControls';
export type EqPreset = 'flat' | 'bass' | 'treble' | 'voice';

interface AudioSettings {
  eqPreset: EqPreset;
  normalizationEnabled: boolean;
}

interface SettingsState {
  theme: Theme;
  visualizerEnabled: boolean;
  largeControls: boolean;
  autoplayLastStation: boolean;
  startupView: StartupView;
  audio: AudioSettings;
}

interface SettingsActions {
  setTheme: (theme: Theme) => void;
  toggleVisualizer: () => void;
  toggleLargeControls: () => void;
  setAutoplayLastStation: (enabled: boolean) => void;
  setStartupView: (view: StartupView) => void;
  setEqPreset: (preset: EqPreset) => void;
  toggleNormalization: () => void;
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
};

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
      }),
    }
  )
);

