# Jamie Radio - Deployment Documentation

## Project Overview

Jamie Radio is a modern, high-quality internet radio streaming application built with React, TypeScript, and Vite. The application provides a full-featured radio player with station discovery, metadata display, artwork fetching, and a responsive fullscreen player experience.

## Architecture

### Frontend
- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite 7
- **Styling**: Tailwind CSS 4
- **Animations**: Framer Motion
- **Audio**: HTML5 Audio API with HLS.js for HLS stream support
- **State Management**: React Hooks (useState, useEffect, custom hooks)

### Backend API
- **Runtime**: Node.js with Express (development) / Vercel Serverless Functions (production)
- **API Routes**: Serverless functions in `/api` directory
- **Caching**: In-memory cache with JSON file persistence (`cache/logos.json`)

### Key Features
- Real-time radio streaming with HLS support
- Station discovery via RadioBrowser API
- Dynamic logo and artwork fetching
- Metadata extraction (now playing information)
- Weather display for Tonbridge, UK
- Clock display
- Fullscreen player with swipe gestures
- MediaSession API integration for iOS devices
- Station history and favorites
- Responsive design for mobile, tablet, and desktop

## Project Structure

```
iRadio/
├── api/                    # Serverless API functions
│   ├── _utils/            # Shared utilities
│   │   ├── cache.ts       # Caching utilities
│   │   ├── domain.ts      # Domain extraction
│   │   ├── fetchImage.ts  # Image fetching
│   │   ├── googleFavicon.ts
│   │   ├── homepageDiscovery.ts
│   │   ├── htmlIcons.ts
│   │   ├── ogImage.ts
│   │   ├── parallel.ts
│   │   └── rules.ts
│   ├── artwork.ts         # Artwork proxy endpoint
│   ├── logo.ts            # Logo resolution endpoint
│   ├── metadata.ts        # Metadata extraction endpoint
│   ├── radiobrowser.ts    # RadioBrowser API wrapper
│   └── weather.ts         # Weather API endpoint
├── api-server.ts          # Express server for local development
├── cache/                 # Persistent cache storage
│   └── logos.json
├── public/                # Static assets
├── src/
│   ├── components/        # React components
│   │   ├── Clock.tsx
│   │   ├── Player.tsx
│   │   ├── StationCard.tsx
│   │   ├── StationList.tsx
│   │   └── Temperature.tsx
│   ├── config/
│   │   └── stations.ts    # Station configuration
│   ├── hooks/             # Custom React hooks
│   │   ├── useStationHistory.ts
│   │   ├── useStationLogo.ts
│   │   └── useStationMetadata.ts
│   ├── services/          # Business logic services
│   │   ├── bbcStreams.ts
│   │   ├── playlistParser.ts
│   │   ├── radioBrowser.ts
│   │   ├── radioFeeds.ts
│   │   ├── radioplayer.ts
│   │   └── streamManager.ts
│   ├── types/             # TypeScript type definitions
│   │   ├── radioplayer.ts
│   │   └── station.ts
│   ├── App.tsx            # Main application component
│   ├── main.tsx           # Application entry point
│   └── style.css          # Global styles
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.js
```

## Dependencies

### Production Dependencies
- `react` (^19.2.0) - React framework
- `react-dom` (^19.2.0) - React DOM renderer
- `framer-motion` (^12.23.24) - Animation library
- `hls.js` (^1.6.15) - HLS stream player
- `lucide-react` (^0.554.0) - Icon library
- `axios` (^1.13.2) - HTTP client
- `cheerio` (^1.1.2) - HTML parsing
- `swr` (^2.3.6) - Data fetching
- `clsx` (^2.1.1) - Conditional class names
- `tailwind-merge` (^3.4.0) - Tailwind class merging
- `express` (^4.21.2) - Web server (development only)
- `cors` (^2.8.5) - CORS middleware
- `ws` (^8.18.3) - WebSocket support
- `node-fetch` (^3.3.2) - Fetch API for Node.js

### Development Dependencies
- `typescript` (~5.9.3) - TypeScript compiler
- `vite` (^7.2.2) - Build tool
- `@vitejs/plugin-react` (^5.1.1) - Vite React plugin
- `tailwindcss` (^4.1.17) - CSS framework
- `@tailwindcss/postcss` (^4.1.17) - PostCSS plugin
- `@vercel/node` (^5.5.7) - Vercel serverless runtime
- `tsx` (^4.20.6) - TypeScript execution
- `concurrently` (^9.2.1) - Run multiple processes
- `autoprefixer` (^10.4.22) - CSS autoprefixer
- `postcss` (^8.5.6) - CSS processor

