"""
FastAPI WebSocket server for real-time wake word detection.
Optimized for low latency.
"""
import asyncio
import json
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from openwakeword import Model
import logging
import os

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(title="Wake Word Detection API")

# Enable CORS for PWA
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your PWA domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Audio settings
CHUNK_SIZE = 1280  # 80ms at 16kHz
SAMPLE_RATE = 16000
THRESHOLD = 0.35  # Detection threshold for moving average (lowered for better sensitivity)
HIGH_THRESHOLD = 0.5  # Higher threshold for single-chunk detection (strong detections)

# Initialize wake word model (shared across connections)
wake_model = None

def get_model():
    """Lazy initialization of the wake word model"""
    global wake_model
    if wake_model is None:
        logger.info("Initializing wake word model...")
        wake_model = Model(
            wakeword_models=['hey_jarvis'],
            inference_framework='onnx'
        )
        logger.info("Model initialized")
    return wake_model

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "running",
        "service": "wake-word-detection",
        "model": "hey_jarvis"
    }

@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"status": "healthy"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time wake word detection.
    
    Protocol:
    - Client sends: Binary audio data (int16 PCM, 16kHz, mono)
    - Server sends: JSON messages with detection events
        {
            "type": "detection",
            "score": 0.95,
            "timestamp": 1234567890.123
        }
    """
    await websocket.accept()
    logger.info("WebSocket connection established")
    
    model = get_model()
    audio_buffer = np.array([], dtype=np.int16)
    last_detection_time = 0
    DEBOUNCE_SECONDS = 1.5  # Prevent duplicate detections within 1.5 seconds (reduced for faster re-detection)
    
    # Score smoothing with sliding window
    score_window = []  # Track last N scores
    MAX_WINDOW_SIZE = 5  # Keep last 5 scores for moving average
    
    try:
        while True:
            # Receive audio data from client
            data = await websocket.receive_bytes()
            
            # Convert bytes to int16 numpy array
            audio_chunk = np.frombuffer(data, dtype=np.int16)
            
            # Add to buffer
            audio_buffer = np.concatenate([audio_buffer, audio_chunk])
            
            # Process when we have enough samples (80ms chunks)
            while len(audio_buffer) >= CHUNK_SIZE:
                # Extract chunk
                chunk = audio_buffer[:CHUNK_SIZE]
                audio_buffer = audio_buffer[CHUNK_SIZE:]
                
                # Audio normalization: only boost very quiet audio (less aggressive)
                # Don't normalize if audio is already at reasonable levels to avoid breaking model
                max_amplitude = np.abs(chunk).max()
                if max_amplitude > 0 and max_amplitude < 5000:  # Only normalize if very quiet (< 15% of max)
                    # Gentle boost for very quiet audio only
                    target_peak = 10000  # ~30% of max int16 (gentle boost)
                    gain = min(target_peak / max_amplitude, 3.0)  # Cap gain at 3x to avoid distortion
                    # Apply gain but ensure we don't clip
                    chunk_normalized = (chunk.astype(np.float32) * gain).astype(np.int16)
                    # Clamp to int16 range to prevent overflow
                    chunk = np.clip(chunk_normalized, -32768, 32767)
                
                # Get prediction (low latency - process immediately)
                prediction = model.predict(chunk)
                
                # Check for detection
                for mdl in model.models.keys():
                    if mdl in prediction:
                        score = float(prediction[mdl])
                        
                        # Add score to sliding window for smoothing
                        score_window.append(score)
                        if len(score_window) > MAX_WINDOW_SIZE:
                            score_window.pop(0)
                        
                        # Calculate moving average
                        avg_score = sum(score_window) / len(score_window) if score_window else 0
                        
                        # Dual-threshold system:
                        # - Use moving average with lower threshold (catches sustained detections)
                        # - Use single score with higher threshold (catches strong single detections)
                        should_detect = (avg_score > THRESHOLD) or (score > HIGH_THRESHOLD)
                        
                        # Log near-miss scores for debugging (within 0.1 of threshold but didn't trigger)
                        # This helps identify if threshold needs further adjustment
                        if not should_detect and (score > (THRESHOLD - 0.1) or avg_score > (THRESHOLD - 0.1)):
                            logger.debug(f"Near-miss: score={score:.3f}, avg={avg_score:.3f} (thresholds: {THRESHOLD}/{HIGH_THRESHOLD})")
                        
                        # Send detection if above threshold
                        if should_detect:
                            current_time = asyncio.get_event_loop().time()
                            time_since_last = current_time - last_detection_time
                            
                            # Debounce: only send if enough time has passed
                            if time_since_last >= DEBOUNCE_SECONDS:
                                response = {
                                    "type": "detection",
                                    "model": mdl,
                                    "score": round(score, 3),
                                    "timestamp": int(current_time * 1000)  # Convert to milliseconds
                                }
                                try:
                                    # Log before sending (include average score for debugging)
                                    logger.info(f"Wake word detected: score={score:.3f}, avg={avg_score:.3f} - Preparing to send message: {response}")
                                    await websocket.send_json(response)
                                    last_detection_time = current_time
                                    # Clear score window after detection to prevent carry-over
                                    score_window = []
                                    logger.info(f"Wake word detected: score={score:.3f}, avg={avg_score:.3f} - ✓ Message sent successfully to client (debounced: {time_since_last:.2f}s since last)")
                                except Exception as send_error:
                                    logger.error(f"✗ Failed to send detection message: {send_error}")
                                    logger.error(f"WebSocket client state: {websocket.client_state if hasattr(websocket, 'client_state') else 'unknown'}")
                                    logger.error(f"WebSocket application state: {websocket.application_state if hasattr(websocket, 'application_state') else 'unknown'}")
                                    import traceback
                                    logger.error(traceback.format_exc())
                            else:
                                logger.info(f"Wake word detected: {score:.3f} - Ignored (debounced, {time_since_last:.2f}s since last detection)")
                        
                        # Optionally send all scores for debugging (comment out for production)
                        # response = {
                        #     "type": "score",
                        #     "model": mdl,
                        #     "score": round(score, 3)
                        # }
                        # await websocket.send_json(response)
    
    except WebSocketDisconnect:
        logger.info("WebSocket connection closed")
    except Exception as e:
        logger.error(f"Error in WebSocket: {e}", exc_info=True)
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e)
            })
        except:
            pass

if __name__ == "__main__":
    import uvicorn
    import sys
    
    # Try to use uvloop for better performance (optional)
    try:
        import uvloop
        loop_type = "uvloop"
    except ImportError:
        loop_type = "asyncio"
        logger.warning("uvloop not available, using asyncio. Install uvloop for better performance: pip install uvloop")
    
    # Run with optimized settings for low latency
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
        loop=loop_type,
    )

