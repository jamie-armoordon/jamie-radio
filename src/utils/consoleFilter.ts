/**
 * Console Filter for Development
 * Filters out verbose logs and keeps only important information
 */

if (import.meta.env.DEV) {
  // Patterns to completely suppress
  const suppressedPatterns = [
    // Network errors (expected and handled)
    'ERR_NAME_NOT_RESOLVED',
    'CORS error',
    'net::ERR_',
    'ConnectTimeoutError',
    'AbortError',
    'fetch failed',
    
    // ONNX Runtime harmless warnings
    'Unknown CPU vendor',
    
    // Verbose service logs (but allow StreamManager for debugging stream resolution)
    // '[StreamManager]', - Allow this for debugging stream URL resolution
    // 'StreamManager', - Allow this
    // 'streammanager', - Allow this
    'Upgraded HTTP to HTTPS',
    'Upgraded Global stream URL',
    
    // Verbose station loading logs (only exact matches, not partial)
    // Removed - too aggressive, blocking important logs
    
    // Component verbose logs
    'ukstations',
    'stationcard',
    '[StationCard]',
    'Temperature',
    'Weather',
    '[Player] Autoplay blocked',
    'Failed to load volume preference',
    'Failed to save volume preference',
    'Geocoding error',
    'Geolocation error',
    'Failed to fetch temperature',
    'Failed to load cached stations',
    'Failed to create audio visualizer',
    
    // WebSocket verbose logs (but allow important ones)
    // 'WebSocket closed', - Allow this
    // 'Wake word detector started', - Allow this
    // 'Failed to parse WebSocket message', - Allow this
    
    // React DevTools
    'Download the React DevTools',
    
    // Vite (but allow important connection logs)
    // '[vite]', - Allow this for debugging
    
    // Browser warnings (expected and handled)
    'Unable to preventDefault inside passive event listener',
    'passive event listener',
  ];

  const originalError = console.error;
  const originalWarn = console.warn;
  const originalLog = console.log;
  const originalInfo = console.info;

  // Important prefixes that should NEVER be suppressed
  const importantPrefixes: (string | RegExp)[] = [
    '[WakeWord]',
    '[VoiceControl]',
    '[voiceFeedback]',
    '[Player]',
    '[App]',
    '[getUKStations]',
    '[radioBrowser]',
    '[RadioBrowserClient]',
    '[StreamManager]',
    '[Cache]',
    '[Error]',
    '[Warning]',
    '[Info]',
    '[Success]',
    '[Critical]',
    // TTS and audio pipeline logs
    '[Murf WS Client]',
    '[Murf WS Proxy]',
    '[AI Audio API]',
    '[Timer:',  // Timer logs with session IDs
    // Timestamp patterns (HH:mm:ss.SSS format)
    /\[\d{2}:\d{2}:\d{2}\.\d{3}\]/,  // Regex for timestamp pattern
  ];

  const shouldSuppress = (...args: any[]): boolean => {
    const allMessages = args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg || '');
        }
      }
      return String(arg || '');
    }).join(' ');
    
    const message = allMessages.toLowerCase();
    const messageOriginal = allMessages; // Keep original case for regex matching
    
    // NEVER suppress logs with important prefixes (check both lowercase and original case)
    for (const prefix of importantPrefixes) {
      if (typeof prefix === 'string') {
        if (message.includes(prefix.toLowerCase()) || messageOriginal.includes(prefix)) {
          return false;
        }
      } else if (prefix instanceof RegExp) {
        // Handle regex patterns
        try {
          if (prefix.test(messageOriginal)) {
            return false;
          }
        } catch (e) {
          // Invalid regex, skip
        }
      }
    }
    
    // Check if any suppressed pattern matches (only if not important)
    return suppressedPatterns.some(pattern => {
      const regex = new RegExp(pattern.toLowerCase().replace(/\*/g, '.*'));
      return regex.test(message);
    });
  };

  // Show logs - only suppress known verbose patterns
  console.log = (...args: any[]) => {
    if (shouldSuppress(...args)) {
      return;
    }
    originalLog(...args);
  };

  // Always show warnings unless explicitly suppressed
  console.warn = (...args: any[]) => {
    if (shouldSuppress(...args)) {
      return;
    }
    originalWarn(...args);
  };

  // Always show errors unless explicitly suppressed
  console.error = (...args: any[]) => {
    if (shouldSuppress(...args)) {
      return;
    }
    originalError(...args);
  };

  console.info = (...args: any[]) => {
    if (shouldSuppress(...args)) {
      return;
    }
    originalInfo(...args);
  };

  console.debug = () => {
    // Suppress all debug logs in dev
    return;
  };
}
