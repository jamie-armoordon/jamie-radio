# Wake Word Detection Setup

The wake word detection uses a Python FastAPI WebSocket server that runs alongside the Node.js API server.

## Prerequisites

1. **Python 3.8+** installed
2. **pip** package manager

## Installation

### Option 1: Using Virtual Environment (Recommended)

1. Set up the virtual environment and install dependencies:
\`\`\`bash
npm run setup:wakeword
\`\`\`

Or directly:
\`\`\`bash
python setup-wakeword-venv.py
\`\`\`

This will:
- Create a `wakeword-venv` directory
- Install all required dependencies
- Install optional uvloop for better performance

### Option 2: System-wide Installation

1. Install Python dependencies globally:
\`\`\`bash
pip install -r requirements.txt
\`\`\`

Or install manually:
\`\`\`bash
pip install fastapi uvicorn[standard] websockets openwakeword numpy python-multipart
\`\`\`

2. (Optional) Install uvloop for better performance:
\`\`\`bash
pip install uvloop
\`\`\`

## Running the Servers

### Option 1: Run Everything Together (Recommended)
\`\`\`bash
npm run dev:full
\`\`\`

This starts:
- Node.js API server (port 3001)
- Python wake word server (port 8000)
- Vite dev server (port 3000)

### Option 2: Run Separately

Terminal 1 - Node.js API:
\`\`\`bash
npm run dev:api
\`\`\`

Terminal 2 - Python Wake Word Server:
\`\`\`bash
npm run dev:wakeword
\`\`\`

Or directly:
\`\`\`bash
python start-wakeword-server.py
\`\`\`

Terminal 3 - Frontend:
\`\`\`bash
npm run dev
\`\`\`

## Server Endpoints

- **Wake Word WebSocket**: `ws://localhost:8000/ws`
- **Health Check**: `http://localhost:8000/health`
- **Root**: `http://localhost:8000/`

## How It Works

1. The Python server (`server.py`) runs on port 8000
2. The frontend connects to `ws://localhost:8000/ws` via WebSocket
3. Audio is streamed as int16 PCM (16kHz, mono) to the server
4. The server uses `openwakeword` with the "hey_jarvis" model
5. When "Jarvis" is detected, the server sends a JSON detection event
6. The frontend triggers voice command recording

## Troubleshooting

### Server won't start
- Check Python version: `python --version` (needs 3.8+)
- Install dependencies: `pip install -r requirements.txt`
- Check if port 8000 is available

### WebSocket connection fails
- Ensure the Python server is running
- Check browser console for errors
- Check firewall settings

### No detections
- Check microphone permissions
- Verify audio is being sent (check browser console)
- Test the server health endpoint: `http://localhost:8000/health`
