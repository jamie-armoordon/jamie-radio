// Radioplayer API types
export interface RadioplayerStation {
  id: string;
  name: string;
  shortName?: string;
  mediumName?: string;
  tagline?: string;
  description?: string;
  logo?: {
    url: string;
    size?: string;
  };
  streams: Array<{
    url: string;
    bitrate?: number;
    codec?: string;
    reliability?: number;
    status?: string;
  }>;
  location?: {
    country?: string;
    region?: string;
    city?: string;
    coordinates?: {
      lat: number;
      lon: number;
    };
  };
  genres?: string[];
  language?: string;
}

export interface RadioplayerSearchResponse {
  stations: RadioplayerStation[];
  total?: number;
}

