export interface RadioStation {
  id?: string; // Internal station ID (e.g., 'capital_london', 'bbc_radio_one')
  changeuuid: string;
  stationuuid: string;
  name: string;
  url: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  domain?: string; // Domain for Clearbit logo lookup
  tags: string;
  country: string;
  countrycode: string;
  state: string;
  language: string;
  languagecodes: string;
  votes: number;
  lastchangetime: string;
  codec: string;
  bitrate: number;
  hls: number;
  lastcheckok: number;
  lastchecktime: string;
  lastcheckoktime: string;
  lastlocalchecktime: string;
  clicktimestamp: string;
  clickcount: number;
  clicktrend: number;
  ssl_error: number;
  geo_lat: string;
  geo_long: string;
  has_extended_info: boolean;
}

export interface StationFilters {
  countrycode?: string;
  state?: string;
  minBitrate?: number;
  has_extended_info?: boolean;
}

