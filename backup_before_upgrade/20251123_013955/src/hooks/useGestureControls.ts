import { useRef, useCallback, useEffect } from 'react';

interface GestureControlsOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeDown?: () => void;
  onTwoFingerTap?: () => void;
  isFullscreen?: boolean;
  enabled?: boolean;
}

interface TouchState {
  startX: number;
  startY: number;
  startTime: number;
  isScrolling: boolean;
  scrollStartY: number;
}

interface TwoFingerState {
  touches: Array<{ x: number; y: number; time: number }>;
}

const SWIPE_THRESHOLD = 50; // Minimum distance in pixels
const SWIPE_VELOCITY_THRESHOLD = 0.3; // Minimum velocity for fast swipes
const TWO_FINGER_TIME_WINDOW = 100; // Milliseconds
const TWO_FINGER_DISTANCE = 50; // Maximum distance between touches
const SCROLL_THRESHOLD = 10; // Pixels to detect scrolling

export function useGestureControls({
  onSwipeLeft,
  onSwipeRight,
  onSwipeDown,
  onTwoFingerTap,
  isFullscreen = false,
  enabled = true,
}: GestureControlsOptions) {
  const touchStateRef = useRef<TouchState | null>(null);
  const twoFingerStateRef = useRef<TwoFingerState>({ touches: [] });
  const containerRef = useRef<HTMLElement | null>(null);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!enabled) return;

      const touches = Array.from(e.touches);
      
      // Two-finger tap detection
      if (touches.length === 2) {
        const now = Date.now();
        const touch1 = { x: touches[0].clientX, y: touches[0].clientY, time: now };
        const touch2 = { x: touches[1].clientX, y: touches[1].clientY, time: now };
        
        twoFingerStateRef.current.touches = [touch1, touch2];
        return;
      }

      // Single touch for swipe detection
      if (touches.length === 1) {
        const touch = touches[0];
        const scrollY = containerRef.current?.scrollTop || window.scrollY;
        
        touchStateRef.current = {
          startX: touch.clientX,
          startY: touch.clientY,
          startTime: Date.now(),
          isScrolling: false,
          scrollStartY: scrollY,
        };
      }
    },
    [enabled]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!enabled || !touchStateRef.current) return;

      const touches = Array.from(e.touches);
      
      // Two-finger tap: check if both touches are still within distance
      if (touches.length === 2 && twoFingerStateRef.current.touches.length === 2) {
        const touch1 = touches[0];
        const touch2 = touches[1];
        const original1 = twoFingerStateRef.current.touches[0];
        const original2 = twoFingerStateRef.current.touches[1];
        
        const dist1 = Math.hypot(touch1.clientX - original1.x, touch1.clientY - original1.y);
        const dist2 = Math.hypot(touch2.clientX - original2.x, touch2.clientY - original2.y);
        
        // If touches moved too far, cancel two-finger tap
        if (dist1 > TWO_FINGER_DISTANCE || dist2 > TWO_FINGER_DISTANCE) {
          twoFingerStateRef.current.touches = [];
        }
        return;
      }

      // Single touch swipe detection
      if (touches.length === 1 && touchStateRef.current) {
        const touch = touches[0];
        const deltaX = touch.clientX - touchStateRef.current.startX;
        const deltaY = touch.clientY - touchStateRef.current.startY;
        const currentScrollY = containerRef.current?.scrollTop || window.scrollY;
        const scrollDelta = Math.abs(currentScrollY - touchStateRef.current.scrollStartY);

        // Detect if user is scrolling
        if (scrollDelta > SCROLL_THRESHOLD) {
          touchStateRef.current.isScrolling = true;
        }

        // Prevent default if significant horizontal movement (to prevent page scroll)
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
          e.preventDefault();
        }
      }
    },
    [enabled]
  );

  const handleTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (!enabled) return;

      const touches = Array.from(e.changedTouches);
      
      // Two-finger tap detection
      if (twoFingerStateRef.current.touches.length === 2 && touches.length >= 1) {
        const now = Date.now();
        const timeDiff = now - twoFingerStateRef.current.touches[0].time;
        
        if (timeDiff < TWO_FINGER_TIME_WINDOW) {
          // Check if both touches ended
          if (e.touches.length === 0) {
            // Haptic feedback
            if (navigator.vibrate) {
              navigator.vibrate(10);
            }
            
            onTwoFingerTap?.();
            twoFingerStateRef.current.touches = [];
            return;
          }
        }
        twoFingerStateRef.current.touches = [];
      }

      // Single touch swipe detection
      if (!touchStateRef.current || touchStateRef.current.isScrolling) {
        touchStateRef.current = null;
        return;
      }

      const touch = touches[0];
      if (!touch) {
        touchStateRef.current = null;
        return;
      }

      const deltaX = touch.clientX - touchStateRef.current.startX;
      const deltaY = touch.clientY - touchStateRef.current.startY;
      const deltaTime = Date.now() - touchStateRef.current.startTime;
      const distance = Math.hypot(deltaX, deltaY);
      const velocity = distance / deltaTime;

      // Check if swipe meets threshold
      if (distance < SWIPE_THRESHOLD) {
        touchStateRef.current = null;
        return;
      }

      // Determine swipe direction
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      // Horizontal swipe (left or right)
      if (absX > absY && (velocity > SWIPE_VELOCITY_THRESHOLD || distance > SWIPE_THRESHOLD * 2)) {
        if (deltaX > 0) {
          // Swipe right - previous station
          if (navigator.vibrate) {
            navigator.vibrate(10);
          }
          onSwipeRight?.();
        } else {
          // Swipe left - next station
          if (navigator.vibrate) {
            navigator.vibrate(10);
          }
          onSwipeLeft?.();
        }
      }
      // Vertical swipe down (only in fullscreen)
      else if (deltaY > 0 && absY > absX && isFullscreen && (velocity > SWIPE_VELOCITY_THRESHOLD || distance > SWIPE_THRESHOLD * 2)) {
        if (navigator.vibrate) {
          navigator.vibrate(10);
        }
        onSwipeDown?.();
      }

      touchStateRef.current = null;
    },
    [enabled, isFullscreen, onSwipeLeft, onSwipeRight, onSwipeDown, onTwoFingerTap]
  );

  const setContainerRef = useCallback((element: HTMLElement | null) => {
    containerRef.current = element;
  }, []);

  // Set up event listeners with proper passive option
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    // touchmove needs passive: false to allow preventDefault
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [enabled, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return {
    setContainerRef,
  };
}

