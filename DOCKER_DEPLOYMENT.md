# Docker Deployment Guide for Portainer

This guide covers deploying the iRadio application using Docker containers on Portainer.

## Overview

The iRadio application consists of two main services:

1. **API Server** (Node.js) - Serves the frontend (`dist/` folder) and API endpoints
   - Port: `3001`
   - Handles: `/api/*` routes, WebSocket connections
   - Serves: Static frontend files from `dist/`

2. **Wake Word Server** (Python FastAPI) - Wake word detection service
   - Port: `8000`
   - Handles: WebSocket connections at `/ws`
   - Provides: Real-time wake word detection ("hey_jarvis")

## Prerequisites

- Docker and Docker Compose installed on your server
- Portainer installed and accessible
- Environment variables configured (API keys)

## Quick Start

### 1. Prepare Environment Variables

Create a `.env` file in the project root:

```env
# Google AI API Key (for Gemini)
GOOGLE_AI_API_KEY=your_google_ai_api_key_here

# AssemblyAI API Key (for transcription)
ASSEMBLYAI_API_KEY=your_assemblyai_api_key_here

# Murf AI API Key (for TTS, optional)
MURF_API_KEY=your_murf_api_key_here

# Node Environment
NODE_ENV=production

# Server Configuration
PORT=3001
HOST=0.0.0.0

# Python Wake Word Server
WAKE_WORD_PORT=8000
```

### 2. Build and Deploy via Portainer

#### Option A: Using Portainer Stacks (Recommended)

1. **Access Portainer**
   - Navigate to your Portainer instance
   - Go to **Stacks** → **Add Stack**

2. **Configure Stack**
   - **Name**: `iradio`
   - **Build method**: Select **Repository**
   - **Repository URL**: Your Git repository URL
   - **Repository reference**: `main` (or your branch)
   - **Compose path**: `docker-compose.yml`
   - **Environment variables**: Add your `.env` variables or use Portainer's environment variable management

3. **Deploy**
   - Click **Deploy the stack**
   - Portainer will clone the repository, build images, and start containers

#### Option B: Using Portainer Containers (Manual)

1. **Build Images Locally** (on your server):
   ```bash
   docker build -f Dockerfile.api -t iradio-api:latest .
   docker build -f Dockerfile.wakeword -t iradio-wakeword:latest .
   ```

2. **Create Containers in Portainer**:
   - Go to **Containers** → **Add Container**
   - Create two containers:

   **API Container:**
   - **Name**: `iradio-api`
   - **Image**: `iradio-api:latest`
   - **Ports**: `3001:3001`
   - **Environment variables**: Add from `.env` file
   - **Volumes**: 
     - `./cache:/app/cache`
     - `./logs:/app/logs`
   - **Restart policy**: `Unless stopped`
   - **Network**: Create or use existing bridge network

   **Wake Word Container:**
   - **Name**: `iradio-wakeword`
   - **Image**: `iradio-wakeword:latest`
   - **Ports**: `8000:8000`
   - **Restart policy**: `Unless stopped`
   - **Network**: Same network as API container

### 3. Verify Deployment

Check container status:
```bash
docker ps
```

Test endpoints:
```bash
# API health check
curl http://localhost:3001/api/health

# Wake word health check
curl http://localhost:8000/health
```

## Portainer Stack Configuration

### Using docker-compose.yml

The included `docker-compose.yml` is ready for Portainer:

```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    container_name: iradio-api
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - PORT=3001
      - HOST=0.0.0.0
      - GOOGLE_AI_API_KEY=${GOOGLE_AI_API_KEY}
      - ASSEMBLYAI_API_KEY=${ASSEMBLYAI_API_KEY}
      - MURF_API_KEY=${MURF_API_KEY}
    volumes:
      - ./cache:/app/cache
      - ./logs:/app/logs
    restart: unless-stopped
    networks:
      - iradio-network

  wakeword:
    build:
      context: .
      dockerfile: Dockerfile.wakeword
    container_name: iradio-wakeword
    ports:
      - "8000:8000"
    restart: unless-stopped
    networks:
      - iradio-network
```

### Environment Variables in Portainer

You can manage environment variables in Portainer in two ways:

1. **Stack Environment Variables** (Recommended):
   - In Portainer Stack settings, add environment variables
   - They will be available to all containers in the stack

2. **Container Environment Variables**:
   - Set per-container in container settings
   - Override stack-level variables if needed

## Reverse Proxy Setup (Nginx/Traefik)

### Option 1: Nginx (External)

If using Nginx outside Docker, configure:

```nginx
upstream iradio_api {
    server localhost:3001;
}

upstream iradio_wakeword {
    server localhost:8000;
}

server {
    listen 80;
    server_name your-domain.com;

    # Frontend + API
    location / {
        proxy_pass http://iradio_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Wake Word WebSocket
    location /ws {
        proxy_pass http://iradio_wakeword;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

### Option 2: Traefik (Docker)

Add Traefik labels to `docker-compose.yml`:

```yaml
services:
  api:
    # ... existing config ...
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.iradio.rule=Host(`your-domain.com`)"
      - "traefik.http.routers.iradio.entrypoints=web"
      - "traefik.http.services.iradio.loadbalancer.server.port=3001"

  wakeword:
    # ... existing config ...
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.iradio-ws.rule=Host(`your-domain.com`) && PathPrefix(`/ws`)"
      - "traefik.http.routers.iradio-ws.entrypoints=web"
      - "traefik.http.services.iradio-ws.loadbalancer.server.port=8000"
```

## Networking

### Internal Communication

Both containers are on the same Docker network (`iradio-network`), so they can communicate using container names:

- API → Wake Word: `http://iradio-wakeword:8000`
- Wake Word → API: `http://iradio-api:3001`

### External Access

- **API/Frontend**: `http://your-server:3001`
- **Wake Word**: `http://your-server:8000`

## Volumes and Persistence

### Cache Directory

The API container persists the cache directory:
- **Host path**: `./cache`
- **Container path**: `/app/cache`
- **Purpose**: Stores logo cache and other cached data

### Logs Directory

The API container persists logs:
- **Host path**: `./logs`
- **Container path**: `/app/logs`
- **Purpose**: Application logs

### Creating Directories

Before starting containers, ensure directories exist:

```bash
mkdir -p cache logs
chmod 755 cache logs
```

## Health Checks

Both containers include health checks:

- **API**: `http://localhost:3001/api/health`
- **Wake Word**: `http://localhost:8000/health`

Portainer will show health status in the container list.

## Updating the Application

### Method 1: Via Portainer Stack

1. Go to **Stacks** → `iradio`
2. Click **Editor** tab
3. Update `docker-compose.yml` if needed
4. Click **Update the stack**
5. Portainer will rebuild and restart containers

### Method 2: Via Git (Auto-redeploy)

If using Portainer with Git integration:

1. Push changes to your repository
2. In Portainer Stack settings, enable **Auto-redeploy**
3. Portainer will automatically pull and redeploy on changes

### Method 3: Manual Update

```bash
# Pull latest code
git pull

# Rebuild images
docker-compose build

# Restart containers
docker-compose up -d
```

## Troubleshooting

### Containers Won't Start

1. **Check logs**:
   ```bash
   docker logs iradio-api
   docker logs iradio-wakeword
   ```

2. **Check environment variables**:
   - Ensure all required API keys are set
   - Verify `.env` file is loaded correctly

3. **Check ports**:
   ```bash
   # Check if ports are in use
   netstat -tulpn | grep -E '3001|8000'
   ```

### API Server Errors

- **Build errors**: Ensure Node.js dependencies are installed
- **Port conflicts**: Change port mapping in `docker-compose.yml`
- **Cache errors**: Check volume permissions

### Wake Word Server Errors

- **Python version**: Ensure Python 3.11 is used (specified in Dockerfile)
- **Model loading**: Check if openwakeword models are downloaded
- **Memory**: Wake word detection requires sufficient RAM

### WebSocket Connection Issues

- **Proxy configuration**: Ensure reverse proxy supports WebSocket upgrades
- **Firewall**: Check if ports 3001 and 8000 are open
- **Network**: Verify containers are on the same Docker network

## Resource Requirements

### Minimum

- **CPU**: 2 cores
- **RAM**: 2GB
- **Storage**: 5GB

### Recommended

- **CPU**: 4+ cores
- **RAM**: 4GB+
- **Storage**: 10GB+

### Wake Word Server

- **RAM**: 512MB minimum (1GB recommended)
- **CPU**: 1+ core

## Security Considerations

1. **Environment Variables**: Never commit `.env` file to Git
2. **Ports**: Consider using reverse proxy instead of exposing ports directly
3. **Network**: Use Docker networks to isolate containers
4. **Updates**: Keep Docker images updated for security patches
5. **SSL/TLS**: Use reverse proxy (Nginx/Traefik) with SSL certificates

## Monitoring

### Portainer Monitoring

- View container logs in real-time
- Monitor resource usage (CPU, RAM, network)
- Set up alerts for container failures

### Application Logs

Access logs via volumes:
```bash
tail -f logs/api-out.log
tail -f logs/api-error.log
```

### Health Checks

Monitor health endpoints:
```bash
watch -n 5 'curl -s http://localhost:3001/api/health && curl -s http://localhost:8000/health'
```

## Backup

### Cache Backup

```bash
# Backup cache directory
tar -czf cache-backup-$(date +%Y%m%d).tar.gz cache/
```

### Container Backup

```bash
# Export container
docker export iradio-api > iradio-api-backup.tar
docker export iradio-wakeword > iradio-wakeword-backup.tar
```

## Support

For issues:
1. Check container logs in Portainer
2. Review this documentation
3. Check GitHub issues: https://github.com/jamie-armoordon/jamie-radio/issues

---

**Last Updated**: 2025-01-XX
**Version**: 1.0.0

