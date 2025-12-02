# Deployment Readiness Checklist

Use this checklist before deploying to Portainer.

## Pre-Deployment Checklist

### ✅ Repository Cleanup
- [x] Unnecessary files archived to `_archive/`
- [x] Virtual environments ignored in `.gitignore`
- [x] Build artifacts excluded
- [x] Test files removed from tracking

### ✅ Docker Configuration
- [x] `Dockerfile.api` - API server Dockerfile
- [x] `Dockerfile.wakeword` - Wake word server Dockerfile
- [x] `docker-compose.yml` - Docker Compose configuration
- [x] `.dockerignore` - Docker ignore patterns

### ✅ Deployment Scripts
- [x] `deploy-portainer.ps1` - PowerShell deployment script
- [x] `deploy-portainer.sh` - Bash deployment script
- [x] Scripts include verbose logging

### ✅ Documentation
- [x] `README.md` - Main documentation
- [x] `WAKE_WORD_SETUP.md` - Wake word setup guide
- [x] `DOCKER_DEPLOYMENT.md` - Docker deployment guide
- [x] `PORTAINER_QUICK_START.md` - Quick start guide
- [x] `PORTAINER_API_DEPLOYMENT.md` - API deployment guide
- [x] `DEPLOYMENT_VPS.md` - VPS deployment (reference)

## Environment Variables Required

### Required API Keys
- [ ] `GOOGLE_AI_API_KEY` - Google Gemini API key
- [ ] `ASSEMBLYAI_API_KEY` - AssemblyAI transcription API key
- [ ] `MURF_API_KEY` - Murf AI TTS API key (optional but recommended)

### Server Configuration
- [x] `NODE_ENV=production`
- [x] `PORT=3001`
- [x] `HOST=0.0.0.0`
- [x] `WAKE_WORD_PORT=8000`

### Portainer Configuration (for deployment script)
- [ ] `PORTAINER_URL` - Your Portainer URL
- [ ] `PORTAINER_TOKEN` - Portainer API token

## Pre-Deployment Steps

1. **Verify Environment Variables**
   ```bash
   # Check .env file exists and has all required keys
   cat .env
   ```

2. **Test Docker Build Locally** (Optional)
   ```bash
   docker-compose build
   docker-compose up -d
   ```

3. **Verify Git Status**
   ```bash
   git status
   # Should show clean working directory or only expected changes
   ```

4. **Commit Changes** (if needed)
   ```bash
   git add .
   git commit -m "Prepare for Docker deployment"
   git push origin main
   ```

## Deployment Steps

### Option 1: Using PowerShell Script (Windows)
```powershell
powershell -ExecutionPolicy Bypass -File deploy-portainer.ps1 -Verbose
```

### Option 2: Using Bash Script (Linux/Mac)
```bash
chmod +x deploy-portainer.sh
./deploy-portainer.sh
```

### Option 3: Using Portainer Web UI
1. Go to Portainer → Stacks → Add Stack
2. Name: `iradio`
3. Build method: `Repository`
4. Repository URL: `https://github.com/jamie-armoordon/jamie-radio.git`
5. Branch: `main`
6. Compose path: `docker-compose.yml`
7. Add environment variables
8. Deploy

## Post-Deployment Verification

### Check Container Status
- [ ] Both containers running (`iradio-api`, `iradio-wakeword`)
- [ ] Health checks passing
- [ ] No error logs

### Test Endpoints
```bash
# API Health Check
curl http://your-server:3001/api/health

# Wake Word Health Check
curl http://your-server:8000/health

# Frontend
curl http://your-server:3001
```

### Verify WebSocket Connections
- [ ] Wake word WebSocket: `ws://your-server:8000/ws`
- [ ] API WebSockets working (`/api/vad`, `/api/tts/murf-ws`)

## Troubleshooting

### Containers Won't Start
- Check logs in Portainer
- Verify environment variables are set
- Check port availability

### Build Failures
- Verify Dockerfile syntax
- Check build logs for errors
- Ensure all dependencies are available

### API Errors
- Verify API keys are correct
- Check API server logs
- Test endpoints individually

## Rollback Plan

If deployment fails:
1. Stop the stack in Portainer
2. Check logs for errors
3. Fix issues in code
4. Rebuild and redeploy

## Support

- Check logs: Portainer → Containers → Logs
- Review documentation: `DOCKER_DEPLOYMENT.md`
- Check GitHub issues

---

**Last Updated**: 2025-01-XX
**Status**: Ready for Deployment ✅

