# iRadio Path Update: `/radio` Prefix

## Overview

The iRadio application has been updated to use the `/radio` path prefix for all routes. This allows it to coexist with other services (JamifyPass, Vaultwarden, Portainer, MailHog) under the same domain `server.jamiearmoordon.co.uk`.

## Changes Made

### Frontend Code Updates

1. **Created centralized API configuration** (`src/config/api.ts`):
   - `getApiBasePath()`: Returns `/radio/api` in production, `/api` in development
   - `getWakeWordWebSocketUrl()`: Returns `wss://server.jamiearmoordon.co.uk/radio/ws` in production
   - `getMurfWebSocketUrl()`: Returns `wss://server.jamiearmoordon.co.uk/radio/api/tts/murf-ws` in production

2. **Updated all API calls** to use the centralized config:
   - `src/services/ai.ts`
   - `src/services/voiceControl.ts`
   - `src/services/voiceFeedback.ts`
   - `src/services/engines/googleAITTS.ts`
   - `src/services/radioBrowser.ts`
   - `src/components/Temperature.tsx`

3. **Updated WebSocket URLs**:
   - `src/hooks/useWakeWordDetector.ts`: Uses `/radio/ws` in production
   - `src/services/murfWebSocketTTS.ts`: Uses `/radio/api/tts/murf-ws` in production

4. **Updated Vite configuration** (`vite.config.ts`):
   - Added proxy for `/radio/api` → `http://localhost:3001/api` (strips `/radio` prefix)
   - Added proxy for `/radio/ws` → `ws://localhost:8000/ws` (strips `/radio` prefix)
   - Kept `/api` proxy for backward compatibility in development
   - Updated PWA cache patterns to include `/radio/api` paths

### Backend Updates

1. **API Server** (`api-server.ts`):
   - Updated 404 handler to recognize both `/api` and `/radio/api` patterns
   - No other changes needed - nginx will strip `/radio` prefix before proxying

## Nginx Configuration

### WSL Nginx (Home Server on port 8080)

Add this to `/etc/nginx/sites-available/home-reverse-proxy`:

```nginx
# iRadio application under /radio/
location /radio/ {
    # Strip /radio prefix when proxying to API server
    rewrite ^/radio/(.*) /$1 break;
    
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    
    # WebSocket support for API
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # Increase timeouts for long-running requests
    proxy_read_timeout 300s;
    proxy_connect_timeout 75s;
    
    # Increase body size for audio uploads
    client_max_body_size 50M;
}

# Wake Word WebSocket (separate service on port 8000)
location /radio/ws {
    # Strip /radio prefix
    rewrite ^/radio/(.*) /$1 break;
    
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    
    # WebSocket upgrade headers
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # Long timeout for WebSocket connections
    proxy_read_timeout 86400s;
}
```

### VPS Nginx (Public Entry Point)

The VPS nginx already proxies everything to `127.0.0.1:9100` (the SSH tunnel), so no changes needed there. The `/radio` path will be passed through to WSL nginx.

## URLs

### Production (via reverse proxy)
- **Frontend**: `https://server.jamiearmoordon.co.uk/radio/`
- **API**: `https://server.jamiearmoordon.co.uk/radio/api/*`
- **Wake Word WebSocket**: `wss://server.jamiearmoordon.co.uk/radio/ws`
- **Murf TTS WebSocket**: `wss://server.jamiearmoordon.co.uk/radio/api/tts/murf-ws`

### Development (local)
- **Frontend**: `http://localhost:3000/`
- **API**: `http://localhost:3000/api/*` (vite proxy) or `http://localhost:3001/api/*` (direct)
- **Wake Word WebSocket**: `ws://localhost:8000/ws`
- **Murf TTS WebSocket**: `ws://localhost:3001/api/tts/murf-ws`

## Deployment Steps

1. **Pull latest code**:
   ```bash
   cd ~/iradio
   git pull origin main
   ```

2. **Update WSL nginx configuration**:
   ```bash
   sudo nano /etc/nginx/sites-available/home-reverse-proxy
   # Add the /radio/ location blocks (see above)
   sudo nginx -t  # Test configuration
   sudo systemctl reload nginx
   ```

3. **Rebuild and restart containers**:
   ```bash
   docker compose down
   docker compose build --no-cache
   docker compose up -d
   ```

4. **Verify**:
   ```bash
   # Check API health
   curl https://server.jamiearmoordon.co.uk/radio/api/health
   
   # Check wake word health
   curl https://server.jamiearmoordon.co.uk/radio/api/health
   # (Note: wake word service doesn't have a public HTTP endpoint, only WebSocket)
   ```

## Testing

1. **Frontend**: Open `https://server.jamiearmoordon.co.uk/radio/` in browser
2. **API**: Test with `curl https://server.jamiearmoordon.co.uk/radio/api/health`
3. **WebSocket**: Check browser console for WebSocket connection status

## Notes

- The frontend automatically detects the hostname and uses the correct API paths
- In development, the Vite proxy handles `/radio/api` → `/api` conversion
- The nginx `rewrite` directive strips the `/radio` prefix before proxying to the backend
- All existing functionality remains the same, just under a different path

