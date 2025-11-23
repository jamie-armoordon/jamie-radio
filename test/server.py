"""
FastAPI WebSocket server for real-time wake word detection.
Optimized for low latency.
Also includes MARS5 TTS endpoint for local text-to-speech.
"""
import asyncio
import json
import numpy as np
import torch
import librosa
import io
import base64
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
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
mars5_model = None
mars5_config = None
mars5_ref_audio = None
mars5_ref_transcript = None

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

def get_mars5_model():
    """Lazy initialization of the MARS5 TTS model"""
    global mars5_model, mars5_config, mars5_ref_audio, mars5_ref_transcript
    if mars5_model is None:
        try:
            logger.info("Initializing MARS5 TTS model...")
            mars5_model, mars5_config = torch.hub.load('Camb-ai/mars5-tts', 'mars5_english', trust_repo=True)
            logger.info("MARS5 model loaded successfully")
            
            # Load reference audio for radio DJ voice
            # Try to find reference audio file, or use a default
            ref_audio_path = os.path.join(os.path.dirname(__file__), 'reference_audio.wav')
            if not os.path.exists(ref_audio_path):
                logger.warning(f"Reference audio not found at {ref_audio_path}, MARS5 TTS will use shallow clone")
                mars5_ref_audio = None
                mars5_ref_transcript = None
            else:
                wav, sr = librosa.load(ref_audio_path, sr=mars5_model.sr, mono=True)
                mars5_ref_audio = torch.from_numpy(wav)
                # Default transcript for radio DJ voice
                mars5_ref_transcript = "Welcome to the radio. This is your host speaking."
                logger.info(f"Reference audio loaded: {len(mars5_ref_audio)} samples at {sr}Hz")
        except Exception as e:
            logger.error(f"Failed to initialize MARS5 model: {e}")
            logger.error("MARS5 TTS will not be available. Install dependencies: pip install torch torchaudio librosa vocos encodec safetensors regex")
            mars5_model = False  # Mark as failed
    return mars5_model, mars5_config, mars5_ref_audio, mars5_ref_transcript

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

class TTSRequest(BaseModel):
    text: str
    deep_clone: bool = False  # Default to shallow clone for low latency (set True for better quality with reference audio)

@app.post("/tts")
async def tts_endpoint(request: TTSRequest):
    """
    MARS5 TTS endpoint for local text-to-speech generation.
    
    Request:
    {
        "text": "Hello, this is a test",
        "deep_clone": false  // Optional, default false (shallow clone for low latency)
    }
    
    Response:
    {
        "audio": "base64-encoded-audio-data",
        "format": "wav",
        "sample_rate": 24000
    }
    
    Note: Generation may take 10-30 seconds on CPU. GPU recommended for faster generation.
    Shallow clone (deep_clone=false) is optimized for low latency but may be slower on CPU.
    """
    try:
        model, config_class, ref_audio, ref_transcript = get_mars5_model()
        
        if model is False or model is None:
            raise HTTPException(
                status_code=503,
                detail="MARS5 TTS model not available. Please install dependencies: pip install torch torchaudio librosa vocos encodec safetensors regex"
            )
        
        if not request.text or not request.text.strip():
            raise HTTPException(status_code=400, detail="Text is required")
        
        logger.info(f"Generating TTS for text: {request.text[:50]}...")
        logger.info(f"Text length: {len(request.text)} characters")
        
        # Determine if we should use deep clone (requires reference audio + transcript)
        use_deep_clone = request.deep_clone and ref_audio is not None and ref_transcript
        
        # Configure inference for low latency (shallow clone) or high quality (deep clone)
        if use_deep_clone:
            # Deep clone: better quality, slower
            cfg = config_class(
                deep_clone=True,
                rep_penalty_window=100,
                top_k=100,
                temperature=0.7,
                freq_penalty=3
            )
            logger.info("Using deep clone mode (higher quality, slower)")
        else:
            # Shallow clone: faster, lower quality - optimized for low latency
            # Minimal parameters for fastest generation on CPU
            cfg = config_class(
                deep_clone=False,
                rep_penalty_window=30,  # Minimal for speed
                top_k=20,  # Minimal for speed (faster convergence)
                temperature=0.6,  # Slightly lower for faster generation
                freq_penalty=1  # Minimal for speed
            )
            logger.info("Using shallow clone mode (low latency, optimized for CPU speed)")
            logger.info("Note: Large model (~750M params) - generation may take 10-30 seconds on CPU")
        
        # Generate TTS with progress logging
        import time
        start_time = time.time()
        logger.info("Starting TTS generation (this may take 10-30 seconds on CPU)...")
        
        try:
            if use_deep_clone and ref_audio is not None:
                # Deep clone: use reference audio and transcript
                logger.info("Generating with deep clone (reference audio + transcript)")
                ar_codes, output_audio = model.tts(
                    request.text,
                    ref_audio,
                    ref_transcript,
                    cfg=cfg
                )
            else:
                # Shallow clone: minimal or no reference audio
                # Use empty tensor or minimal silence for fastest generation
                if ref_audio is not None:
                    # Use existing reference but without transcript (shallow clone)
                    logger.info("Generating with shallow clone (reference audio, no transcript)")
                    ar_codes, output_audio = model.tts(
                        request.text,
                        ref_audio,
                        "",  # Empty transcript for shallow clone
                        cfg=cfg
                    )
                else:
                    # No reference audio - use minimal dummy input
                    logger.info("Generating with shallow clone (minimal reference)")
                    dummy_ref = torch.zeros(int(model.sr * 0.1))  # 0.1 second silence (minimal)
                    ar_codes, output_audio = model.tts(
                        request.text,
                        dummy_ref,
                        "",  # Empty transcript
                        cfg=cfg
                    )
            
            generation_time = time.time() - start_time
            logger.info(f"TTS generation completed in {generation_time:.2f} seconds")
            
        except Exception as gen_error:
            generation_time = time.time() - start_time
            logger.error(f"TTS generation failed after {generation_time:.2f} seconds: {gen_error}")
            raise
        
        # Convert to numpy and ensure it's the right format
        if isinstance(output_audio, torch.Tensor):
            output_audio = output_audio.cpu().numpy()
        
        # Normalize audio to prevent clipping
        max_val = np.abs(output_audio).max()
        if max_val > 1.0:
            output_audio = output_audio / max_val
        
        # Convert to int16 PCM
        output_audio_int16 = (output_audio * 32767).astype(np.int16)
        
        # Convert to WAV bytes
        import wave
        wav_buffer = io.BytesIO()
        with wave.open(wav_buffer, 'wb') as wav_file:
            wav_file.setnchannels(1)  # Mono
            wav_file.setsampwidth(2)  # 16-bit
            wav_file.setframerate(model.sr)  # 24kHz
            wav_file.writeframes(output_audio_int16.tobytes())
        
        wav_bytes = wav_buffer.getvalue()
        audio_base64 = base64.b64encode(wav_bytes).decode('utf-8')
        
        logger.info(f"TTS generated successfully: {len(wav_bytes)} bytes")
        
        return JSONResponse({
            "audio": audio_base64,
            "format": "wav",
            "sample_rate": int(model.sr)
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"TTS generation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"TTS generation failed: {str(e)}")

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

