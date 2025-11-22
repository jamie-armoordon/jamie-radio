export function speakResponse(text: string): void {
  if (!('speechSynthesis' in window)) {
    console.warn('Speech synthesis not supported');
    return;
  }

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-GB';
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  // Use default voice or find a UK English voice
  const voices = window.speechSynthesis.getVoices();
  const ukVoice = voices.find(
    (voice) => voice.lang.startsWith('en-GB') || voice.lang.startsWith('en-UK')
  );
  if (ukVoice) {
    utterance.voice = ukVoice;
  }

  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

// Load voices when available (some browsers need this)
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    // Voices loaded
  };
}

