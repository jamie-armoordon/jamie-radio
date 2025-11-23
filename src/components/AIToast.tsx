"use client"

import { motion, AnimatePresence } from "framer-motion"
import { useAIStore } from "../store/aiStore"
import { useSettingsStore } from "../store/settingsStore"
import { useReducedMotion } from "framer-motion"
import { useEffect, useState } from "react"

export default function AIToast() {
  const { phase, lastCommand, error } = useAIStore()
  const { aiVisualFeedback } = useSettingsStore()
  const shouldReduceMotion = useReducedMotion()
  const [recordingCountdown, setRecordingCountdown] = useState(3)

  useEffect(() => {
    if (phase === "recording") {
      setRecordingCountdown(3)
      const interval = setInterval(() => {
        setRecordingCountdown((prev) => {
          if (prev <= 0.1) {
            clearInterval(interval)
            return 0
          }
          return prev - 0.1
        })
      }, 100)
      return () => clearInterval(interval)
    }
  }, [phase])

  if (!aiVisualFeedback) {
    return null
  }

  const getMessage = (): string => {
    switch (phase) {
      case "listening":
        return "Listening for wake word…"
      case "wake_detected":
        return "Wake word detected"
      case "recording":
        return `🎤 Listening... ${Math.ceil(recordingCountdown)}s`
      case "processing":
        return "Processing…"
      case "executing":
        if (lastCommand) {
          if (lastCommand.command === "play" && lastCommand.station) {
            return `Playing ${lastCommand.station}`
          }
          if (lastCommand.command === "next") {
            return "Switching to next station"
          }
          if (lastCommand.command === "previous") {
            return "Switching to previous station"
          }
          if (lastCommand.command === "volume") {
            return `Volume ${lastCommand.action === "up" ? "up" : "down"}`
          }
          if (lastCommand.command === "mute") {
            return "Muted"
          }
          if (lastCommand.command === "unmute") {
            return "Unmuted"
          }
          if (lastCommand.command === "info") {
            return "Getting track info"
          }
        }
        return "Executing…"
      case "speaking":
        return lastCommand?.text || "Responding…"
      case "error":
        return error || "Error occurred"
      default:
        return ""
    }
  }

  const getPhaseStyle = () => {
    switch (phase) {
      case "listening":
        return {
          bgColor: "bg-purple-500/10",
          borderColor: "border-purple-500/30",
          textColor: "text-purple-100",
          accentColor: "bg-purple-500",
        }
      case "wake_detected":
        return {
          bgColor: "bg-pink-500/10",
          borderColor: "border-pink-500/40",
          textColor: "text-pink-100",
          accentColor: "bg-pink-500",
        }
      case "recording":
        return {
          bgColor: "bg-red-500/20",
          borderColor: "border-red-500/60",
          textColor: "text-red-100",
          accentColor: "bg-red-500",
        }
      case "processing":
        return {
          bgColor: "bg-blue-500/10",
          borderColor: "border-blue-500/30",
          textColor: "text-blue-100",
          accentColor: "bg-blue-500",
        }
      case "executing":
        return {
          bgColor: "bg-green-500/10",
          borderColor: "border-green-500/30",
          textColor: "text-green-100",
          accentColor: "bg-green-500",
        }
      case "speaking":
        return {
          bgColor: "bg-indigo-500/10",
          borderColor: "border-indigo-500/30",
          textColor: "text-indigo-100",
          accentColor: "bg-indigo-500",
        }
      case "error":
        return {
          bgColor: "bg-red-500/20",
          borderColor: "border-red-500/50",
          textColor: "text-red-100",
          accentColor: "bg-red-500",
        }
      default:
        return {
          bgColor: "bg-slate-500/10",
          borderColor: "border-slate-500/30",
          textColor: "text-slate-100",
          accentColor: "bg-slate-500",
        }
    }
  }

  const message = getMessage()
  const showToast = phase !== "idle" && message.length > 0
  const style = getPhaseStyle()

  return (
    <AnimatePresence>
      {showToast && (
        <motion.div
          className="fixed bottom-24 right-6 z-[151] pointer-events-none"
          initial={{ opacity: 0, y: 20, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.9 }}
          transition={shouldReduceMotion ? { duration: 0.2 } : { type: "spring", damping: 25, stiffness: 300 }}
        >
          <div
            className={`relative overflow-hidden rounded-2xl ${style.bgColor} backdrop-blur-xl border ${style.borderColor} shadow-2xl`}
          >
            <div className={`absolute left-0 top-0 bottom-0 w-1 ${style.accentColor}`} />

            <div className="pl-4 pr-4 py-3 ml-2">
              <p className={`${style.textColor} text-sm font-medium leading-relaxed`}>{message}</p>
            </div>

            {phase === "recording" && !shouldReduceMotion && (
              <motion.div
                className={`absolute bottom-0 left-0 h-0.5 ${style.accentColor}`}
                initial={{ width: "100%" }}
                animate={{ width: "0%" }}
                transition={{ duration: 3, ease: "linear" }}
              />
            )}

            {phase === "processing" && !shouldReduceMotion && (
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent"
                animate={{ x: ["-100%", "100%"] }}
                transition={{
                  duration: 1.5,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: "linear",
                }}
                style={{ willChange: "transform" }}
              />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
