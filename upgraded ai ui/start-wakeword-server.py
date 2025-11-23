#!/usr/bin/env python3
"""
Start script for the wake word detection server.
This script starts the FastAPI server on port 8000.
Automatically uses virtual environment if available.
"""
import sys
import os

# Try to use virtual environment if it exists
current_dir = os.path.dirname(os.path.abspath(__file__))
venv_dir = os.path.join(current_dir, 'wakeword-venv')

# Add venv to Python path if it exists (works on all platforms)
if os.path.exists(venv_dir):
    if sys.platform == 'win32':
        venv_site_packages = os.path.join(venv_dir, 'Lib', 'site-packages')
    else:
        venv_site_packages = os.path.join(venv_dir, 'lib', f'python{sys.version_info.major}.{sys.version_info.minor}', 'site-packages')
    
    if os.path.exists(venv_site_packages):
        sys.path.insert(0, venv_site_packages)
        print("[OK] Using virtual environment")
    else:
        print("[INFO] Virtual environment found but site-packages not found")
        print("   Run: python setup-wakeword-venv.py to set up the venv")
else:
    print("[INFO] No virtual environment found. Using system Python.")
    print("   For isolated dependencies, run: python setup-wakeword-venv.py")

# Add the test directory to path if server.py is there
# Check both relative and absolute paths
test_dir_rel = os.path.join(current_dir, '..', 'test')
test_dir_abs = os.path.join(os.path.expanduser('~'), 'Desktop', 'test')

server_path = None
if os.path.exists(os.path.join(test_dir_abs, 'server.py')):
    server_path = test_dir_abs
elif os.path.exists(os.path.join(test_dir_rel, 'server.py')):
    server_path = test_dir_rel
elif os.path.exists(os.path.join(current_dir, 'server.py')):
    server_path = current_dir

if server_path:
    sys.path.insert(0, server_path)
    os.chdir(server_path)
    print(f"[INFO] Using server from: {server_path}")

try:
    import uvicorn
    
    # Try to use uvloop for better performance (optional)
    try:
        import uvloop
        loop_type = "uvloop"
        print("[OK] Using uvloop for better performance")
    except ImportError:
        loop_type = "asyncio"
        print("[WARN] uvloop not available, using asyncio. Install for better performance: pip install uvloop")
    
    # Import the server
    from server import app
    print("[OK] Server module loaded successfully")
    
    print("[START] Starting wake word detection server on http://0.0.0.0:8000")
    print("   WebSocket endpoint: ws://localhost:8000/ws")
    
    # Run with optimized settings for low latency
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
        loop=loop_type,
    )
except ImportError as e:
    print(f"[ERROR] Import error: {e}")
    print("\n[INFO] Please install dependencies:")
    print("   pip install -r requirements.txt")
    sys.exit(1)
except Exception as e:
    print(f"[ERROR] Error starting server: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
