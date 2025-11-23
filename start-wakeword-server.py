#!/usr/bin/env python3
"""
Start script for the wake word detection server.
This script starts the FastAPI server on port 8000.
Automatically uses virtual environment if available.
"""
import sys
import os

# CRITICAL: Change to script directory immediately to avoid numpy source tree issues
# This is especially important with MSYS2 Python which might have numpy in the path
script_dir = os.path.dirname(os.path.abspath(__file__))
original_cwd = os.getcwd()
os.chdir(script_dir)

# Try to use virtual environment if it exists
current_dir = os.path.dirname(os.path.abspath(__file__))
venv_dir = os.path.join(current_dir, 'wakeword-venv')

# CRITICAL: Remove current_dir from sys.path early to prevent numpy import conflicts
# Python may have added it automatically, and it can cause issues
while current_dir in sys.path:
    sys.path.remove(current_dir)

# Check if current_dir (iRadio folder) has a numpy directory that could cause conflicts
numpy_in_current_dir = os.path.join(current_dir, 'numpy')
if os.path.exists(numpy_in_current_dir) and os.path.isdir(numpy_in_current_dir):
    print(f"[ERROR] Found numpy directory in {current_dir}")
    print(f"   This will cause import conflicts. Please remove or rename:")
    print(f"   {numpy_in_current_dir}")
    sys.exit(1)

# Add the test directory to path if server.py is there (do this BEFORE venv to check for conflicts)
# Check both relative and absolute paths
test_dir_rel = os.path.join(current_dir, 'test')
test_dir_abs = os.path.join(os.path.expanduser('~'), 'Desktop', 'test')

server_path = None
# Check current directory first (most common case)
if os.path.exists(os.path.join(current_dir, 'server.py')):
    server_path = current_dir
elif os.path.exists(os.path.join(test_dir_rel, 'server.py')):
    server_path = test_dir_rel
elif os.path.exists(os.path.join(test_dir_abs, 'server.py')):
    server_path = test_dir_abs

# Check for numpy directory in server path that could cause conflicts
if server_path:
    numpy_dir = os.path.join(server_path, 'numpy')
    if os.path.exists(numpy_dir) and os.path.isdir(numpy_dir):
        print(f"[WARN] Found numpy directory in {server_path}, this will cause import conflicts")
        print(f"   Please remove or rename: {numpy_dir}")
        print(f"   Or move server.py to a different directory without numpy/")
        sys.exit(1)

# STEP 1: Set up sys.path with venv first
# CRITICAL: Remove MSYS2 site-packages which might contain numpy source tree
# MSYS2's site-packages can cause "source directory" errors
msys2_paths_to_remove = []
for path in sys.path:
    if 'msys64' in path and 'site-packages' in path:
        msys2_paths_to_remove.append(path)

if msys2_paths_to_remove:
    print(f"[WARN] Removing MSYS2 site-packages from sys.path to avoid numpy conflicts")
    for path in msys2_paths_to_remove:
        while path in sys.path:
            sys.path.remove(path)

# Remove all problematic paths
paths_to_remove_initially = ['', '.', original_cwd, script_dir, current_dir]
for path in paths_to_remove_initially:
    while path in sys.path:
        sys.path.remove(path)
    
# Also check if original_cwd contains numpy (MSYS2 might have started there)
if original_cwd and original_cwd != script_dir:
    numpy_in_original = os.path.join(original_cwd, 'numpy')
    if os.path.exists(numpy_in_original) and os.path.isdir(numpy_in_original):
        print(f"[WARN] Original working directory {original_cwd} contains numpy directory")
        print(f"   This may cause import conflicts. We've changed to {script_dir}")

# Add venv to Python path if it exists (works on all platforms)
if os.path.exists(venv_dir):
    if sys.platform == 'win32':
        venv_site_packages = os.path.join(venv_dir, 'Lib', 'site-packages')
    else:
        venv_site_packages = os.path.join(venv_dir, 'lib', f'python{sys.version_info.major}.{sys.version_info.minor}', 'site-packages')
    
    if os.path.exists(venv_site_packages):
        # Remove any existing venv path
        while venv_site_packages in sys.path:
            sys.path.remove(venv_site_packages)
        # Remove problematic paths again (in case they were re-added)
        for path in paths_to_remove_initially:
            while path in sys.path:
                sys.path.remove(path)
        # Insert venv at position 0 to ensure it takes precedence
        sys.path.insert(0, venv_site_packages)
        print("[OK] Using virtual environment")
        print(f"[DEBUG] Working directory: {os.getcwd()}")
    else:
        print("[INFO] Virtual environment found but site-packages not found")
        print("   Run: python setup-wakeword-venv.py to set up the venv")
