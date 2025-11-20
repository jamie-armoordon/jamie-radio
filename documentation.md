# Station Image/Icon URL Documentation

This document provides a comprehensive overview of how station image and icon URLs are gathered, stored, and used throughout the iRadio application.

## Table of Contents

1. [Overview](#overview)
2. [Data Sources](#data-sources)
3. [Data Gathering Process](#data-gathering-process)
4. [Data Storage](#data-storage)
5. [Image Resolution Strategy](#image-resolution-strategy)
6. [Usage in UI Components](#usage-in-ui-components)
7. [Caching Mechanisms](#caching-mechanisms)
8. [Fallback Chain](#fallback-chain)

---

## Overview

Station images/icons are handled through multiple fields in the `RadioStation` interface:
- **`favicon`**: Direct favicon URL from RadioBrowser API
- **`homepage`**: Station website URL used for logo scraping
- **`domain`**: Domain name for Clearbit logo lookup
- **`logoUrl`**: (Optional) Manual override URL for specific stations

The system uses a multi-tiered approach to resolve station logos, with automatic fallbacks when primary sources fail.

---

## Data Sources

### 1. RadioBrowser API

The primary source for station metadata including favicons and homepages.

**Location**: `src/services/radioBrowser.ts`

**Fields Retrieved**:
- `favicon`: Direct URL to station favicon (e.g., `https://example.com/favicon.ico`)
- `homepage`: Station website URL (e.g., `https://example.com`)

**API Endpoints Used**:
- `/json/stations/byuuid/{uuid}` - UUID-based lookup
- `/json/stations/search?name={name}` - Name-based search

**Example Response**:
```typescript
{
  favicon: "https://www.bbc.co.uk/favicon.ico",
  homepage: "https://www.bbc.co.uk/radio",
  // ... other fields
}
```

### 2. Station Configuration Metadata

Static configuration data for UK stations with domain information.

**Location**: `src/config/stations.ts`

**Fields Provided**:
- `domain`: Domain name for Clearbit logo lookup (e.g., `"kissfmuk.com"`)
- `uuid`: RadioBrowser UUID for API lookup
- `discovery_id`: Alternative identifier for station lookup

**Example**:
```typescript
{
  id: "kiss_london",
  name: "Kiss",
  domain: "kissfmuk.com",
  uuid: "abc123-def456-...",
  // ... other fields
}
```

---

## Data Gathering Process

### Step 1: Station Creation (`src/services/ukStations.ts`)

When creating a `RadioStation` from metadata, the system:

1. **Constructs homepage from domain** (if domain exists):
   ```typescript
   const homepage = metadata.domain ? `https://${metadata.domain}` : '';
   ```

2. **Fetches RadioBrowser data** to merge favicon and homepage:
   ```typescript
   // Priority 1: UUID-based lookup
   if (metadata.uuid) {
     apiData = await resolveStreamByUUID(metadata.uuid);
   }
   
   // Priority 2: Discovery ID search
   if (!apiData?.favicon && metadata.discovery_id) {
     apiData = await searchStationByName(metadata.discovery_id);
   }
   
   // Priority 3: Name-based search
   if (!apiData?.favicon) {
     apiData = await searchStationByName(metadata.name);
   }
   ```

3. **Merges data** with priority to API data:
   ```typescript
   return {
     homepage: apiData?.homepage || homepage, // Prefer API homepage
     favicon: apiData?.favicon || '',          // From RadioBrowser API
     domain: metadata.domain,                  // From config
     // ... other fields
   };
   ```

**Key Function**: `createStationFromMetadata()` at ```15:107:src/services/ukStations.ts```

### Step 2: RadioBrowser API Fetching (`src/services/radioBrowser.ts`)

The RadioBrowser service fetches station data with favicon information:

**Function**: `fetchStations()`
- Fetches stations from RadioBrowser API
- Includes `favicon` field in response
- Caches results in memory for 5 minutes

**Function**: `resolveStreamByUUID(uuid)`
- Looks up station by RadioBrowser UUID
- Returns station with `favicon` field if available

**Function**: `searchStationByName(name)`
- Searches stations by name
- Returns best match with `favicon` field
- Uses multiple matching strategies (exact, normalized, partial)

---

## Data Storage

### 1. In-Memory Storage

**RadioStation Objects** (`src/types/station.ts`):
```typescript
export interface RadioStation {
  favicon: string;      // Direct favicon URL
  homepage: string;     // Station website URL
  domain?: string;      // Domain for Clearbit lookup
  // ... other fields
}
```

**Location**: React state in `App.tsx`:
```typescript
const [stations, setStations] = useState<RadioStation[]>([]);
```

### 2. localStorage Caching

#### Station List Cache

**Key**: `iradio_stations_cache`
**Timestamp Key**: `iradio_stations_cache_timestamp`
**Duration**: 24 hours

**Location**: `src/App.tsx` - `loadStations()` function

**Stored Data**: Complete `RadioStation[]` array including:
- `favicon` URLs
- `homepage` URLs
- `domain` values

**Cache Validation**:
- Checks if >50% of stations are missing favicons
- If so, forces refresh to fetch favicons

**Code Reference**: ```129:237:src/App.tsx```

#### Logo URL Cache

**Key Format**: `station_logo_{stationuuid}`
**Duration**: Persistent (until cleared)

**Location**: `src/hooks/useStationLogo.ts`

**Stored Data**: Resolved logo URL from `/api/logo` endpoint

**Usage**: Prevents repeated API calls for the same station

**Code Reference**: ```36:44:src/hooks/useStationLogo.ts```

#### Station History Cache

**Key**: `iradio_history`
**Key**: `iradio_last_played`

**Stored Data**: Recent stations and last played station (includes favicon/homepage/domain)

**Location**: `src/hooks/useStationHistory.ts`

---

## Image Resolution Strategy

### Logo API Endpoint (`api/logo.ts`)

The `/api/logo` endpoint resolves station logos using multiple strategies:

**Endpoint**: `/api/logo?url={homepage}&fallback={favicon}`

**Strategy 1: OG Image Scraping**
1. Fetches the homepage HTML
2. Parses for `<meta property="og:image">` tag
3. Returns the OG image URL if found
4. Timeout: 2 seconds

**Strategy 2: Google S2 Favicon**
1. Extracts domain from homepage/fallback
2. Uses Google's favicon service:
   ```
   https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&url=https://{domain}&size=256
   ```

**Code Reference**: ```46:124:api/logo.ts```

### useStationLogo Hook (`src/hooks/useStationLogo.ts`)

Provides a React hook for resolving station logos with priority order:

**Priority Order**:
1. **Manual config** (`station.logoUrl`) - Highest priority
   - Skips known bad URLs (BBC ichef, Wikipedia)
2. **localStorage cache** - Check cached logo URL first
3. **API logo** (`/api/logo`) - Fetches from logo API
4. **Clearbit** - Only if API fails and domain exists
   - Tests if Clearbit is accessible (not blocked by ad-blocker)
   - URL: `https://logo.clearbit.com/{domain}`
5. **Favicon fallback** - Direct favicon URL

**Code Reference**: ```15:106:src/hooks/useStationLogo.ts```

### StationCard Component (`src/components/StationCard.tsx`)

Directly constructs logo URL without using the hook:

**Process**:
1. Validates and cleans `homepage` and `domain` fields
2. Removes garbage values: `["0", "/", "http://", "https://", "unknown", "none"]`
3. Builds homepage from domain if missing
4. Ensures homepage starts with `http`
5. Constructs API URL: `/api/logo?url={homepage}&fallback={favicon}`

**Code Reference**: ```17:43:src/components/StationCard.tsx```

**Error Handling**:
- Tracks image load errors with `imgError` state
- Falls back to gradient placeholder with station initial
- Shows loading placeholder while image loads

---

## Usage in UI Components

### 1. StationCard Component

**Location**: `src/components/StationCard.tsx`

**Image Display**:
- Uses `/api/logo` endpoint directly
- Shows station logo in 80x80px container
- Falls back to gradient placeholder with station initial

**Code Reference**: ```78:103:src/components/StationCard.tsx```

### 2. Player Component

**Location**: `src/components/Player.tsx`

**Image Priority**:
1. **Metadata artwork** (`metadata.artwork_url`) - Album art or track artwork
2. **Station favicon** (`station.favicon`) - Direct favicon URL
3. **Gradient placeholder** - Station initial

**Code Reference**: ```332:355:src/components/Player.tsx```

**Note**: Player uses favicon directly, not the logo API, as it prioritizes track artwork over station logos.

---

## Caching Mechanisms

### 1. Station List Cache

**Storage**: localStorage
**Key**: `iradio_stations_cache`
**Duration**: 24 hours
**Refresh Threshold**: 18 hours (background refresh)

**Contains**: Full `RadioStation[]` array with favicon/homepage/domain

**Validation**: Checks favicon coverage; refreshes if >50% missing

### 2. Logo URL Cache

**Storage**: localStorage
**Key Format**: `station_logo_{stationuuid}`
**Duration**: Persistent

**Contains**: Resolved logo URL from `/api/logo` endpoint

**Purpose**: Avoids repeated API calls for same station

### 3. In-Memory API Cache

**Storage**: Module-level variable
**Location**: `src/services/radioBrowser.ts`
**Duration**: 5 minutes

**Contains**: Raw RadioBrowser API responses

---

## Fallback Chain

### Complete Fallback Sequence

When displaying a station logo, the system follows this chain:

```
1. Manual logoUrl (if configured)
   ↓ (if not available or invalid)
2. Cached logo URL from localStorage
   ↓ (if not cached)
3. /api/logo endpoint
   ├─ OG Image scraping
   └─ Google S2 favicon
   ↓ (if API fails)
4. Clearbit logo service
   ↓ (if blocked or fails)
5. Direct favicon URL
   ↓ (if favicon fails)
6. Gradient placeholder with station initial
```

### Error Handling

**Image Load Errors**:
- `StationCard`: Sets `imgError` state, shows placeholder
- `Player`: Falls back to favicon, then placeholder
- All components: Graceful degradation to initial-based placeholder

**API Failures**:
- Logo API: Falls back to Clearbit or favicon
- RadioBrowser API: Silently fails, uses config data only
- Clearbit: Detects ad-blocker blocking, skips to favicon

---

## Data Flow Summary

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Station Creation (ukStations.ts)                        │
│    ├─ Config metadata (domain)                             │
│    └─ RadioBrowser API (favicon, homepage)                  │
│         └─ Merged into RadioStation object                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Storage                                                   │
│    ├─ React state (in-memory)                               │
│    ├─ localStorage (station list cache)                     │
│    └─ localStorage (logo URL cache)                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Image Resolution                                         │
│    ├─ StationCard: Direct /api/logo call                     │
│    └─ useStationLogo: Multi-tier resolution                 │
│         └─ /api/logo → Clearbit → Favicon                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Display                                                  │
│    ├─ StationCard: Logo in card                              │
│    └─ Player: Artwork/favicon in player                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Files Reference

- **Type Definition**: `src/types/station.ts`
- **Station Creation**: `src/services/ukStations.ts`
- **RadioBrowser API**: `src/services/radioBrowser.ts`
- **Logo API**: `api/logo.ts`
- **Logo Hook**: `src/hooks/useStationLogo.ts`
- **StationCard**: `src/components/StationCard.tsx`
- **Player**: `src/components/Player.tsx`
- **Caching**: `src/App.tsx` (loadStations function)
- **Config**: `src/config/stations.ts`

---

## Notes

1. **Favicon vs Logo**: The system distinguishes between favicons (small icons) and logos (larger brand images). The logo API attempts to fetch high-quality logos, falling back to favicons.

2. **BBC Stations**: Known issue with BBC ichef URLs - these are explicitly skipped in `useStationLogo` hook.

3. **Domain Extraction**: The logo API safely extracts domains from URLs, handling edge cases like invalid URLs.

4. **Cache Invalidation**: Station list cache is invalidated if >50% of stations are missing favicons, ensuring fresh data when favicon support is added.

5. **Network Resilience**: All API calls have timeouts and error handling to prevent UI blocking.
