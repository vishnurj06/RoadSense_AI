"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { UploadCloud, Loader2, ImageUp } from "lucide-react";
import { T } from "@/lib/motion";

/**
 * UploadPanel — drag-target for demo road-image uploads.
 *
 * Now accepts a real drag-and-drop, not just a click: the old version rendered
 * a dashed box that *looked* droppable and silently ignored a dropped file.
 * The synthetic event below is what lets it reuse the caller's existing
 * onChange handler unchanged.
 *
 * Props:
 *   onUpload:  (e: ChangeEvent<HTMLInputElement>) => void
 *   uploading: boolean
 */
export default function UploadPanel({ onUpload, uploading }) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (uploading) return;
    const file = e.dataTransfer?.files?.[0];
    if (!file || !file.type?.startsWith("image/")) return;
    // Hand the caller the same shape its <input onChange> gives it.
    onUpload({ target: { files: [file] } });
  };

  return (
    <section
      className="bg-surface/70 border-line flex shrink-0 flex-col gap-2.5 rounded-2xl border p-3 backdrop-blur-xl"
      data-testid="upload-panel"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ImageUp className="text-ink-3 h-3.5 w-3.5" />
          <span className="eyebrow">Telemetry upload</span>
        </div>
        <AnimatePresence>
          {uploading && (
            <motion.span
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={T.fast}
              className="text-accent flex items-center gap-1.5 text-[10px] font-medium"
            >
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              Analysing…
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <motion.label
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        whileHover={uploading ? {} : { scale: 1.005 }}
        transition={T.fast}
        className={`relative flex h-[86px] cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border border-dashed transition-colors ${
          uploading
            ? "border-line bg-sunken/40 pointer-events-none opacity-50"
            : dragging
              ? "border-accent/60 bg-accent/8"
              : "border-line bg-sunken/40 hover:border-accent/40 hover:bg-accent/4"
        }`}
      >
        <input
          type="file"
          accept="image/*"
          onChange={onUpload}
          className="hidden"
          disabled={uploading}
          data-testid="file-input"
        />

        {/* Scanline — only while work is actually happening. */}
        {uploading && (
          <motion.div
            className="via-accent/60 absolute inset-x-0 h-px bg-gradient-to-r from-transparent to-transparent"
            initial={{ top: 0 }}
            animate={{ top: ["0%", "100%", "0%"] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
        )}

        <motion.div animate={dragging ? { y: -2, scale: 1.08 } : { y: 0, scale: 1 }} transition={T.spring}>
          <UploadCloud
            className={`h-4.5 w-4.5 transition-colors ${dragging ? "text-accent" : "text-ink-3"}`}
          />
        </motion.div>
        <span className="text-ink-2 text-[11px] font-medium">
          {dragging ? "Release to analyse" : "Drop a road image, or click"}
        </span>
        <span className="text-ink-3 font-mono text-[9px]">mock GPS · Mumbai bbox</span>
      </motion.label>
    </section>
  );
}
