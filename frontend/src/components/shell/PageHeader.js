"use client";

import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { RefreshCw, Search, TriangleAlert } from "lucide-react";
import { LiveDot, IconButton } from "@/components/ui/Primitives";
import { T } from "@/lib/motion";

/**
 * PageHeader — title, subtitle, live state, and per-view actions.
 *
 * The old top bar only ever said "RoadSense AI · Overview", so a view had no
 * way to say what it was for. A title plus one line of subtitle costs almost
 * nothing and means each destination introduces itself.
 */
export default function PageHeader({
  title,
  subtitle,
  error,
  loading,
  onRefresh,
  onOpenPalette,
  actions,
}) {
  return (
    <header className="border-line bg-canvas/80 relative z-20 flex h-14 shrink-0 items-center gap-4 border-b px-5 backdrop-blur-xl">
      <div className="flex min-w-0 flex-col">
        <AnimatePresence mode="wait">
          <motion.h1
            key={title}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={T.fast}
            className="text-ink truncate text-[15px] leading-tight font-semibold tracking-tight"
          >
            {title}
          </motion.h1>
        </AnimatePresence>
        {subtitle && (
          <span className="text-ink-3 truncate text-[10px] tracking-[0.08em] uppercase">
            {subtitle}
          </span>
        )}
      </div>

      <div className="flex-1" />

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={T.base}
            className="bg-critical/10 border-critical/30 text-critical hidden max-w-sm items-center gap-2 rounded-lg border px-2.5 py-1.5 xl:flex"
          >
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate text-[11px] font-medium">{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {actions}

      <LiveDot label={error ? "Offline" : "Live"} active={!error} />

      <button
        type="button"
        onClick={onOpenPalette}
        className="border-line bg-raised/60 text-ink-3 hover:border-accent/30 hover:text-ink-2 hidden cursor-pointer items-center gap-2 rounded-lg border py-1.5 pr-1.5 pl-2.5 transition-colors md:flex"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="text-[11px]">Search…</span>
        <kbd className="border-line bg-sunken text-ink-3 ml-3 rounded border px-1.5 py-0.5 font-mono text-[10px]">
          ⌘K
        </kbd>
      </button>

      <IconButton
        icon={RefreshCw}
        label="Refresh data"
        onClick={onRefresh}
        disabled={loading}
        spinning={loading}
      />
    </header>
  );
}
