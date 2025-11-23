"use client"

import type React from "react"

import { motion, AnimatePresence } from "framer-motion"
import { useAIStore } from "../store/aiStore"
import { Mic, Loader2, Sparkles, Volume2, AlertCircle, Check } from "lucide-react"
import { getVoiceControl } from "../services/voiceControl"
import { useMemo } from "react"

interface AIIntegratedStatusProps {
  variant?: "compact" | "full" | "pill"
  className?: string
}

export default function AIIntegratedStatus({ variant = "pill", className = "" }: AIIntegratedStatusProps) {
  const { phase, lastCommand, error } = useAIStore()

  const handleTrigger = (e: React.MouseEvent) => {
    e.stopPropagation()
    const voiceControl = getVoiceControl()
    if (voiceControl) {
      if (phase === "listening" || phase === "recording") {
        // Optional: stop recording?
      } else {
        voiceControl.startCommandRecording()
      }
    }
  }

  const statusConfig = useMemo(() => {
    switch (phase) {
      case "idle":
        return {
          icon: <Sparkles size={variant === "compact" ? 18 : 20} />,
          color: "text-purple-300",
          bgColor: "bg-purple-500/10",
          borderColor: "border-purple-500/20",
          text: "Ask AI",
          showText: false,
        }
      case "listening":
      case "wake_detected":
        return {
          icon: <Mic size={variant === "compact" ? 18 : 20} className="animate-pulse" />,
          color: "text-blue-300",
          bgColor: "bg-blue-500/20",
          borderColor: "border-blue-500/30",
          text: "Listening...",
          showText: true,
        }
      case "recording":
        return {
          icon: <Mic size={variant === "compact" ? 18 : 20} className="text-red-400" />,
          color: "text-red-300",
          bgColor: "bg-red-500/20",
          borderColor: "border-red-500/30",
          text: "Listening...",
          showText: true,
        }
      case "processing":
        return {
          icon: <Loader2 size={variant === "compact" ? 18 : 20} className="animate-spin" />,
          color: "text-indigo-300",
          bgColor: "bg-indigo-500/20",
          borderColor: "border-indigo-500/30",
          text: "Thinking...",
          showText: true,
        }
      case "executing":
        return {
          icon: <Check size={variant === "compact" ? 18 : 20} />,
          color: "text-emerald-300",
          bgColor: "bg-emerald-500/20",
          borderColor: "border-emerald-500/30",
          text: "Done",
          showText: true,
        }
      case "speaking":
        return {
          icon: <Volume2 size={variant === "compact" ? 18 : 20} className="animate-pulse" />,
          color: "text-violet-300",
          bgColor: "bg-violet-500/20",
          borderColor: "border-violet-500/30",
          text: "Speaking...",
          showText: true,
        }
      case "error":
        return {
          icon: <AlertCircle size={variant === "compact" ? 18 : 20} />,
          color: "text-rose-300",
          bgColor: "bg-rose-500/20",
          borderColor: "border-rose-500/30",
          text: "Error",
          showText: true,
        }
      default:
        return {
          icon: <Sparkles size={variant === "compact" ? 18 : 20} />,
          color: "text-slate-300",
          bgColor: "bg-slate-800/50",
          borderColor: "border-slate-700",
          text: "AI",
          showText: false,
        }
    }
  }, [phase, variant])

  // Get display text
  const displayText = useMemo(() => {
    if (phase === "error") return error || "Error"
    if (phase === "speaking" && lastCommand?.text) return "Speaking..." // simplified for pill
    if (phase === "executing" && lastCommand?.text) return lastCommand.text
    return statusConfig.text
  }, [phase, error, lastCommand, statusConfig.text])

  // Compact mode: just the icon button
  if (variant === "compact") {
    return (
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleTrigger}
        className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-colors ${statusConfig.bgColor} ${statusConfig.color} ${className}`}
      >
        {statusConfig.icon}
        {/* Status indicator dot for compact mode */}
        {phase !== "idle" && (
          <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-current rounded-full border-2 border-slate-900" />
        )}
      </motion.button>
    )
  }

  // Pill/Full mode
  return (
    <motion.button
      layout
      onClick={handleTrigger}
      className={`
        relative flex items-center gap-2 px-4 py-2 rounded-full border backdrop-blur-md transition-all overflow-hidden
        ${statusConfig.bgColor} ${statusConfig.borderColor} ${statusConfig.color}
        ${className}
      `}
      initial={false}
      animate={{
        backgroundColor: statusConfig.bgColor.replace("bg-", ""), // Framer motion handles color interpolation better with raw values, but class switching works ok too
      }}
    >
      <div className="relative z-10 flex items-center gap-2">
        {statusConfig.icon}

        <AnimatePresence mode="wait">
          {(statusConfig.showText || variant === "full") && (
            <motion.span
              key="text"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              className="text-sm font-medium whitespace-nowrap overflow-hidden"
            >
              {displayText}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Animated background pulses for active states */}
      {(phase === "listening" || phase === "recording" || phase === "processing") && (
        <motion.div
          className="absolute inset-0 bg-current opacity-10"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.1, 0.2, 0.1],
          }}
          transition={{
            duration: 2,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        />
      )}
    </motion.button>
  )
}
