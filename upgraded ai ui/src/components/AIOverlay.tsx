"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Mic, Loader2, X, Sparkles, Volume2 } from "lucide-react"
import { useAIStore } from "../store/aiStore"
import { getVoiceControl } from "../services/voiceControl"

export default function AIOverlay() {
  const { phase, setPhase, lastCommand, error } = useAIStore()
  const [transcript, setTranscript] = useState("")

  // Close handler
  const handleClose = () => {
    const voiceControl = getVoiceControl()
    if (voiceControl) voiceControl.stop()
    setPhase("idle")
  }

  // Update transcript based on phase
  useEffect(() => {
    if (phase === "listening") setTranscript("Say 'Jarvis'...")
    if (phase === "wake_detected") setTranscript("I'm listening...")
    if (phase === "recording") setTranscript("Listening...")
    if (phase === "processing") setTranscript("Thinking...")
    if (phase === "executing") setTranscript(lastCommand?.text || "Done!")
    if (phase === "speaking") setTranscript(lastCommand?.text || "Speaking...")
    if (phase === "error") setTranscript(error || "Something went wrong")
  }, [phase, lastCommand, error])

  // Only show overlay when active
  const isActive = phase !== "idle" && phase !== "listening"

  return (
    <AnimatePresence>
      {isActive && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.6 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
          />

          {/* Overlay Card */}
          <motion.div
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 p-4 md:p-6 flex justify-center pointer-events-none"
          >
            <div className="bg-slate-900/90 border border-white/10 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden pointer-events-auto backdrop-blur-xl">
              {/* Header / Close */}
              <div className="flex items-center justify-between p-4 border-b border-white/5">
                <div className="flex items-center gap-2 text-purple-400 font-medium">
                  <Sparkles size={18} />
                  <span>Jarvis AI</span>
                </div>
                <button
                  onClick={handleClose}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/50 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 flex flex-col items-center text-center gap-6">
                {/* Visualizer Area */}
                <div className="relative w-24 h-24 flex items-center justify-center">
                  {/* Rings */}
                  {(phase === "recording" || phase === "wake_detected") && (
                    <motion.div
                      animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                      transition={{ repeat: Number.POSITIVE_INFINITY, duration: 2 }}
                      className="absolute inset-0 bg-purple-500/20 rounded-full"
                    />
                  )}

                  {/* Main Icon Circle */}
                  <div
                    className={`
                    w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-all duration-500
                    ${
                      phase === "error"
                        ? "bg-red-500/20 text-red-400"
                        : phase === "processing"
                          ? "bg-blue-500/20 text-blue-400"
                          : phase === "speaking"
                            ? "bg-green-500/20 text-green-400"
                            : "bg-purple-500/20 text-purple-400"
                    }
                  `}
                  >
                    {phase === "processing" ? (
                      <Loader2 className="animate-spin w-8 h-8" />
                    ) : phase === "speaking" ? (
                      <Volume2 className="w-8 h-8 animate-pulse" />
                    ) : phase === "error" ? (
                      <X className="w-8 h-8" />
                    ) : (
                      <Mic className="w-8 h-8" />
                    )}
                  </div>
                </div>

                {/* Status Text */}
                <div className="space-y-2">
                  <motion.h3
                    key={transcript}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-xl font-medium text-white"
                  >
                    {transcript}
                  </motion.h3>
                  <p className="text-sm text-white/40">
                    {phase === "recording"
                      ? "Listening for command..."
                      : phase === "processing"
                        ? "Processing audio..."
                        : phase === "speaking"
                          ? "Responding..."
                          : ""}
                  </p>
                </div>

                {/* Waveform Animation (CSS-only simplicity) */}
                {(phase === "speaking" || phase === "recording") && (
                  <div className="flex items-center gap-1 h-8">
                    {[...Array(5)].map((_, i) => (
                      <motion.div
                        key={i}
                        animate={{ height: [8, 24, 8] }}
                        transition={{
                          repeat: Number.POSITIVE_INFINITY,
                          duration: 0.8,
                          delay: i * 0.1,
                          ease: "easeInOut",
                        }}
                        className="w-1 bg-white/50 rounded-full"
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
