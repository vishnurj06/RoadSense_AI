"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  Activity,
  Lock,
  User as UserIcon,
  TriangleAlert,
  ArrowRight,
  Loader2,
  Check,
} from "lucide-react";
import { T } from "@/lib/motion";

// The login backdrop is the real product map — Leaflet needs `window`, so it is
// client-only. ssr:false keeps it out of the server render.
const LiveNetwork = dynamic(() => import("@/components/marketing/LiveNetwork"), {
  ssr: false,
  loading: () => <div className="bg-canvas absolute inset-0" />,
});

const BACKEND_URL = "http://localhost:8000";

const PRESETS = [
  { role: "admin", username: "admin", label: "Admin", hint: "Full access" },
  { role: "authority", username: "officer", label: "Officer", hint: "Authority" },
  { role: "fleet", username: "driver", label: "Driver", hint: "Fleet" },
];

/** Real subsystems + real numbers from ai/experiments.md. */
const BOOT = [
  { k: "camera", v: "CAM 01 · 1080p30" },
  { k: "gps", v: "LOCK · 19.0760, 72.8777" },
  { k: "model", v: "yolov8s v4-all · conf 0.29" },
  { k: "detector", v: "94 ms/frame · 109/122" },
];

/**
 * Login.
 *
 * The earlier attempts leaned on flat vector illustration (a cartoon road, cars)
 * and read as cheap. Digital surfaces look "real" for two reasons: soft organic
 * light with depth, and FILM GRAIN over it — grain is what kills the smooth
 * gradient banding that gives CGI away. So this is an aurora field (drifting
 * blurred light) under a grain layer, with the auth panel as genuinely frosted
 * glass floating on it: specular top edge, saturated backdrop blur, a real
 * floating shadow. The product identity stays in the corner instrumentation and
 * the accent, not in a picture of a road.
 */
