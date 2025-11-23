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
    
    // Verbose service logs
    '[StreamManager]',
    'StreamManager',
    'streammanager',
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
  const importantPrefixes = [
    '[WakeWord]',
    '[VoiceControl]',
    '[voiceFeedback]',
    '[Player]',
    '[App]',
    '[getUKStations]',
    '[radioBrowser]',
    '[Cache]',
    '[Error]',
    '[Warning]',
    '[Info]',
    '[Success]',
    '[Critical]',
  ];

  const shouldSuppress = (...args: any[]): boolean => {
    const allMessages = args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg).toLowerCase();
        } catch {
          return String(arg || '').toLowerCase();
        }
      }
      return String(arg || '').toLowerCase();
    }).join(' ');
    
    const message = allMessages.toLowerCase();
    
    // NEVER suppress logs with important prefixes
    if (importantPrefixes.some(prefix => message.includes(prefix.toLowerCase()))) {
      return false;
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
