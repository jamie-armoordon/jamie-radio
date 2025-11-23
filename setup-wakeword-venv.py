#!/usr/bin/env python3
"""
Setup script for wake word server virtual environment.
Creates a venv and installs dependencies.
"""
import os
import sys
import subprocess
import venv

def main():
    venv_dir = os.path.join(os.path.dirname(__file__), 'wakeword-venv')
    
    print("[SETUP] Setting up Python virtual environment for wake word server...")
    print(f"   Venv location: {venv_dir}")
    
    # Create venv if it doesn't exist
    if not os.path.exists(venv_dir):
        print("[INFO] Creating virtual environment...")
        venv.create(venv_dir, with_pip=True)
        print("[OK] Virtual environment created")
    else:
        print("[OK] Virtual environment already exists")
    
    # Determine pip path based on OS
    if sys.platform == 'win32':
        pip_path = os.path.join(venv_dir, 'Scripts', 'pip.exe')
        python_path = os.path.join(venv_dir, 'Scripts', 'python.exe')
    else:
        pip_path = os.path.join(venv_dir, 'bin', 'pip')
        python_path = os.path.join(venv_dir, 'bin', 'python')
    
    # Install requirements
    requirements_file = os.path.join(os.path.dirname(__file__), 'requirements.txt')
    if os.path.exists(requirements_file):
        print("[INFO] Installing dependencies...")
        try:
            subprocess.check_call([pip_path, 'install', '-r', requirements_file])
            print("[OK] Dependencies installed")
        except subprocess.CalledProcessError as e:
            print(f"[ERROR] Failed to install dependencies: {e}")
            sys.exit(1)
    else:
        print(f"[WARN] requirements.txt not found at {requirements_file}")
        print("   Installing basic dependencies...")
        try:
            subprocess.check_call([pip_path, 'install', 'fastapi', 'uvicorn[standard]', 'websockets', 'openwakeword', 'numpy', 'python-multipart'])
            print("[OK] Basic dependencies installed")
        except subprocess.CalledProcessError as e:
            print(f"[ERROR] Failed to install dependencies: {e}")
            sys.exit(1)
    
    # Try to install uvloop (optional, for better performance)
    print("[INFO] Installing optional uvloop for better performance...")
    try:
        subprocess.check_call([pip_path, 'install', 'uvloop'])
        print("[OK] uvloop installed")
    except subprocess.CalledProcessError:
        print("[WARN] uvloop installation failed (optional, will use asyncio)")
    
    print("\n[OK] Setup complete!")
    print("\n[INFO] MARS5 TTS dependencies included (torch, librosa, vocos, encodec, etc.)")
    print("   First TTS generation will download ~1.2GB model files automatically")
    print(f"\n[START] To start the server, run:")
    print(f"   npm run dev:wakeword")
    print(f"   or")
    if sys.platform == 'win32':
        print(f"   {python_path} start-wakeword-server.py")
    else:
        print(f"   {python_path} start-wakeword-server.py")

if __name__ == '__main__':
    main()
