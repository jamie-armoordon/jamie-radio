import useSWR from 'swr';

export interface StationMetadata {
  station_id?: string;
  title: string | null;
  artist: string | null;
  artwork_url: string | null;
  is_song: boolean;
}

interface UseStationMetadataReturn {
  data: StationMetadata | null;
  loading: boolean;
  error: Error | null;
}

const fetcher = async (url: string): Promise<StationMetadata> => {
  console.log('Fetching metadata from:', url);
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error('Metadata fetch failed:', response.status, response.statusText);
      throw new Error(`Failed to fetch metadata: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('Metadata received:', data);
    return data;
  } catch (error) {
    console.error('Metadata fetch error:', error);
    throw error;
  }
};

export function useStationMetadata(stationId: string | null, stationName?: string | null): UseStationMetadataReturn {
  const url = stationId 
    ? `/api/metadata?stationId=${encodeURIComponent(stationId)}${stationName ? `&stationName=${encodeURIComponent(stationName)}` : ''}`
    : null;
    
  // Use stationId+stationName as key to ensure immediate re-fetch when station changes
  // This prevents metadata fetch from hitting the previous station after a play command
  const { data, error, isLoading } = useSWR<StationMetadata>(
    url,
    fetcher,
    {
      refreshInterval: 30000, // Poll every 30 seconds
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      errorRetryCount: 3,
      errorRetryInterval: 5000,
      // Dedupe requests within 100ms to prevent race conditions from rapid station changes
      // Ensures metadata always corresponds to the station just played, not a stale previous station
      dedupingInterval: 100,
    }
  );

  return {
    data: data || null,
    loading: isLoading,
    error: error || null,
  };
}
