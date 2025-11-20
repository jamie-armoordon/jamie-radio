import { useState, useEffect, useMemo } from 'react';
import type { RadioStation } from '../types/station';

/**
 * Hook to resolve station logo using backend API
 * The backend /api/logo endpoint handles all resolution strategies and returns a 307 redirect
 * This hook simply constructs the API URL - the browser will follow the redirect automatically
 */
export function useStationLogo(station: RadioStation | null): { logoSrc: string | undefined; isLoading: boolean } {
  const [isLoading, setIsLoading] = useState(false);

  // Construct logo URL using backend API
  const logoSrc = useMemo(() => {
    if (!station) return undefined;

    // Priority 1: Manual config override (if exists)
    if (station.logoUrl && !station.logoUrl.includes('ichef.bbci.co.uk') && !station.logoUrl.includes('upload.wikimedia.org')) {
      return station.logoUrl;
    }

    // Build API URL with all available metadata for better resolution
    const params = new URLSearchParams();
    
    // Normalize homepage
    let homepage = station.homepage?.trim() || '';
    const badValues = ['0', '/', 'http://', 'https://', 'unknown', 'none'];
    if (badValues.includes(homepage.toLowerCase())) homepage = '';
    
    // Build from domain if no homepage
    if (!homepage && station.domain) {
      homepage = `https://${station.domain}`;
    }
    
    if (homepage) params.set('url', homepage);
    if (station.favicon) params.set('fallback', station.favicon);
    if (station.id) params.set('stationId', station.id);
    if (station.domain) params.set('discoveryId', station.domain);
    if (station.name) params.set('stationName', station.name);

    // Backend handles all resolution - just return the API URL
    return `/api/logo?${params.toString()}`;
  }, [station?.stationuuid, station?.logoUrl, station?.homepage, station?.favicon, station?.domain, station?.id, station?.name]);

  // Reset loading state when station changes
  useEffect(() => {
    setIsLoading(false);
  }, [station?.stationuuid]);

  return { logoSrc, isLoading };
}