## API Endpoints

### `/api/logo`
Fetches station logos using multiple strategies:
- Clearbit logo service
- Google favicon service
- Open Graph images
- HTML favicon/icons
- Homepage discovery
- Special rules for known stations

**Query Parameters:**
- `url` (string, optional) - Station homepage URL
- `stationId` (string, optional) - Station identifier
- `stationName` (string, optional) - Station name
- `discoveryId` (string, optional) - Discovery identifier
- `fallback` (string, optional) - Fallback URL

**Response:** Redirects to logo image URL or returns JSON error

**Cache:** 1 day (86400 seconds)

### `/api/radiobrowser`
Proxies requests to RadioBrowser API for station discovery.

**Query Parameters:**
- All RadioBrowser API parameters are passed through

**Response:** JSON response from RadioBrowser API

### `/api/metadata`
Extracts now-playing metadata from various sources:
- Planet Radio Events API (Bauer stations)
- RadioBrowser API
- Global Radio WebSocket
- BBC RMS API

**Query Parameters:**
- `stationId` (string, required) - Station identifier
- `stationName` (string, optional) - Station name

**Response:**
```json
{
  "title": "Song Title",
  "artist": "Artist Name",
  "artwork_url": "https://...",
  "is_song": true
}
```

### `/api/artwork`
Proxies artwork images with CORS headers.

**Query Parameters:**
- `url` (string, required) - Artwork image URL

**Response:** Image with appropriate headers

**Cache:** 1 day

### `/api/weather`
Fetches current weather for Tonbridge, UK.

**Response:**
```json
{
  "temperature": 15
}
```

**Cache:** 5 minutes

### `/api/health`
Health check endpoint.

**Response:**
```json
{
  "ok": true,
  "time": "2024-01-01T00:00:00.000Z"
}
```

## Build Process

### Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run development servers:**
   ```bash
   # Run both API server and Vite dev server concurrently
   npm run dev:all
   
   # Or run separately:
   # Terminal 1: API server (port 3001)
   npm run dev:api
   
   # Terminal 2: Vite dev server (port 3000)
   npm run dev
   ```

3. **Access application:**
   - Frontend: `http://localhost:3000`
   - API Server: `http://localhost:3001`

### Production Build

1. **Build the application:**
   ```bash
   npm run build
   ```

2. **Preview production build:**
   ```bash
   npm run preview
   ```

3. **Build output:**
   - Static files: `dist/`
   - API functions: `api/` (deployed as serverless functions)

## Deployment Options

### Option 1: Vercel (Recommended)

Vercel provides seamless deployment for Vite applications with serverless function support.

#### Prerequisites
- Vercel account
- Vercel CLI installed (`npm i -g vercel`)

#### Deployment Steps

1. **Install Vercel CLI:**
   ```bash
   npm i -g vercel
   ```

2. **Login to Vercel:**
   ```bash
   vercel login
   ```

3. **Deploy:**
   ```bash
   vercel
   ```

4. **Production deployment:**
   ```bash
   vercel --prod
   ```

#### Vercel Configuration

The project is configured for Vercel automatically:
- API routes in `/api` are deployed as serverless functions
- Static files are served from `dist/`
- No additional configuration file needed

#### Environment Variables

No environment variables are required for basic functionality. Optional:
- `VITE_RADIOPLAYER_API_KEY` - For RadioPlayer API (if used)

#### Build Settings

Vercel will automatically detect:
- **Framework Preset:** Vite
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Install Command:** `npm install`

### Option 2: Self-Hosted with Node.js

For self-hosting, you'll need to run both the frontend and API server.

#### Prerequisites
- Node.js 18+ installed
- PM2 or similar process manager (recommended)

#### Setup Steps

1. **Build the application:**
   ```bash
   npm run build
   ```

2. **Install PM2 (optional but recommended):**
   ```bash
   npm i -g pm2
   ```

3. **Create ecosystem file (`ecosystem.config.js`):**
   ```javascript
   module.exports = {
     apps: [
       {
         name: 'jamie-radio-api',
         script: 'api-server.ts',
         interpreter: 'tsx',
         env: {
           NODE_ENV: 'production',
           PORT: 3001
         }
       },
       {
         name: 'jamie-radio-frontend',
         script: 'node_modules/.bin/vite',
         args: 'preview --host 0.0.0.0 --port 3000',
         env: {
           NODE_ENV: 'production'
         }
       }
     ]
   };
   ```

