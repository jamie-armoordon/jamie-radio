# iRadio - High Quality Internet Radio Player

A modern, feature-rich web application for streaming UK radio stations with real-time metadata, beautiful UI, and seamless audio playback.

![React](https://img.shields.io/badge/React-19.2.0-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7.2.2-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.1.17-38B2AC?logo=tailwind-css&logoColor=white)

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [API Documentation](#api-documentation)
- [Contributing](#contributing)
- [Testing](#testing)
- [License](#license)
- [Contact & Support](#contact--support)

## Features

- 🎵 **UK Radio Station Streaming** - Stream hundreds of UK radio stations with high-quality audio
- 🔍 **Search Functionality** - Search stations by name, genre, or tags
- 📻 **Recently Played** - Quick access to your recently played stations
- 🎶 **Real-time Metadata** - Display current song, artist, and artwork information
- 🌤️ **Weather Widget** - Real-time weather information display
- 🕐 **Clock Widget** - Live clock display in the header
- 🖼️ **Station Logo Discovery** - Automatic logo fetching and caching
- 📡 **HLS Streaming Support** - Seamless HLS (HTTP Live Streaming) playback via HLS.js
- 🔊 **Volume Control** - Adjustable volume with mute functionality
- 🖥️ **Fullscreen Player Mode** - Immersive fullscreen playback experience
- 💾 **LocalStorage Caching** - Intelligent caching of station data for faster load times
- 🎨 **Modern UI** - Beautiful gradient backgrounds and smooth animations powered by Framer Motion

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher recommended)
- **npm** (v9 or higher) or **yarn**
- A modern web browser with audio support (Chrome, Firefox, Safari, Edge)

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd iRadio
```

2. Install dependencies:

```bash
npm install
```

3. The project is now ready to use! See the [Usage](#usage) section for running the application.

## Usage

### Development Mode

The application consists of two parts: a frontend React app and a backend API server. You can run them separately or together.

#### Run Frontend Only

```bash
npm run dev
```

This starts the Vite development server on `http://localhost:3000`. Note: Some features (like logo fetching and metadata) require the API server to be running.

#### Run API Server Only

```bash
npm run dev:api
```

This starts the Express API server on `http://localhost:3001`.

#### Run Both (Recommended)

```bash
npm run dev:all
```

This runs both the frontend and API server concurrently using `concurrently`. The frontend will be available at `http://localhost:3000` and will automatically proxy API requests to the backend server.

### Production Build

1. Build the application:

```bash
npm run build
```

This compiles TypeScript and creates an optimized production build in the `dist` directory.

2. Preview the production build:

```bash
npm run preview
```

This serves the production build locally for testing.

### Accessing the Application

- **Frontend**: `http://localhost:3000`
- **API Server**: `http://localhost:3001`
- **API Health Check**: `http://localhost:3001/api/health`

## Configuration

### Vite Configuration

The Vite configuration (`vite.config.ts`) is set up with:

- **Port**: 3000 (frontend)
- **Proxy**: `/api/*` requests are proxied to `http://localhost:3001`
- **Host**: `true` (allows access from other devices on the network)

### API Server Configuration

The API server (`api-server.ts`) runs on:

- **Port**: 3001
- **CORS**: Enabled for cross-origin requests

### Station Configuration

Station metadata and configuration can be found in `src/config/stations.ts`. This file contains:

- Station IDs and names
- Network information (BBC, Bauer, Global, etc.)
- Location data (London, Kent, National)
- Discovery IDs for logo and metadata lookup

### Environment Variables

No environment variables are required for local development. The application uses:

- RadioBrowser API (public, no key required)
- Weather API (configured in `api/weather.ts`)
- Clearbit logo API (public, no key required)

## Project Structure

```
iRadio/
├── api/                      # Express API server routes and utilities
│   ├── _utils/              # API utility functions
│   │   ├── cache.ts         # Caching utilities
│   │   ├── domain.ts        # Domain extraction
│   │   ├── fetchImage.ts    # Image fetching
│   │   ├── googleFavicon.ts # Google favicon service
│   │   ├── homepageDiscovery.ts # Homepage discovery
│   │   ├── htmlIcons.ts     # HTML icon parsing
│   │   ├── ogImage.ts       # Open Graph image extraction
│   │   └── parallel.ts       # Parallel request utilities
│   ├── artwork.ts           # Artwork proxy endpoint
│   ├── logo.ts              # Logo discovery endpoint
│   ├── metadata.ts          # Real-time metadata endpoint
│   ├── radiobrowser.ts      # RadioBrowser API wrapper
│   └── weather.ts            # Weather data endpoint
├── api-server.ts            # Express API server entry point
├── cache/                   # Cached data files
│   └── logos.json           # Logo cache
├── dist/                    # Production build output
├── public/                   # Static assets
├── scripts/                 # Build and generation scripts
│   └── generate-station-config.ts
├── src/
│   ├── components/          # React components
│   │   ├── Clock.tsx        # Clock widget
│   │   ├── Player.tsx       # Audio player component
│   │   ├── StationCard.tsx  # Station card display
│   │   ├── StationList.tsx  # Station list component
│   │   └── Temperature.tsx # Weather widget
│   ├── config/              # Configuration files
│   │   └── stations.ts      # Station metadata registry
│   ├── hooks/               # Custom React hooks
│   │   ├── useStationHistory.ts    # Station history management
│   │   └── useStationMetadata.ts   # Metadata fetching hook
│   ├── lib/                 # Utility libraries
│   │   └── utils.ts         # General utilities
│   ├── services/            # Service layer
│   │   ├── bbcStreams.ts    # BBC stream handling
│   │   ├── playlistParser.ts # Playlist parsing
│   │   ├── radioBrowser.ts  # RadioBrowser API client
│   │   ├── radioFeeds.ts    # Radio feed handling
│   │   ├── radioplayer.ts   # RadioPlayer API client
│   │   ├── streamManager.ts # Stream URL management
│   │   └── ukStations.ts   # UK stations service
│   ├── types/               # TypeScript type definitions
│   │   ├── radioplayer.ts   # RadioPlayer API types
│   │   └── station.ts       # Station data types
│   ├── utils/               # Utility functions
│   │   └── consoleFilter.ts # Console error filtering
│   ├── App.tsx              # Main application component
│   ├── main.tsx             # Application entry point
│   └── style.css            # Global styles
├── index.html               # HTML template
├── package.json             # Dependencies and scripts
├── postcss.config.js        # PostCSS configuration
├── tailwind.config.js       # Tailwind CSS configuration
├── tsconfig.json            # TypeScript configuration
└── vite.config.ts           # Vite configuration
```

## API Documentation

The API server provides the following endpoints:

### `/api/logo`

Fetches station logos using multiple discovery methods.

**Query Parameters:**
- `url` (optional) - Station homepage URL
- `fallback` (optional) - Fallback favicon URL
- `stationId` (optional) - Internal station ID
- `discoveryId` (optional) - Domain for logo discovery
- `stationName` (optional) - Station name for fallback

**Response:** Redirects to logo image URL or Google favicon service

**Example:**
```bash
GET /api/logo?url=https://www.bbc.co.uk&stationId=bbc_radio_one
```

### `/api/metadata`

Fetches real-time song metadata for a station.

**Query Parameters:**
- `stationId` (required) - Internal station ID
- `stationName` (optional) - Station name

**Response:**
```json
{
  "title": "Song Title",
  "artist": "Artist Name",
  "artwork_url": "https://example.com/artwork.jpg",
  "is_song": true
}
```

**Example:**
```bash
GET /api/metadata?stationId=bbc_radio_one&stationName=BBC Radio 1
```

### `/api/radiobrowser`

Wrapper for RadioBrowser API requests. Proxies requests to the RadioBrowser API.

**Query Parameters:** Any RadioBrowser API parameters

**Response:** RadioBrowser API response

**Example:**
```bash
GET /api/radiobrowser?name=BBC&countrycode=GB
```

### `/api/artwork`

Proxies artwork images to avoid CORS issues.

**Query Parameters:**
- `url` (required) - Artwork image URL

**Response:** Image data

**Example:**
```bash
GET /api/artwork?url=https://example.com/artwork.jpg
```

### `/api/weather`

Fetches weather information.

**Query Parameters:** Location parameters (configured in `api/weather.ts`)

**Response:** Weather data JSON

**Example:**
```bash
GET /api/weather
```

### `/api/health`

Health check endpoint.

**Response:**
```json
{
  "ok": true,
  "time": "2024-01-01T00:00:00.000Z"
}
```

## Contributing

Contributions are welcome! Please follow these guidelines:

### Code Style

- Use TypeScript with strict mode enabled
- Follow React best practices and hooks patterns
- Use functional components with hooks
- Maintain consistent naming conventions (camelCase for variables, PascalCase for components)
- Use Tailwind CSS for styling
- Add comments for complex logic

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Ensure the code compiles without errors (`npm run build`)
5. Test your changes locally
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

### Code Structure

- Keep components small and focused
- Extract reusable logic into custom hooks
- Place API-related code in the `services/` directory
- Use TypeScript interfaces for type safety
- Follow the existing project structure

## Testing

Currently, this project does not include automated tests. Manual testing is performed during development.

### Manual Testing Checklist

- [ ] Station streaming works correctly
- [ ] Search functionality filters stations properly
- [ ] Recently played stations are saved and restored
- [ ] Metadata displays correctly for supported stations
- [ ] Logo fetching works for various stations
- [ ] Volume control functions properly
- [ ] Fullscreen mode works as expected
- [ ] API endpoints return correct responses
- [ ] Caching works correctly

### Future Testing

Consider adding:
- Unit tests for utility functions
- Integration tests for API endpoints
- Component tests for React components
- E2E tests for critical user flows

## License

This project is private and does not currently specify a license. All rights reserved.

## Contact & Support

- **Issues**: Open an issue on the repository
- **Questions**: Open an issue with the `question` label

For bug reports, please include:
- Browser and version
- Steps to reproduce
- Expected vs. actual behavior
- Console errors (if any)

---

Built with ❤️ using React, TypeScript, and Vite

