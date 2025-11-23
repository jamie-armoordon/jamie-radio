/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RADIOPLAYER_API_KEY?: string;
  readonly VITE_WAKE_WORD_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
