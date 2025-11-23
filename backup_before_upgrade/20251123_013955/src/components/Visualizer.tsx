import { useEffect, useRef } from 'react';

interface VisualizerProps {
  audioElement: HTMLAudioElement | null;
  enabled: boolean;
}

export default function Visualizer({ audioElement, enabled }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const bufferLengthRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled || !audioElement) {
      // Cleanup
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      if (analyserRef.current) {
        analyserRef.current.disconnect();
        analyserRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Create audio context and analyser
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      const source = audioContext.createMediaElementSource(audioElement);
      sourceRef.current = source;

      // Connect: source → analyser → destination
      source.connect(analyser);
      analyser.connect(audioContext.destination);

      bufferLengthRef.current = analyser.frequencyBinCount;

      // Draw function
      const draw = () => {
        if (!enabled || !analyserRef.current) return;

        animationFrameRef.current = requestAnimationFrame(draw);

        // Create array inline to ensure correct type
        const dataArray = new Uint8Array(bufferLengthRef.current);
        analyserRef.current.getByteFrequencyData(dataArray);

        const width = canvas.width / window.devicePixelRatio;
        const height = canvas.height / window.devicePixelRatio;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.fillRect(0, 0, width, height);

        const barCount = 64;
        const barWidth = width / barCount;
        const barGap = barWidth * 0.1;

        for (let i = 0; i < barCount; i++) {
          const dataIndex = Math.floor((i / barCount) * dataArray.length);
          const value = dataArray[dataIndex];
          const barHeight = (value / 255) * height * 0.8;

          // Gradient colors
          const hue = (i / barCount) * 360;
          ctx.fillStyle = `hsl(${hue}, 70%, 60%)`;

          const x = i * barWidth;
          ctx.fillRect(
            x + barGap,
            height - barHeight,
            barWidth - barGap * 2,
            barHeight
          );
        }
      };

      draw();
    } catch (error) {
      console.error('Failed to create audio visualizer:', error);
    }

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      if (analyserRef.current) {
        analyserRef.current.disconnect();
        analyserRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, [enabled, audioElement]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-24 bg-slate-900/50"
      style={{ willChange: 'transform', transform: 'translateZ(0)' }}
    />
  );
}

