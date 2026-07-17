"use client";

import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { toastIn } from "@/lib/motion";

/**
 * Toast — transient confirmation, bottom-centre.
 *
 * Moved off the bottom-right corner: that corner now sits over the map, where
 * a dark chip on dark tiles is easy to miss. Centre-bottom is in the reading
 * path and clear of the panel column.
 *
 * The timer bar is not decoration — it shows how long you have left to read it.
 */
const VARIANTS = {
  success: { icon: CheckCircle2, ring: "border-good/35", tint: "text-good", bar: "bg-good" },
  error: {
    icon: AlertTriangle,
    ring: "border-critical/35",
    tint: "text-critical",
    bar: "bg-critical",
  },
  info: { icon: Info, ring: "border-accent/35", tint: "text-accent", bar: "bg-accent" },
};

export default function Toast({ toast, duration = 4 }) {
  const v = VARIANTS[toast?.type] || VARIANTS.info;
  const Icon = v.icon;

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          data-testid="toast"
          role="status"
          aria-live="polite"
          variants={toastIn}
          initial="hidden"
          animate="show"
          exit="exit"
          className={`bg-surface/95 pointer-events-none fixed bottom-6 left-1/2 z-[60] w-max max-w-[90vw] -translate-x-1/2 overflow-hidden rounded-xl border shadow-2xl backdrop-blur-xl ${v.ring}`}
        >
          <div className="flex items-center gap-2.5 px-3.5 py-2.5">
            <Icon className={`h-4 w-4 shrink-0 ${v.tint}`} />
            <span className="text-ink text-[12px] font-medium">{toast.message}</span>
          </div>
          <motion.div
            key={toast.message}
            className={`h-0.5 ${v.bar} opacity-50`}
            initial={{ width: "100%" }}
            animate={{ width: "0%" }}
            transition={{ duration, ease: "linear" }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
