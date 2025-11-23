import { useState, useEffect, useRef } from 'react';

interface UseIdleTimeoutOptions {
  timeout: number;
  enabled?: boolean;
}

export function useIdleTimeout({ timeout, enabled = true }: UseIdleTimeoutOptions): boolean {
  const [isIdle, setIsIdle] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastInteractionRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!enabled) {
      setIsIdle(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }

    const resetTimer = () => {
      lastInteractionRef.current = Date.now();
      setIsIdle(false);
      
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      timeoutRef.current = setTimeout(() => {
        setIsIdle(true);
      }, timeout);
    };

    // Initial timer
    resetTimer();

    // Track user interactions with passive listeners for performance
    const events: (keyof WindowEventMap)[] = [
      'mousedown',
      'mousemove',
      'keydown',
      'scroll',
      'touchstart',
      'touchmove',
      'pointerdown',
      'pointermove',
      'wheel',
    ];

    events.forEach((event) => {
      window.addEventListener(event, resetTimer, { passive: true });
    });

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      events.forEach((event) => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, [timeout, enabled]);

  return isIdle;
}
