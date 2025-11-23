# VPS Deployment Guide - iRadio Development Environment

This guide covers deploying the iRadio application to a VPS (Virtual Private Server) for development purposes.

## Table of Contents

- [VPS Requirements](#vps-requirements)
- [Initial Server Setup](#initial-server-setup)
- [Installing Dependencies](#installing-dependencies)
- [Application Setup](#application-setup)
- [Environment Configuration](#environment-configuration)
- [Service Management](#service-management)
- [Reverse Proxy Setup (Nginx)](#reverse-proxy-setup-nginx)
- [SSL/HTTPS Configuration](#sslhttps-configuration)
- [Firewall Configuration](#firewall-configuration)
- [Monitoring and Logs](#monitoring-and-logs)
- [Troubleshooting](#troubleshooting)
- [Maintenance](#maintenance)

---

## VPS Requirements

### Minimum Specifications

- **CPU**: 2+ cores (4+ recommended for AI processing)
- **RAM**: 4GB minimum (8GB+ recommended)
- **Storage**: 20GB+ SSD
- **OS**: Ubuntu 22.04 LTS or Debian 12 (recommended)
- **Network**: Public IP address with ports 80, 443, 3000, 3001, 8000 open

### Recommended Specifications

- **CPU**: 4+ cores
- **RAM**: 8GB+
- **Storage**: 50GB+ SSD
- **Bandwidth**: Unlimited or high limit (for audio streaming)

---

## Initial Server Setup

### 1. Connect to Your VPS

```bash
ssh root@your-vps-ip
# Or with a specific user
ssh username@your-vps-ip
```

### 2. Update System Packages

```bash
# Ubuntu/Debian
sudo apt update && sudo apt upgrade -y

# Install essential tools
sudo apt install -y curl wget git build-essential software-properties-common
```

### 3. Create Application User (Recommended)

```bash
# Create a non-root user for the application
sudo adduser iradio
sudo usermod -aG sudo iradio

# Switch to the new user
su - iradio
```

---

## Installing Dependencies

### 1. Install Node.js (v18+)

```bash
# Using NodeSource repository (recommended)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should be v20.x or higher
npm --version
```

### 2. Install Python 3.10+

```bash
# Ubuntu 22.04 comes with Python 3.10+
python3 --version

# If not installed
sudo apt install -y python3 python3-pip python3-venv

# Install pip if needed
sudo apt install -y python3-pip
```

### 3. Install FFmpeg (Required for Audio Processing)

```bash
sudo apt install -y ffmpeg

# Verify installation
ffmpeg -version
```

### 4. Install Additional System Dependencies

```bash
# Required for native Node.js modules
sudo apt install -y python3-dev pkg-config libssl-dev

# Required for whisper-node and other native dependencies
sudo apt install -y build-essential cmake
```

---

## Application Setup

### 1. Clone Repository

```bash
# Navigate to home directory or preferred location
cd ~

# Clone your repository
git clone https://github.com/jamie-armoordon/jamie-radio.git
cd jamie-radio

# Or if using SSH
git clone git@github.com:jamie-armoordon/jamie-radio.git
cd jamie-radio
```

### 2. Install Node.js Dependencies

```bash
npm install
```

**Note**: This may take several minutes as it compiles native modules (whisper-node, node-vad, etc.)

### 3. Build Production Bundle

```bash
npm run build
```

This creates the production build in the `dist/` directory.

### 4. Set Up Python Virtual Environment

```bash
# Create and activate virtual environment
python3 -m venv wakeword-venv
source wakeword-venv/bin/activate

# Install Python dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Optional: Install uvloop for better performance
pip install uvloop

# Deactivate virtual environment
deactivate
```

---

## Environment Configuration

### 1. Create Environment File

```bash
# Create .env file
nano .env
```

Add the following configuration:

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

# Logging
LOG_LEVEL=info
AI_LOG_ENABLED=true
```

### 2. Secure Environment File

```bash
# Ensure .env is not readable by others
chmod 600 .env
```

---

## Service Management

### Option 1: PM2 (Recommended for Node.js)

#### Install PM2

```bash
sudo npm install -g pm2
```

#### Create PM2 Ecosystem File

```bash
nano ecosystem.config.js
```

Add the following configuration:

```javascript
module.exports = {
  apps: [
    {
      name: 'iradio-api',
      script: 'api-server.ts',
      interpreter: 'tsx',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
    },
    {
      name: 'iradio-frontend',
      script: 'node_modules/.bin/vite',
      args: 'preview --host 0.0.0.0 --port 3000',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/frontend-error.log',
      out_file: './logs/frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
    },
  ],
};
```

#### Create Logs Directory

```bash
mkdir -p logs
```

#### Start Services with PM2

```bash
# Start all services
pm2 start ecosystem.config.js

# Or start individually
pm2 start api-server.ts --name iradio-api --interpreter tsx
pm2 start npm --name iradio-frontend -- run preview

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Follow the instructions provided
```

#### PM2 Management Commands

```bash
# View status
pm2 status

# View logs
pm2 logs iradio-api
pm2 logs iradio-frontend

# Restart services
pm2 restart all
pm2 restart iradio-api

# Stop services
pm2 stop all

# Delete services
pm2 delete all
```

### Option 2: Systemd (For Python Wake Word Server)

#### Create Systemd Service File

```bash
sudo nano /etc/systemd/system/iradio-wakeword.service
```

Add the following:

```ini
[Unit]
Description=iRadio Wake Word Server
After=network.target

[Service]
Type=simple
User=iradio
WorkingDirectory=/home/iradio/jamie-radio
Environment="PATH=/home/iradio/jamie-radio/wakeword-venv/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=/home/iradio/jamie-radio/wakeword-venv/bin/python /home/iradio/jamie-radio/start-wakeword-server.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

#### Enable and Start Service

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service (start on boot)
sudo systemctl enable iradio-wakeword

# Start service
sudo systemctl start iradio-wakeword

# Check status
sudo systemctl status iradio-wakeword

# View logs
sudo journalctl -u iradio-wakeword -f
```

---

## Reverse Proxy Setup (Nginx)

### 1. Install Nginx

```bash
sudo apt install -y nginx
```

### 2. Create Nginx Configuration

```bash
sudo nano /etc/nginx/sites-available/iradio
```

Add the following configuration:

```nginx
# Upstream servers
upstream iradio_frontend {
    server 127.0.0.1:3000;
}

upstream iradio_api {
    server 127.0.0.1:3001;
}

upstream iradio_wakeword {
    server 127.0.0.1:8000;
}

# HTTP to HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name radio.jamiearmoordon.co.uk;

    # Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$server_name$request_uri;
    }
}

# Main HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name radio.jamiearmoordon.co.uk;

    # SSL certificates (will be configured with Certbot)
    ssl_certificate /etc/letsencrypt/live/radio.jamiearmoordon.co.uk/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/radio.jamiearmoordon.co.uk/privkey.pem;

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Increase body size for audio uploads
    client_max_body_size 50M;

    # Frontend
    location / {
        proxy_pass http://iradio_frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # API endpoints
    location /api {
        proxy_pass http://iradio_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket support for API
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    # Wake Word WebSocket
    location /ws {
        proxy_pass http://iradio_wakeword;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    # AssemblyAI WebSocket Proxy
    location /api/assemblyai-proxy {
        proxy_pass http://iradio_api/api/assemblyai-proxy;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }

    # VAD WebSocket
    location /api/vad {
        proxy_pass http://iradio_api/api/vad;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }

    # Murf TTS WebSocket
    location /api/tts/murf-ws {
        proxy_pass http://iradio_api/api/tts/murf-ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

### 3. Enable Site

```bash
# Create symbolic link
sudo ln -s /etc/nginx/sites-available/iradio /etc/nginx/sites-enabled/

# Remove default site (optional)
sudo rm /etc/nginx/sites-enabled/default

# Test Nginx configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

---

## SSL/HTTPS Configuration

### 1. Install Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### 2. Obtain SSL Certificate

```bash
# Replace with your domain
sudo certbot --nginx -d radio.jamiearmoordon.co.uk

# Follow the prompts:
# - Enter email address
# - Agree to terms
# - Choose whether to redirect HTTP to HTTPS (recommended: Yes)
```

### 3. Auto-Renewal Setup

Certbot automatically sets up auto-renewal. Test it:

```bash
sudo certbot renew --dry-run
```

---

## Firewall Configuration

### 1. Configure UFW (Uncomplicated Firewall)

```bash
# Allow SSH (important - do this first!)
sudo ufw allow 22/tcp

# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

**Note**: Ports 3000, 3001, and 8000 should NOT be exposed publicly - they're only accessible through Nginx reverse proxy.

---

## Monitoring and Logs

### 1. Application Logs

```bash
# PM2 logs
pm2 logs

# Systemd logs (Python server)
sudo journalctl -u iradio-wakeword -f

# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### 2. System Monitoring

```bash
# Install monitoring tools
sudo apt install -y htop iotop

# View system resources
htop
```

### 3. PM2 Monitoring

```bash
# Install PM2 monitoring
pm2 install pm2-logrotate

# View PM2 monitoring dashboard
pm2 monit
```

---

## Troubleshooting

### Common Issues

#### 1. Services Not Starting

```bash
# Check PM2 status
pm2 status

# Check systemd status
sudo systemctl status iradio-wakeword

# Check logs
pm2 logs
sudo journalctl -u iradio-wakeword -n 50
```

#### 2. Port Already in Use

```bash
# Find process using port
sudo lsof -i :3000
sudo lsof -i :3001
sudo lsof -i :8000

# Kill process if needed
sudo kill -9 <PID>
```

#### 3. Permission Denied Errors

```bash
# Check file permissions
ls -la

# Fix ownership
sudo chown -R iradio:iradio /home/iradio/jamie-radio
```

#### 4. Native Module Compilation Errors

```bash
# Ensure build tools are installed
sudo apt install -y build-essential python3-dev

# Rebuild native modules
npm rebuild
```

#### 5. Python Virtual Environment Issues

```bash
# Recreate virtual environment
rm -rf wakeword-venv
python3 -m venv wakeword-venv
source wakeword-venv/bin/activate
pip install -r requirements.txt
```

#### 6. Nginx 502 Bad Gateway

```bash
# Check if backend services are running
pm2 status
sudo systemctl status iradio-wakeword

# Check Nginx error logs
sudo tail -f /var/log/nginx/error.log

# Verify upstream servers are accessible
curl http://127.0.0.1:3000
curl http://127.0.0.1:3001/api/health
```

---

## Maintenance

### 1. Updating the Application

```bash
# Navigate to application directory
cd ~/jamie-radio

# Pull latest changes
git pull origin main

# Install new dependencies
npm install

# Rebuild if needed
npm run build

# Restart services
pm2 restart all
sudo systemctl restart iradio-wakeword
```

### 2. Backup Strategy

```bash
# Create backup script
nano ~/backup-iradio.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/home/iradio/backups"
DATE=$(date +%Y%m%d_%H%M%S)
APP_DIR="/home/iradio/jamie-radio"

mkdir -p $BACKUP_DIR

# Backup application files
tar -czf $BACKUP_DIR/iradio-$DATE.tar.gz \
    -C $APP_DIR \
    --exclude='node_modules' \
    --exclude='dist' \
    --exclude='wakeword-venv' \
    --exclude='.git' \
    .

# Backup .env file separately (sensitive)
cp $APP_DIR/.env $BACKUP_DIR/.env-$DATE

echo "Backup completed: $BACKUP_DIR/iradio-$DATE.tar.gz"
```

```bash
# Make executable
chmod +x ~/backup-iradio.sh

# Add to crontab for daily backups
crontab -e
# Add: 0 2 * * * /home/iradio/backup-iradio.sh
```

### 3. Log Rotation

PM2 handles log rotation automatically. For systemd:

```bash
sudo nano /etc/logrotate.d/iradio-wakeword
```

```
/home/iradio/jamie-radio/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 iradio iradio
}
```

### 4. Performance Optimization

```bash
# Enable swap if needed (for low RAM servers)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## Quick Reference

### Service Management

```bash
# PM2
pm2 start ecosystem.config.js
pm2 stop all
pm2 restart all
pm2 logs
pm2 status

# Systemd
sudo systemctl start iradio-wakeword
sudo systemctl stop iradio-wakeword
sudo systemctl restart iradio-wakeword
sudo systemctl status iradio-wakeword

# Nginx
sudo systemctl restart nginx
sudo nginx -t
```

### Important Directories

- Application: `/home/iradio/jamie-radio`
- Logs: `/home/iradio/jamie-radio/logs`
- Nginx config: `/etc/nginx/sites-available/iradio`
- Systemd service: `/etc/systemd/system/iradio-wakeword.service`

### Important Ports

- 3000: Frontend (Vite preview)
- 3001: API Server
- 8000: Python Wake Word Server
- 80: HTTP (Nginx)
- 443: HTTPS (Nginx)

---

## Security Checklist

- [ ] Firewall configured (UFW)
- [ ] SSH key authentication enabled
- [ ] Root login disabled
- [ ] SSL/HTTPS configured
- [ ] Environment variables secured (.env file permissions)
- [ ] Regular security updates
- [ ] Non-root user for application
- [ ] Backups configured
- [ ] Log rotation enabled

---

## Support

For issues or questions:
- Check logs: `pm2 logs` and `sudo journalctl -u iradio-wakeword`
- Review this guide's troubleshooting section
- Check GitHub issues: https://github.com/jamie-armoordon/jamie-radio/issues

---

**Last Updated**: 2025-01-XX
**Version**: 1.0.0

