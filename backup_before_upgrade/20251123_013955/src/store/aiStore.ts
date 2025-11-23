import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export type AIPhase =
  | 'idle'           // nothing happening
  | 'listening'      // wake word enabled and mic active
  | 'wake_detected'  // wake word hit (brief celebratory state)
  | 'recording'      // 3s command capture
  | 'processing'     // waiting for /api/ai-audio
  | 'executing'      // app is applying command
  | 'speaking'       // TTS output is playing
  | 'error';         // any failure

export interface AICommand {
  command: string;
  station?: string;
  action?: string;
  text?: string;
  error?: string;
}

export interface InteractionLogEntry {
  timestamp: number;
  phase: AIPhase;
  wakeScore?: number;
  command?: AICommand;
  spokenText?: string;
  error?: string;
}

interface AIState {
  phase: AIPhase;
  lastWakeScore?: number;
  lastWakeAt?: number;
  lastCommand?: AICommand;
  error?: string;
  interactionLog: InteractionLogEntry[];
  wakeWordEnabled: boolean;
}

interface AIActions {
  setPhase: (phase: AIPhase) => void;
  setWakeDetected: (score?: number) => void;
  setProcessing: () => void;
  setExecuting: (cmd: AICommand) => void;
  setSpeaking: (on: boolean) => void;
  setError: (msg: string) => void;
  resetError: () => void;
  setWakeWordEnabled: (enabled: boolean) => void;
  addToLog: (entry: Omit<InteractionLogEntry, 'timestamp'>) => void;
}

type AIStore = AIState & AIActions;

const MAX_LOG_ENTRIES = 20;

export const useAIStore = create<AIStore>()(
  subscribeWithSelector((set, get) => ({
    phase: 'idle',
    lastWakeScore: undefined,
    lastWakeAt: undefined,
    lastCommand: undefined,
    error: undefined,
    interactionLog: [],
    wakeWordEnabled: false,

    setPhase: (phase) => {
      const currentPhase = get().phase;
      // Guard: prevent invalid transitions
      if (currentPhase === phase) return;
      
      // Guard: don't allow overlapping phases (except error can interrupt)
      if (phase !== 'error' && currentPhase !== 'idle' && currentPhase !== 'error' && currentPhase !== 'listening') {
        console.warn(`[AIStore] Invalid phase transition: ${currentPhase} → ${phase}`);
        return;
      }

      set({ phase });
      
      // Auto-transitions
      if (phase === 'wake_detected') {
        // Transition to recording after 800-1200ms
        const delay = 800 + Math.random() * 400; // 800-1200ms
        setTimeout(() => {
          if (get().phase === 'wake_detected') {
            set({ phase: 'recording' });
          }
        }, delay);
      } else if (phase === 'error') {
        // Auto-return to listening after 2-3s if wake word enabled
        const delay = 2000 + Math.random() * 1000; // 2-3s
        setTimeout(() => {
          const state = get();
          if (state.phase === 'error' && state.wakeWordEnabled) {
            set({ phase: 'listening', error: undefined });
          } else if (state.phase === 'error') {
            set({ phase: 'idle', error: undefined });
          }
        }, delay);
      }
    },

    setWakeDetected: (score) => {
      const now = Date.now();
      set({
        phase: 'wake_detected',
        lastWakeScore: score,
        lastWakeAt: now,
      });
      get().addToLog({
        phase: 'wake_detected',
        wakeScore: score,
      });
    },

    setProcessing: () => {
      set({ phase: 'processing' });
    },

    setExecuting: (cmd) => {
      set({
        phase: 'executing',
        lastCommand: cmd,
      });
      get().addToLog({
        phase: 'executing',
        command: cmd,
      });
    },

    setSpeaking: (on) => {
      if (on) {
        set({ phase: 'speaking' });
      } else {
        // Return to listening if wake word enabled, otherwise idle
        const state = get();
        if (state.wakeWordEnabled) {
          set({ phase: 'listening' });
        } else {
          set({ phase: 'idle' });
        }
      }
    },

    setError: (msg) => {
      set({
        phase: 'error',
        error: msg,
      });
      get().addToLog({
        phase: 'error',
        error: msg,
      });
    },

    resetError: () => {
      const state = get();
      if (state.wakeWordEnabled) {
        set({ phase: 'listening', error: undefined });
      } else {
        set({ phase: 'idle', error: undefined });
      }
    },

    setWakeWordEnabled: (enabled) => {
      set({ wakeWordEnabled: enabled });
      if (!enabled && get().phase !== 'idle') {
        // If disabling, transition to idle (unless speaking)
        const currentPhase = get().phase;
        if (currentPhase !== 'speaking') {
          set({ phase: 'idle' });
        }
      }
    },

    addToLog: (entry) => {
      const log = get().interactionLog;
      const newEntry: InteractionLogEntry = {
        ...entry,
        timestamp: Date.now(),
      };
      const updatedLog = [newEntry, ...log].slice(0, MAX_LOG_ENTRIES);
      set({ interactionLog: updatedLog });
    },
  }))
);