else:
    print("[INFO] No virtual environment found. Using system Python.")
    print("   For isolated dependencies, run: python setup-wakeword-venv.py")

# Check for numpy conflicts in server path
if server_path:
    numpy_paths = [
        os.path.join(server_path, 'numpy'),
        os.path.join(server_path, 'numpy.py'),
        os.path.join(server_path, 'numpy.pyc'),
    ]
    for numpy_path in numpy_paths:
        if os.path.exists(numpy_path):
            print(f"[ERROR] Found numpy conflict in {server_path}: {numpy_path}")
            print(f"   This will prevent numpy from importing correctly.")
            print(f"   Please remove or rename: {numpy_path}")
            sys.exit(1)
    
    # DON'T add server_path to sys.path yet - we'll add it after numpy is imported
    # Adding it now can cause numpy to detect it as a source tree
    print(f"[INFO] Will use server from: {server_path}")
    print(f"[DEBUG] sys.path before numpy import (first 3): {sys.path[:3]}")

# STEP 2: Import numpy BEFORE changing directory and BEFORE adding server_path
# This ensures numpy is imported from venv, not from a source directory
# CRITICAL: Make sure server_path is NOT in sys.path when importing numpy
if server_path and server_path in sys.path:
    while server_path in sys.path:
        sys.path.remove(server_path)

try:
    import numpy
    print(f"[OK] numpy imported successfully from: {numpy.__file__}")
except ImportError as numpy_error:
    print(f"[ERROR] Failed to import numpy: {numpy_error}")
    print(f"   Current working directory: {os.getcwd()}")
    print(f"   sys.path: {sys.path[:5]}...")
    # Check if current directory has numpy
    cwd_numpy = os.path.join(os.getcwd(), 'numpy')
    if os.path.exists(cwd_numpy):
        print(f"   WARNING: Current directory contains numpy: {cwd_numpy}")
    print("\n[INFO] Please install dependencies:")
    print("   pip install -r requirements.txt")
    sys.exit(1)

# NOW add server_path to sys.path (after numpy is safely imported)
if server_path and server_path not in sys.path:
    sys.path.append(server_path)

# STEP 3: Change directory only after numpy is imported
if server_path and os.getcwd() != server_path:
    original_cwd = os.getcwd()
    os.chdir(server_path)
    print(f"[INFO] Changed directory to: {server_path}")
    
    # STEP 4: Clean sys.path again after chdir
    # Python automatically adds '' (current dir) when you chdir, which can cause issues
    while '' in sys.path:
        sys.path.remove('')
    while '.' in sys.path:
        sys.path.remove('.')
    while current_dir in sys.path:
        sys.path.remove(current_dir)
    
    # Re-ensure venv is first after cleaning
    if os.path.exists(venv_dir):
        if sys.platform == 'win32':
            venv_site_packages = os.path.join(venv_dir, 'Lib', 'site-packages')
        else:
            venv_site_packages = os.path.join(venv_dir, 'lib', f'python{sys.version_info.major}.{sys.version_info.minor}', 'site-packages')
        if venv_site_packages in sys.path:
            sys.path.remove(venv_site_packages)
        sys.path.insert(0, venv_site_packages)
    
    # Re-add server path if needed
    if server_path not in sys.path:
        sys.path.append(server_path)

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
    try:
        uvicorn.run(
            app,
            host="0.0.0.0",
            port=8000,
            log_level="info",
            loop=loop_type,
        )
    except OSError as e:
        if e.errno == 10048 or 'Address already in use' in str(e):
            print(f"[ERROR] Port 8000 is already in use. Please stop the other process or change the port.")
            print(f"   To find what's using port 8000, run: netstat -ano | findstr :8000")
            sys.exit(1)
        else:
            raise
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
