# Portainer Quick Start Guide

Quick reference for deploying iRadio on Portainer.

## Prerequisites

- Portainer installed and accessible
- Docker and Docker Compose installed
- Git repository access (or files uploaded)

## Deployment Steps

### 1. Prepare Environment Variables

In Portainer, go to **Settings** → **Environment Variables** and add:

```
GOOGLE_AI_API_KEY=your_key_here
ASSEMBLYAI_API_KEY=your_key_here
MURF_API_KEY=your_key_here
```

Or create a `.env` file in your project directory.

### 2. Deploy via Stack

1. **Navigate to Stacks**
   - Click **Stacks** in left sidebar
   - Click **Add Stack**

2. **Configure Stack**
   - **Name**: `iradio`
   - **Build method**: `Repository` (or `Web editor` if uploading files)
   - **Repository URL**: Your Git repo URL
   - **Repository reference**: `main`
   - **Compose path**: `docker-compose.yml`
   - **Environment variables**: Add your API keys

3. **Deploy**
   - Click **Deploy the stack**
   - Wait for build to complete (5-10 minutes)

### 3. Verify Deployment

Check containers:
- Go to **Containers**
- You should see:
  - `iradio-api` (port 3001)
  - `iradio-wakeword` (port 8000)

Test endpoints:
```bash
curl http://your-server:3001/api/health
curl http://your-server:8000/health
```

## Accessing the Application

- **Frontend/API**: `http://your-server:3001`
- **Wake Word WS**: `ws://your-server:8000/ws`

## Reverse Proxy (Optional)

If using Nginx or Traefik:

### Nginx Example
```nginx
location / {
    proxy_pass http://localhost:3001;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
}

location /ws {
    proxy_pass http://localhost:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

## Troubleshooting

### View Logs
- Go to **Containers** → Select container → **Logs** tab

### Restart Containers
- Go to **Containers** → Select container → **Restart**

### Rebuild Stack
- Go to **Stacks** → `iradio` → **Editor** → **Update the stack**

## Common Issues

**Port already in use:**
- Change ports in `docker-compose.yml` (e.g., `3002:3001`)

**Build fails:**
- Check logs for missing dependencies
- Ensure Git repository is accessible

**Containers keep restarting:**
- Check logs for errors
- Verify environment variables are set correctly

## Next Steps

- Set up reverse proxy (Nginx/Traefik)
- Configure SSL/TLS certificates
- Set up monitoring and alerts
- Configure backups

For detailed documentation, see [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md)

