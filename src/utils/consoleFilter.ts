/**
 * Console Filter for Development
 * Filters out known noisy errors that are expected and handled gracefully
 */

if (import.meta.env.DEV) {
  const ignored = [
    'ERR_NAME_NOT_RESOLVED',
    'CORS error',
    'net::ERR_',
  ];

  const originalError = console.error;
  const originalWarn = console.warn;

  console.error = (...args: any[]) => {
    const message = String(args[0] || '');
    if (ignored.some(msg => message.includes(msg))) {
      return; // Suppress this error
    }
    originalError(...args);
  };

  console.warn = (...args: any[]) => {
    const message = String(args[0] || '');
    if (ignored.some(msg => message.includes(msg))) {
      return; // Suppress this warning
    }
    originalWarn(...args);
  };
}

