#!/bin/bash
# Quick deployment script for iRadio frontend build

set -e

echo "=== iRadio Frontend Deployment ==="

# Navigate to project directory
cd ~/jamie-radio || { echo "Error: ~/jamie-radio not found"; exit 1; }

# Pull latest changes
echo "Pulling latest changes..."
git pull origin main

# Set environment variable for WebSocket URL
export VITE_WAKE_WORD_WS_URL="wss://radio.jamiearmoordon.co.uk/ws"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Build frontend
echo "Building frontend..."
npm run build

# Check if build succeeded
if [ ! -d "dist" ]; then
    echo "Error: Build failed - dist directory not found"
    exit 1
fi

echo "✓ Build complete! dist/ directory is ready."
echo ""
echo "Next steps:"
echo "1. Update your web server (Nginx) to serve from: $(pwd)/dist"
echo "2. Or copy dist/ to your web root"
echo "3. Restart your web server if needed"

