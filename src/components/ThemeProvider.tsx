import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useSettingsStore } from '../store/settingsStore';
import type { RadioStation } from '../types/station';

interface ThemeProviderProps {
  children: React.ReactNode;
  currentStation?: RadioStation | null;
}

export function ThemeProvider({ children, currentStation }: ThemeProviderProps) {
  const { theme } = useSettingsStore();
  const dynamicColorRef = useRef<string>('#6366f1'); // Default purple
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Extract vibrant color from station logo for dynamic theme
  useEffect(() => {
    if (theme !== 'dynamic' || !currentStation) {
      return;
    }

    const extractColor = async () => {
      try {
        // Calculate logo URL
        const params = new URLSearchParams();
        if (currentStation.homepage) params.set('url', currentStation.homepage);
        if (currentStation.favicon) params.set('fallback', currentStation.favicon);
        if (currentStation.id) params.set('stationId', currentStation.id);
        if (currentStation.domain) params.set('discoveryId', currentStation.domain);
        if (currentStation.name) params.set('stationName', currentStation.name);
        const logoSrc = `/api/logo?${params.toString()}`;

        // Create canvas for color extraction
        if (!canvasRef.current) {
          canvasRef.current = document.createElement('canvas');
          canvasRef.current.width = 100;
          canvasRef.current.height = 100;
        }

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Load image
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const pixels = imageData.data;

          // Extract vibrant colors (skip transparent/very dark pixels)
          const colors: { r: number; g: number; b: number; brightness: number }[] = [];
          for (let i = 0; i < pixels.length; i += 16) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            const a = pixels[i + 3];

            if (a > 128) {
              const brightness = (r + g + b) / 3;
              if (brightness > 50) {
                colors.push({ r, g, b, brightness });
              }
            }
          }

          if (colors.length > 0) {
            // Find the most vibrant color (high saturation)
            let maxSaturation = 0;
            let vibrantColor = colors[0];

            colors.forEach((color) => {
              const max = Math.max(color.r, color.g, color.b);
              const min = Math.min(color.r, color.g, color.b);
              const saturation = max === 0 ? 0 : (max - min) / max;

              if (saturation > maxSaturation && color.brightness > 100) {
                maxSaturation = saturation;
                vibrantColor = color;
              }
            });

            const colorHex = `#${vibrantColor.r.toString(16).padStart(2, '0')}${vibrantColor.g.toString(16).padStart(2, '0')}${vibrantColor.b.toString(16).padStart(2, '0')}`;
            dynamicColorRef.current = colorHex;

            // Update CSS variable
            document.documentElement.style.setProperty('--dynamic-theme-color', colorHex);
          }
        };
        img.onerror = () => {
          // Fallback to default color on error
          document.documentElement.style.setProperty('--dynamic-theme-color', '#6366f1');
        };
        img.src = logoSrc;
      } catch (error) {
        console.error('Failed to extract color from logo:', error);
      }
    };

    extractColor();
  }, [theme, currentStation]);

  // Apply theme classes to root element
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark', 'theme-oled', 'theme-dynamic');
    root.classList.add(`theme-${theme}`);

    // Set CSS variables for dynamic theme
    if (theme === 'dynamic') {
      root.style.setProperty('--dynamic-theme-color', dynamicColorRef.current);
    } else {
      root.style.removeProperty('--dynamic-theme-color');
    }
  }, [theme]);

  return (
    <motion.div
      key={theme}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className={`theme-${theme}`}
    >
      {children}
    </motion.div>
  );
}

