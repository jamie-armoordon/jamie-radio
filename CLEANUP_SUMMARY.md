# Repository Cleanup Summary

This document summarizes the cleanup performed on the iRadio repository.

## Cleanup Date
2025-01-XX

## Files Archived

**Total: 207 files moved to `_archive/` folder**

### Documentation Files (8)
- `AI_INTEGRATION.md` - Old AI integration documentation
- `AI_UI_FILES_AND_CONTEXT.md` - UI context documentation
- `AUDIO_PLAYBACK_ISSUE.md` - Issue tracking document
- `FUNCTION_CALLING_ISSUES.md` - Issue tracking document
- `ISSUE_REFERENCE_EMBEDDINGS.md` - Issue tracking document
- `LOW_LATENCY_PIPELINE.md` - Technical deep-dive documentation
- `MURF_WEBSOCKET_TROUBLESHOOTING.md` - Troubleshooting guide
- `PERPLEXITY_TTS_SEARCH.md` - Research notes

### Test Files
- `test-murf-api.ts` / `test-murf-api.ps1` - API test scripts
- `test/test_*.py`, `test/test_*.html` - Test files
- `scripts/test-*.ts`, `scripts/test-*.js` - Test scripts
- `scripts/upgrade-logging.py` - Migration script

### Backup Folders
- `backup_before_upgrade/` - Old backup folders
- `upgraded ai ui/` - Old version folder

### Other Files
- `migrate-upgraded-ui.py` - Migration script
- `api-server.js` - Compiled JavaScript file
- `iradio-dist.tar.gz` - Archive file
- `base64.txt` - Temporary file
- `mars5-colab-gpu.ipynb` - Jupyter notebook
- Various report and research files

## Files Removed from Git Tracking

**Total: 82 files**

- `wakeword-venv/` - Python virtual environment (now ignored)
- `test/venv/` - Test virtual environment (now ignored)
- `backup_before_upgrade/` - Backup folders
- `api-server.js` - Compiled file

## Updated .gitignore

The `.gitignore` file has been updated to ignore:

- `_archive/` folder
- Test files (`test/test_*.py`, `scripts/test-*.ts`)
- Virtual environments (`wakeword-venv/`, `test/venv/`)
- Build artifacts (`*.js`, `*.tar.gz`, `*.zip`)
- Migration scripts (`migrate-*.py`)
- Temporary files (`*.tmp`, `*.temp`, `base64.txt`)
- Test outputs (`*.wav`, `*.mp3` except `public/silence.mp3`)

## Remaining Essential Files

### Documentation (6 files)
- `README.md` - Main project documentation
- `WAKE_WORD_SETUP.md` - Wake word setup guide
- `DOCKER_DEPLOYMENT.md` - Docker deployment guide
- `PORTAINER_API_DEPLOYMENT.md` - Portainer API deployment guide
- `PORTAINER_QUICK_START.md` - Quick start guide for Portainer
- `DEPLOYMENT_VPS.md` - VPS deployment guide (kept for reference)

### Source Code
- `api/` - API endpoints and utilities
- `src/` - Frontend React source code
- `public/` - Static assets (icons, models, WASM files)
- `scripts/` - Build and utility scripts (essential ones)

### Configuration Files
- `package.json` / `package-lock.json` - Node.js dependencies
- `tsconfig.json` - TypeScript configuration
- `vite.config.ts` - Vite build configuration
- `tailwind.config.js` - Tailwind CSS configuration
- `postcss.config.js` - PostCSS configuration
- `requirements.txt` - Python dependencies

### Docker Files
- `Dockerfile.api` - API server Docker image
- `Dockerfile.wakeword` - Wake word server Docker image
- `docker-compose.yml` - Docker Compose configuration
- `.dockerignore` - Docker ignore patterns

### Deployment Scripts
- `deploy-portainer.ps1` - PowerShell deployment script
- `deploy-portainer.sh` - Bash deployment script
- `deploy-build.sh` - Build deployment script

### Python Files
- `server.py` - Wake word detection server
- `start-wakeword-server.py` - Server startup script
- `setup-wakeword-venv.py` - Virtual environment setup script

## Repository Status

✅ **Clean and Ready for Deployment**

- All unnecessary files archived
- Virtual environments properly ignored
- Build artifacts excluded
- Test files removed from tracking
- Essential documentation preserved
- Docker deployment files ready

## Next Steps

1. **Review archived files** - Check `_archive/` folder if you need any old files
2. **Delete archive** - If satisfied, you can delete `_archive/` folder (it's already ignored by git)
3. **Commit changes** - Stage and commit the cleanup changes:
   ```bash
   git add .gitignore
   git add -A
   git commit -m "Clean up repository: archive unnecessary files and update .gitignore"
   ```
4. **Deploy** - Use the Docker deployment files to deploy to Portainer

## Notes

- The `_archive/` folder is ignored by git and can be safely deleted if not needed
- Virtual environments (`wakeword-venv/`, `test/venv/`) are ignored but kept locally for development
- All essential functionality and documentation is preserved
- Docker deployment is the recommended method going forward

