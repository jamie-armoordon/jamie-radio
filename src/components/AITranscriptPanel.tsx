import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAIStore } from '../store/aiStore';
import { ChevronUp, ChevronDown, X } from 'lucide-react';

export default function AITranscriptPanel() {
  const { interactionLog, lastWakeAt, lastWakeScore, lastCommand } = useAIStore();
  const [isOpen, setIsOpen] = useState(false);

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  const formatPhase = (phase: string) => {
    return phase.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  };

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 left-6 z-[152] p-2 rounded-full bg-slate-900/80 backdrop-blur-xl border border-white/10 text-white hover:bg-slate-800 transition-colors"
        aria-label="Toggle AI transcript"
      >
        {isOpen ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
      </button>

      {/* Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="fixed bottom-16 left-6 z-[152] w-96 max-h-96 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-xl overflow-hidden"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">AI Interaction Log</h3>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded hover:bg-white/10 transition-colors"
                aria-label="Close"
              >
                <X size={18} className="text-white/70" />
              </button>
            </div>

            <div className="overflow-y-auto max-h-80 p-4 space-y-3">
              {/* Last Wake Info */}
              {lastWakeAt && (
                <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                  <div className="text-xs text-purple-400 mb-1">Last Wake Detection</div>
                  <div className="text-sm text-white">
                    {formatTimestamp(lastWakeAt)}
                    {lastWakeScore !== undefined && (
                      <span className="text-white/60 ml-2">(score: {lastWakeScore.toFixed(2)})</span>
                    )}
                  </div>
                </div>
              )}

              {/* Last Command */}
              {lastCommand && (
                <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <div className="text-xs text-blue-400 mb-1">Last Command</div>
                  <div className="text-sm text-white font-mono">
                    {JSON.stringify(lastCommand, null, 2)}
                  </div>
                </div>
              )}

              {/* Interaction Log */}
              {interactionLog.length === 0 ? (
                <div className="text-center text-white/50 text-sm py-8">
                  No interactions yet
                </div>
              ) : (
                interactionLog.map((entry, index) => (
                  <motion.div
                    key={entry.timestamp}
                    className="p-3 bg-white/5 border border-white/10 rounded-lg"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-white/70">{formatTimestamp(entry.timestamp)}</span>
                      <span className="text-xs px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded">
                        {formatPhase(entry.phase)}
                      </span>
                    </div>
                    {entry.wakeScore !== undefined && (
                      <div className="text-xs text-white/60 mt-1">
                        Wake score: {entry.wakeScore.toFixed(2)}
                      </div>
                    )}
                    {entry.command && (
                      <div className="text-xs text-white/80 mt-1 font-mono">
                        {entry.command.command}
                        {entry.command.station && ` - ${entry.command.station}`}
                      </div>
                    )}
                    {entry.spokenText && (
                      <div className="text-xs text-white/70 mt-1 italic">
                        "{entry.spokenText}"
                      </div>
                    )}
                    {entry.error && (
                      <div className="text-xs text-red-400 mt-1">{entry.error}</div>
                    )}
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