export default function Login() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Decorative boot sequence — NEVER gates the form (a returning user with
  // autofill must be able to submit instantly).
  const [booted, setBooted] = useState(reduce ? BOOT.length : 0);
  useEffect(() => {
    if (reduce || booted >= BOOT.length) return;
    const id = setTimeout(() => setBooted((b) => b + 1), booted === 0 ? 240 : 190);
    return () => clearTimeout(id);
  }, [booted, reduce]);
  const ready = booted >= BOOT.length;

  const handleLogin = async (e, customCreds = null) => {
    if (e) e.preventDefault();
    setLoading(true);
    setError(null);

    const loginUser = customCreds ? customCreds.username : username;
    const loginPass = customCreds ? customCreds.password : password;

    try {
      const response = await fetch(`${BACKEND_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginUser, password: loginPass }),
        credentials: "include", // Pass cookies automatically
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(
          errJson.detail || "Authentication failed. Please verify your credentials."
        );
      }

      const data = await response.json();
      // Store user details in localStorage for UI access
      localStorage.setItem("user", JSON.stringify(data.user));
      router.push("/");
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
    // On success we keep `loading` true — the router is already navigating away.
  };

  const handleQuickFill = (preset) => {
    const creds = { username: preset.username, password: "password" };
    setUsername(creds.username);
    setPassword(creds.password);
    handleLogin(null, creds);
  };

  return (
    <main className="bg-canvas relative grid h-screen w-full place-items-center overflow-hidden">
      {/* ══ The live detection network — the product itself as the backdrop ═══ */}
      <LiveNetwork />

      {/* Corner instrumentation — the device frame, on-brand */}
      <div className="text-ink-3 pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-6 font-mono text-[10px]">
        <div className="flex items-start justify-between">
          <span className="flex items-center gap-2">
            <Activity className="text-accent h-3.5 w-3.5" strokeWidth={2.5} />
            <span className="text-ink-2 tracking-[0.16em]">ROADSENSE / RS-01</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="bg-critical animate-breathe h-1.5 w-1.5 rounded-full" />
            REC · CAM 01
          </span>
        </div>
        <div className="flex items-end justify-between">
          <span className="tracking-[0.16em]">v4-all · conf 0.29 · 94 ms/frame</span>
          <span className="tracking-[0.16em]">PHASE 3 · BETA</span>
        </div>
      </div>

      {/* ══ Glass console ══════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={T.spring}
        className="glass glass-sheen relative z-20 w-[390px] max-w-[92vw] overflow-hidden rounded-3xl"
      >
        {/* Brand header */}
        <div className="flex flex-col items-center gap-3 px-7 pt-7 pb-5">
          <motion.div
            initial={{ scale: 0.7, opacity: 0, rotate: -10 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ ...T.spring, delay: 0.08 }}
            className="border-accent/25 bg-accent/12 relative grid h-12 w-12 place-items-center rounded-2xl border"
          >
            <span className="bg-accent/25 absolute inset-0 rounded-2xl blur-lg" />
            <Activity className="text-accent relative h-6 w-6" strokeWidth={2.4} />
          </motion.div>
          <div className="flex flex-col items-center gap-1">
            <h1 className="text-ink text-[19px] leading-none font-semibold tracking-tight">
              RoadSense<span className="text-ink-3 font-normal"> AI</span>
            </h1>
            <p className="text-ink-3 text-[11.5px]">Road condition intelligence platform</p>
          </div>
        </div>

        {/* Boot checklist — sits on a slightly deeper glass shelf */}
        <div className="mx-7 mb-5 flex flex-col gap-1.5 rounded-xl border border-white/[0.06] bg-black/20 px-3.5 py-3">
          {BOOT.map((b, i) => {
            const up = i < booted;
            return (
              <motion.div
                key={b.k}
                initial={reduce ? false : { opacity: 0, x: -6 }}
                animate={up ? { opacity: 1, x: 0 } : { opacity: 0.22, x: 0 }}
                transition={T.fast}
                className="flex items-center gap-2.5 font-mono text-[10px]"
              >
                <span className={up ? "text-good" : "text-ink-3"}>
                  {up ? (
                    <Check className="h-2.5 w-2.5" />
                  ) : (
                    <span className="block h-2.5 w-2.5" />
                  )}
                </span>
                <span className="text-ink-3 w-[54px] shrink-0 tracking-[0.08em]">{b.k}</span>
                <span className="text-ink-2 truncate">{b.v}</span>
              </motion.div>
            );
          })}
        </div>

        {/* Prompt */}
        <div className="px-7 pb-5">
          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: "auto", marginBottom: 14 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={T.base}
                className="overflow-hidden"
              >
                <motion.div
                  animate={{ x: [0, -5, 5, -3, 3, 0] }}
                  transition={{ duration: 0.35 }}
                  className="bg-critical/12 border-critical/30 flex items-start gap-2 rounded-xl border px-3 py-2.5"
                >
                  <TriangleAlert className="text-critical mt-px h-3.5 w-3.5 shrink-0" />
                  <span className="text-critical text-[11px] leading-relaxed">{error}</span>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleLogin} className="flex flex-col gap-3">
            <Field
              icon={UserIcon}
              label="Username"
              type="text"
              value={username}
              onChange={setUsername}
              placeholder="Enter username"
              autoComplete="username"
            />
            <Field
              icon={Lock}
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              autoComplete="current-password"
            />

            <motion.button
              type="submit"
              disabled={loading}
              whileTap={{ scale: 0.985 }}
              transition={T.fast}
              className="group bg-accent text-canvas hover:bg-accent-2 relative mt-1.5 flex h-10 w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl text-[13px] font-semibold shadow-[0_8px_24px_-6px_rgba(34,211,238,0.5)] transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              <AnimatePresence mode="wait" initial={false}>
                {loading ? (
                  <motion.span
                    key="l"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-2"
                  >
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Authenticating
                  </motion.span>
                ) : (
                  <motion.span
                    key="i"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-1.5"
                  >
                    Sign in
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          </form>
        </div>

        {/* Presets */}
        <div className="flex items-center gap-2 border-t border-white/[0.06] bg-black/15 px-7 py-3.5">
          <span className="text-ink-3 shrink-0 font-mono text-[9px] tracking-[0.14em]">
            PRESETS
          </span>
          <div className="ml-auto flex gap-1.5">
            {PRESETS.map((p) => (
              <motion.button
                key={p.role}
                type="button"
                disabled={loading}
                onClick={() => handleQuickFill(p)}
                whileHover={{ y: -1.5 }}
                whileTap={{ scale: 0.95 }}
                transition={T.fast}
                title={p.hint}
                className="cursor-pointer rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10.5px] font-medium text-ink-2 transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-40"
              >
                {p.label}
              </motion.button>
            ))}
          </div>
        </div>
      </motion.div>

      <p className="text-ink-3 absolute bottom-6 left-1/2 z-10 hidden -translate-x-1/2 text-[10px] sm:block">
        pw: <span className="font-mono">password</span>
      </p>
    </main>
  );
}

/**
 * Field — a frosted input. The glass-input class carries the focus treatment
 * (accent border + a touch more fill), so the icon just needs to follow it.
 */
function Field({ icon: Icon, label, type, value, onChange, placeholder, autoComplete }) {
  const [focused, setFocused] = useState(false);
  return (
    <label className="flex flex-col gap-1.5">
      <span className="eyebrow">{label}</span>
      <div className="glass-input relative flex items-center rounded-xl">
        <Icon
          className={`pointer-events-none absolute left-3 h-3.5 w-3.5 transition-colors ${
            focused ? "text-accent" : "text-ink-3"
          }`}
        />
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
          className="text-ink placeholder:text-ink-3 h-10 w-full rounded-xl bg-transparent pr-3 pl-9 text-[13px] outline-none"
        />
      </div>
    </label>
  );
}
