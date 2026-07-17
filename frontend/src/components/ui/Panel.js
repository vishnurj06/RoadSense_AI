"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";
import { rise, T } from "@/lib/motion";

/**
 * Panel — the one container primitive.
 *
 * Every sidebar section used to hand-roll `bg-slate-900/40 border
 * border-slate-800/60 p-4 rounded-2xl` plus its own header row, so there was no
 * hierarchy: a filter box and the pending-action queue looked identically
 * important. This gives them one shape, one header, and one collapse
 * behaviour, and lets the *content* differentiate them.
 *
 * Panels float over the map, so they are translucent + blurred rather than
 * opaque — the canvas reads through them and the app feels like one surface.
 *
 * Props:
 *   title       string  — section name (rendered as an eyebrow, not a shout)
 *   icon        Icon    — lucide component
 *   count       number  — optional trailing count chip
 *   actions     node    — right-aligned controls
 *   collapsible bool
 *   defaultOpen bool
 *   dense       bool    — tighter padding for filter-ish panels
 *   testId      string  — preserved for the existing test suite
 */
export default function Panel({
  title,
  icon: Icon,
  count,
  actions,
  children,
  collapsible = false,
  defaultOpen = true,
  dense = false,
  className = "",
  bodyClassName = "",
  testId,
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <motion.section
      variants={rise}
      data-testid={testId}
      className={`bg-surface/70 border-line hover:border-line/80 rounded-2xl border backdrop-blur-xl transition-colors ${className}`}
      style={{ boxShadow: "0 1px 0 0 rgba(255,255,255,0.03) inset" }}
    >
      {(title || actions) && (
        <header
          className={`flex items-center justify-between gap-2 ${dense ? "px-3 pt-3 pb-2" : "px-4 pt-3.5 pb-2.5"}`}
        >
          <button
            type="button"
            onClick={collapsible ? () => setOpen((o) => !o) : undefined}
            disabled={!collapsible}
            className={`group flex min-w-0 items-center gap-2 ${collapsible ? "cursor-pointer" : "cursor-default"}`}
          >
            {Icon && (
              <Icon className="text-ink-3 group-hover:text-accent h-3.5 w-3.5 shrink-0 transition-colors" />
            )}
            <span className="eyebrow group-hover:text-ink-2 truncate transition-colors">
              {title}
            </span>
            {count != null && (
              <span className="bg-raised text-ink-3 tnum border-line rounded-full border px-1.5 py-px text-[10px] font-medium">
                {count}
              </span>
            )}
            {collapsible && (
              <motion.span
                animate={{ rotate: open ? 0 : -90 }}
                transition={T.fast}
                className="text-ink-3 group-hover:text-ink-2"
              >
                <ChevronDown className="h-3 w-3" />
              </motion.span>
            )}
          </button>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={collapsible ? { height: 0, opacity: 0 } : false}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={T.base}
            className="overflow-hidden"
          >
            <div
              className={`${dense ? "px-3 pb-3" : "px-4 pb-4"} ${title ? "" : dense ? "pt-3" : "pt-4"} ${bodyClassName}`}
            >
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
