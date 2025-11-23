declare module 'node-vad' {
  export const Mode: {
    NORMAL: number;
    LOW_BITRATE: number;
    AGGRESSIVE: number;
    VERY_AGGRESSIVE: number;
  };

  export const Event: {
    ERROR: number;
    SILENCE: number;
    VOICE: number;
    NOISE: number;
  };

  export default class VAD {
    static Mode: typeof Mode;
    static Event: typeof Event;
    constructor(mode?: number);
    processAudio(samples: Buffer, samplerate: number): Promise<number>;
    processAudioFloat(samples: Buffer, samplerate: number): Promise<number>;
    static createStream(options: {
      mode?: number;
      audioFrequency?: number;
      debounceTime?: number;
    }): any;
  }
}

