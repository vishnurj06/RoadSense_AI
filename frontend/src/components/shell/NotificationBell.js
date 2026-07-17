"use client";

/**
 * NotificationBell — the in-app bell feed (B3-2, code item #8).
 *
 * The notifications backend (routers/notifications.py) has always existed but was
 * completely unconsumed — high-severity alerts were computed and never shown. This
 * is the missing UI: an unread-count badge + a dropdown that lists recent
 * notifications, marks them read, and polls every 60 s.
 *
 * Follows the codebase's await-first fetch rule (no synchronous setState before the
 * first await) so the poll never trips react-hooks/set-state-in-effect — the same
 * discipline page.js's fetchData uses.
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Bell, Check, TriangleAlert } from "lucide-react";
import { IconButton } from "@/components/ui/Primitives";
import { T } from "@/lib/motion";

const BACKEND_URL = "http://localhost:8000";

function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function NotificationBell() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // await-first: the body reaches `await fetch(...)` before any setState, so this is
  // safe to call directly from an effect and from the interval.
  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/notifications?limit=20`, {
        credentials: "include",
      });
      if (!res.ok) return; // 401/500 → stay quiet; page.js owns the auth redirect
      const data = await res.json();
      setItems(data.notifications || []);
      setUnread(data.unread_count || 0);
    } catch {
      // Network error — leave the last known state in place, try again next poll.
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
    const id = setInterval(() => {
      load();
    }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const markOne = async (id) => {
    // Optimistic: flip locally, then confirm with the server.
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    try {
      await fetch(`${BACKEND_URL}/notifications/${id}/read`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      load(); // reconcile on failure
    }
  };

  const markAll = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnread(0);
    try {
      await fetch(`${BACKEND_URL}/notifications/read-all`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      load();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <IconButton
          icon={Bell}
          label="Notifications"
          active={open}
          onClick={() => setOpen((o) => !o)}
        />
        {unread > 0 && (
          <span className="bg-critical text-canvas pointer-events-none absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={T.fast}
            className="border-line bg-canvas absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border shadow-xl"
          >
            <div className="border-line flex items-center justify-between border-b px-3 py-2">
              <span className="text-ink text-[12px] font-semibold">
                Notifications
                {unread > 0 && (
                  <span className="text-ink-3 ml-1 font-normal">({unread} new)</span>
                )}
              </span>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={markAll}
                  className="text-ink-3 hover:text-accent flex cursor-pointer items-center gap-1 text-[10px] transition-colors"
                >
                  <Check className="h-3 w-3" />
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto">
              {items.length === 0 ? (
                <div className="text-ink-3 px-3 py-8 text-center text-[11px]">
                  No notifications yet.
                </div>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => !n.is_read && markOne(n.id)}
                    className={`border-line flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                      n.is_read ? "opacity-60" : "bg-accent/5 hover:bg-accent/10"
                    }`}
                  >
                    <TriangleAlert
                      className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                        n.is_read ? "text-ink-3" : "text-critical"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-ink truncate text-[11px] font-medium">
                        {n.title}
                      </div>
                      {n.body && (
                        <div className="text-ink-3 mt-0.5 line-clamp-2 text-[10px]">
                          {n.body}
                        </div>
                      )}
                      <div className="text-ink-3 mt-0.5 text-[9px]">
                        {timeAgo(n.created_at)}
                      </div>
                    </div>
                    {!n.is_read && (
                      <span className="bg-accent mt-1 h-1.5 w-1.5 shrink-0 rounded-full" />
                    )}
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
