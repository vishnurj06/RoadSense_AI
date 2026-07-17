"use client";

import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Activity, LogOut, ChevronLeft } from "lucide-react";
import { T } from "@/lib/motion";

/**
 * Sidebar — labelled, collapsible navigation.
 *
 * Replaces the icon-only rail. Icons alone made every destination a guess: you
 * had to hover each one to learn what it was, and there is no icon that
 * self-evidently means "model registry". Labels are the default; collapsing to
 * icons is opt-in, for when the map wants the room.
 *
 * Sections are role-derived, so a fleet user never sees an admin destination
 * rather than seeing one that rejects them.
 */
export default function Sidebar({
  sections,
  active,
  onSelect,
  user,
  onLogout,
  collapsed,
  onToggle,
}) {
  return (
    <motion.nav
      animate={{ width: collapsed ? 68 : 236 }}
      transition={T.base}
      className="border-line bg-canvas relative z-30 flex shrink-0 flex-col border-r"
    >
      {/* Brand */}
      <div className="border-line flex h-14 items-center gap-2.5 border-b px-4">
        <div className="border-accent/25 bg-accent/10 grid h-8 w-8 shrink-0 place-items-center rounded-lg border">
          <Activity className="text-accent h-4 w-4" strokeWidth={2.5} />
        </div>
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={T.fast}
              className="flex min-w-0 flex-col"
            >
              <span className="text-ink truncate text-[13px] leading-tight font-semibold tracking-tight">
                RoadSense<span className="text-ink-3 font-normal"> AI</span>
              </span>
              <span className="text-ink-3 truncate text-[9px] tracking-[0.1em] uppercase">
                Road intelligence
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Destinations */}
      <div className="flex flex-1 flex-col gap-0.5 p-2.5">
        {sections.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              title={collapsed ? label : undefined}
              aria-current={isActive ? "page" : undefined}
              className={`group relative flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 transition-colors ${
                isActive ? "text-accent" : "text-ink-3 hover:text-ink-2 hover:bg-raised/60"
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="nav-active"
                  transition={T.spring}
                  className="bg-accent/10 border-accent/25 absolute inset-0 rounded-lg border"
                />
              )}
              <Icon className="relative h-4 w-4 shrink-0" />
              <AnimatePresence initial={false}>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={T.fast}
                    className="relative truncate text-[12.5px] font-medium"
                  >
                    {label}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          );
        })}
      </div>

      {/* User */}
      <div className="border-line flex items-center gap-2.5 border-t p-2.5">
        <div className="border-accent/25 bg-accent/10 text-accent grid h-8 w-8 shrink-0 place-items-center rounded-lg border text-[11px] font-semibold uppercase">
          {user?.username?.slice(0, 2)}
        </div>
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={T.fast}
              className="flex min-w-0 flex-1 flex-col"
            >
              <span className="text-ink truncate text-[12px] leading-tight font-medium">
                {user?.username}
              </span>
              <span className="text-ink-3 truncate text-[9px] tracking-[0.1em] uppercase">
                {user?.role}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        <button
          type="button"
          onClick={onLogout}
          title="Sign out"
          aria-label="Sign out"
          className="text-ink-3 hover:text-critical hover:bg-critical/10 grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-md transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Collapse handle — hangs on the border, out of the content's way */}
      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="border-line bg-raised text-ink-3 hover:text-accent hover:border-accent/40 absolute top-16 -right-3 z-40 grid h-6 w-6 cursor-pointer place-items-center rounded-full border transition-colors"
      >
        <motion.span animate={{ rotate: collapsed ? 180 : 0 }} transition={T.fast}>
          <ChevronLeft className="h-3 w-3" />
        </motion.span>
      </button>
    </motion.nav>
  );
}
