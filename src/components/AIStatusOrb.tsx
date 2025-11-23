"use client"

import { motion, useReducedMotion } from "framer-motion"
import { useAIStore } from "../store/aiStore"
import { Mic, Check, Loader2 } from "lucide-react"
import { useSettingsStore } from "../store/settingsStore"

export default function AIStatusOrb() {
  const phase = useAIStore((state) => state.phase) // Use selector to ensure re-renders on phase changes
  const { aiVisualFeedback, largeControls } = useSettingsStore()
  const shouldReduceMotion = useReducedMotion()

  if (!aiVisualFeedback || phase === "idle") {
    return null
  }

  const isFullscreen = largeControls

  const getPhaseConfig = () => {
    switch (phase) {
      case "listening":
        return {
          bgGradient: "from-purple-500/20 to-blue-500/20",
          borderColor: "rgba(147, 51, 234, 0.4)",
          glowColor: "rgba(147, 51, 234, 0.3)",
          icon: null,
          pulseAnimation: true,
        }
      case "wake_detected":
        return {
          bgGradient: "from-purple-500/30 to-pink-500/30",
          borderColor: "rgba(236, 72, 153, 0.8)",
          glowColor: "rgba(236, 72, 153, 0.5)",
          icon: null,
          rippleAnimation: true,
        }
      case "recording":
        return {
          bgGradient: "from-red-500/40 to-pink-500/40",
          borderColor: "rgba(239, 68, 68, 1)",
          glowColor: "rgba(239, 68, 68, 0.6)",
          icon: <Mic className="w-5 h-5 animate-pulse" />,
          progressRing: true,
          pulseAnimation: true, // Add pulse to make it more obvious
        }
      case "processing":
        return {
          bgGradient: "from-blue-500/30 to-cyan-500/30",
          borderColor: "rgba(59, 130, 246, 0.8)",
          glowColor: "rgba(59, 130, 246, 0.4)",
          icon: <Loader2 className="w-5 h-5 animate-spin" />,
          shimmerAnimation: true,
        }
      case "executing":
        return {
          bgGradient: "from-green-500/30 to-emerald-500/30",
          borderColor: "rgba(34, 197, 94, 0.8)",
          glowColor: "rgba(34, 197, 94, 0.4)",
          icon: <Check className="w-5 h-5" />,
          checkAnimation: true,
        }
      case "speaking":
        return {
          bgGradient: "from-purple-500/30 to-indigo-500/30",
          borderColor: "rgba(168, 85, 247, 0.8)",
          glowColor: "rgba(168, 85, 247, 0.4)",
          icon: null,
          waveformAnimation: true,
        }
      case "error":
        return {
          bgGradient: "from-red-500/40 to-orange-500/40",
          borderColor: "rgba(239, 68, 68, 1)",
          glowColor: "rgba(239, 68, 68, 0.6)",
          icon: null,
          shakeAnimation: true,
        }
      default:
        return {
          bgGradient: "from-slate-500/20 to-gray-500/20",
          borderColor: "rgba(255, 255, 255, 0.2)",
          glowColor: "rgba(255, 255, 255, 0.1)",
          icon: null,
        }
    }
  }

  const config = getPhaseConfig()

  return (
    <div
      className={`fixed z-[150] pointer-events-none ${
        isFullscreen ? "bottom-8 left-1/2 -translate-x-1/2" : "bottom-6 right-6"
      }`}
    >
      <motion.div
        className="relative"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      >
        <motion.div
          className="absolute inset-0 rounded-full blur-xl"
          style={{
            background: config.glowColor,
            willChange: "transform, opacity",
          }}
          animate={
            shouldReduceMotion
              ? {}
              : config.pulseAnimation
                ? {
                    scale: [1, 1.4, 1],
                    opacity: [0.4, 0.8, 0.4],
                  }
                : {}
          }
          transition={
            config.pulseAnimation && !shouldReduceMotion
              ? {
                  duration: 1.5,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: "easeInOut",
                }
              : {}
          }
        />

        <motion.div
          className={`relative w-16 h-16 rounded-full flex items-center justify-center backdrop-blur-xl bg-gradient-to-br ${config.bgGradient} border-2`}
          style={{
            borderColor: config.borderColor,
            boxShadow: `0 0 40px ${config.glowColor}, 0 8px 32px rgba(0, 0, 0, 0.4)`,
            willChange: "transform",
          }}
          animate={
            shouldReduceMotion
              ? {}
              : phase === "recording"
                ? {
                    scale: [1, 1.1, 1],
                    borderColor: [config.borderColor, "rgba(239, 68, 68, 1)", config.borderColor],
                  }
                : config.shakeAnimation
                  ? {
                      x: [-2, 2, -2, 2, 0],
                      rotate: [-1, 1, -1, 1, 0],
                    }
                  : config.checkAnimation
                    ? {
                        scale: [1, 1.15, 1],
                      }
                    : {}
          }
          transition={
            phase === "recording" && !shouldReduceMotion
              ? {
                  duration: 0.3,
                  repeat: 3,
                  ease: "easeInOut",
                }
              : config.shakeAnimation && !shouldReduceMotion
                ? {
                    duration: 0.4,
                    ease: "easeInOut",
                  }
                : config.checkAnimation && !shouldReduceMotion
                  ? {
                      duration: 0.5,
                      ease: [0.34, 1.56, 0.64, 1],
                    }
                  : {}
          }
        >
          {config.rippleAnimation && !shouldReduceMotion && (
            <>
              <motion.div
                className="absolute inset-0 rounded-full border-2"
                style={{ borderColor: config.borderColor }}
                initial={{ scale: 1, opacity: 1 }}
                animate={{ scale: 2.5, opacity: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
              <motion.div
                className="absolute inset-0 rounded-full border-2"
                style={{ borderColor: config.borderColor }}
                initial={{ scale: 1, opacity: 0.6 }}
                animate={{ scale: 2, opacity: 0 }}
                transition={{ duration: 0.8, delay: 0.15, ease: "easeOut" }}
              />
            </>
          )}

          {config.progressRing && !shouldReduceMotion && (
            <motion.svg className="absolute inset-0 w-16 h-16 -rotate-90" viewBox="0 0 64 64">
              <motion.circle
                cx="32"
                cy="32"
                r="28"
                fill="none"
                stroke={config.borderColor}
                strokeWidth="3"
                strokeDasharray="175.9"
                strokeDashoffset={0}
                strokeLinecap="round"
                initial={{ strokeDashoffset: 0 }}
                animate={{ strokeDashoffset: 175.9 }}
                transition={{
                  duration: 3,
                  ease: "linear",
                }}
              />
            </motion.svg>
          )}

          {config.shimmerAnimation && !shouldReduceMotion && (
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{
                background: "conic-gradient(from 0deg, transparent, rgba(59, 130, 246, 0.4), transparent)",
                willChange: "transform",
              }}
              animate={{ rotate: 360 }}
              transition={{
                duration: 1.5,
                repeat: Number.POSITIVE_INFINITY,
                ease: "linear",
              }}
            />
          )}

          {config.waveformAnimation && !shouldReduceMotion && (
            <div className="absolute inset-0 flex items-center justify-center gap-1">
              {[0, 1, 2, 3, 4].map((i) => (
                <motion.div
                  key={i}
                  className="w-0.5 bg-white rounded-full"
                  animate={{
                    height: [6, 18, 6],
                    opacity: [0.5, 1, 0.5],
                  }}
                  transition={{
                    duration: 0.6,
                    repeat: Number.POSITIVE_INFINITY,
                    delay: i * 0.08,
                    ease: "easeInOut",
                  }}
                  style={{ willChange: "height, opacity" }}
                />
              ))}
            </div>
          )}

          {config.icon && (
            <motion.div
              className="relative z-10 text-white"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
            >
              {config.icon}
            </motion.div>
          )}
        </motion.div>
      </motion.div>
    </div>
  )
}