4. **Start with PM2:**
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```

5. **Or run manually:**
   ```bash
   # Terminal 1: API server
   NODE_ENV=production tsx api-server.ts
   
   # Terminal 2: Frontend
   npm run preview
   ```

#### Reverse Proxy (Nginx)

Example Nginx configuration:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # API routes
    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Option 3: Docker

Create a `Dockerfile`:

```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production && npm i -g tsx

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/api ./api
COPY api-server.ts ./

EXPOSE 3000 3001

CMD ["tsx", "api-server.ts"]
```

Build and run:
```bash
docker build -t jamie-radio .
docker run -p 3000:3000 -p 3001:3001 jamie-radio
```

## Configuration

### Vite Configuration

The `vite.config.ts` file contains:
- Development server configuration (port 3000)
- API proxy settings (for local development)
- Build optimizations

**Note:** The proxy target in `vite.config.ts` is set to `http://192.168.1.224:3001` for local development. This should be updated or removed for production builds.

### TypeScript Configuration

`tsconfig.json` includes:
- ES2020 target
- React JSX support
- Strict type checking
- Module resolution for bundlers

### Tailwind Configuration

Tailwind CSS 4 is configured via `tailwind.config.js` and PostCSS. No additional configuration needed for standard deployment.

## Cache Management

The application uses persistent caching for logos stored in `cache/logos.json`. This file:
- Is created automatically on first API call
- Persists between deployments (if file system is persistent)
- Can be cleared by deleting the file

For serverless deployments (Vercel), the cache is ephemeral and resets on each cold start. Consider using:
- Vercel KV (Redis) for persistent caching
- External cache service (Redis, Memcached)
- Database for persistent storage

## Browser Support

- **Modern Browsers:** Chrome, Firefox, Safari, Edge (latest 2 versions)
- **Mobile:** iOS Safari 14+, Chrome Mobile
- **Features:**
  - HLS streaming (via HLS.js)
  - MediaSession API (iOS, Android)
  - Touch gestures (mobile)
  - CSS Grid and Flexbox

## Performance Considerations

### Optimization Features
- Code splitting via Vite
- Lazy loading of components
- Image optimization via API proxy
- Caching for API responses
- GPU-accelerated animations
- Request animation frame for smooth gestures

### Monitoring
- API response times
- Cache hit rates
- Error rates
- User interaction metrics

## Troubleshooting

### Common Issues

1. **API routes return 404**
   - Ensure API functions are deployed correctly
   - Check that `/api` directory is included in deployment
   - Verify serverless function configuration

2. **CORS errors**
   - API endpoints include CORS headers
   - Check that API server is running (development)
   - Verify proxy configuration

3. **Streams not playing**
   - Check browser console for errors
   - Verify stream URLs are accessible
   - Check HLS.js compatibility
   - Ensure CORS headers on stream sources

4. **Logo/artwork not loading**
   - Check API endpoint responses
   - Verify image URLs are accessible
   - Check cache permissions
   - Review network requests in browser DevTools

5. **Build failures**
   - Ensure all dependencies are installed
   - Check TypeScript errors: `npm run build`
   - Verify Node.js version (18+)
   - Clear `node_modules` and reinstall

### Debug Mode

Enable verbose logging:
- API server logs all requests
- Browser console shows component lifecycle
- Network tab shows all API calls

## Security Considerations

1. **CORS:** API endpoints allow all origins (`*`). Restrict in production if needed.
2. **Rate Limiting:** Not implemented. Consider adding for production.
3. **Input Validation:** Query parameters are validated in API handlers.
4. **Image Proxy:** Artwork endpoint proxies images to prevent CORS issues.
5. **Cache:** Logo cache is stored in JSON file. Consider secure storage for sensitive data.

## Maintenance

### Regular Tasks
- Update dependencies: `npm update`
- Clear cache: Delete `cache/logos.json`
- Monitor API usage and limits
- Review error logs
- Update station configurations

### Updates
- Pull latest changes
- Run `npm install` to update dependencies
- Run `npm run build` to test build
- Deploy to staging before production

## Support

For issues or questions:
- Check existing documentation files:
  - `DEVELOPER_GUIDE.md`
  - `METADATA_CURRENT_STATUS.md`
  - `TECHNICAL_ISSUE_REPORT.md`
- Review code comments in API handlers
- Check browser console and network logs

## License

[Add your license information here]

---

**Last Updated:** 2024
**Version:** 0.0.0
**Project Name:** Jamie Radio

