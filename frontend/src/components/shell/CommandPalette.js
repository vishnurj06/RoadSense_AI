"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, CornerDownLeft } from "lucide-react";
import { pop, fade, T } from "@/lib/motion";

/**
 * CommandPalette — ⌘K / Ctrl-K.
 *
 * Keyboard-first navigation and actions. Also the honest answer to "where did
 * that setting go" once panels collapse: everything reachable by click stays
 * reachable by typing.
 *
 * Commands are supplied by the caller so the palette stays role-aware — it can
 * only ever offer what the current user can actually do.
 *
 * Split in two on purpose. The dialog only mounts while open, so "reset the
 * query and cursor each time it opens" is just useState's initializer running
 * on a fresh mount — no effect writing state, no cascading render.
 */
export default function CommandPalette({ open, onClose, commands }) {
  return (
    <AnimatePresence>
      {open && <PaletteDialog onClose={onClose} commands={commands} />}
    </AnimatePresence>
  );
}

function PaletteDialog({ onClose, commands }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.group?.toLowerCase().includes(q) ||
        c.hint?.toLowerCase().includes(q)
    );
  }, [query, commands]);

  /**
   * Group headers are decided here rather than by mutating a `lastGroup`
   * variable while mapping — reassigning during render is not safe across
   * re-renders, and this is a pure derivation anyway.
   */
  const rows = useMemo(
    () =>
      results.map((cmd, i) => ({
        cmd,
        showGroup: cmd.group && cmd.group !== results[i - 1]?.group,
      })),
    [results]
  );

  // Clamp rather than reset-on-change: keeps the cursor valid as results
  // shrink, without an effect writing state.
  const active = Math.min(cursor, Math.max(results.length - 1, 0));

  const run = (cmd) => {
    onClose();
    cmd?.run?.();
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor(Math.min(active + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor(Math.max(active - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  // Keep the cursor row in view when arrowing past the fold. Reads and scrolls
  // the DOM — it never writes React state, which is exactly what an effect is
  // for.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <motion.div
      className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]"
      initial="hidden"
      animate="show"
      exit="exit"
    >
      <motion.div
        variants={fade}
        onClick={onClose}
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
      />

      <motion.div
        variants={pop}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        className="border-line bg-surface/95 relative w-full max-w-lg overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-2xl"
      >
        {/* Query */}
        <div className="border-line flex items-center gap-2.5 border-b px-4">
          <Search className="text-ink-3 h-4 w-4 shrink-0" />
          <input
            // Autofocus is correct here: the palette exists only because the
            // user just asked for it, and typing is its entire purpose.
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            placeholder="Jump to a section, or run an action…"
            className="text-ink placeholder:text-ink-3 w-full bg-transparent py-3.5 text-[13px] outline-none"
          />
          <kbd className="border-line bg-sunken text-ink-3 rounded border px-1.5 py-0.5 font-mono text-[10px]">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="custom-scrollbar max-h-[46vh] overflow-y-auto p-1.5">
          {rows.length === 0 && (
            <p className="text-ink-3 py-8 text-center text-[12px]">No matches for “{query}”</p>
          )}
          {rows.map(({ cmd, showGroup }, i) => {
            const Icon = cmd.icon;
            const activeRow = i === active;
            return (
              <React.Fragment key={cmd.id}>
                {showGroup && <p className="eyebrow px-2.5 pt-3 pb-1.5">{cmd.group}</p>}
                <button
                  type="button"
                  data-idx={i}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => run(cmd)}
                  className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    activeRow ? "bg-accent/10 text-ink" : "text-ink-2 hover:bg-raised"
                  }`}
                >
                  {Icon && (
                    <Icon
                      className={`h-3.5 w-3.5 shrink-0 ${activeRow ? "text-accent" : "text-ink-3"}`}
                    />
                  )}
                  <span className="flex-1 truncate text-[13px]">{cmd.label}</span>
                  {cmd.hint && <span className="text-ink-3 truncate text-[11px]">{cmd.hint}</span>}
                  {activeRow && (
                    <motion.span
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={T.fast}
                    >
                      <CornerDownLeft className="text-accent h-3 w-3" />
                    </motion.span>
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}
