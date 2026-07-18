"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "motion/react";
import {
  Lock,
  User as UserIcon,
  TriangleAlert,
  ArrowRight,
  Loader2,
  X,
  Sun,
  Moon,
} from "lucide-react";
import { T } from "@/lib/motion";
import Logo from "@/components/ui/Logo";

// The login backdrop is the real product map — Leaflet needs `window`, so it is
// client-only. ssr:false keeps it out of the server render.
const LiveNetwork = dynamic(() => import("@/components/marketing/LiveNetwork"), {
  ssr: false,
  loading: () => <div className="bg-canvas absolute inset-0" />,
});

const BACKEND_URL = "http://localhost:8000";

// The sign-in beacon sits right-of-centre over India (screen-percent). The
// console opens to its RIGHT; the beacon is kept left of centre enough that the
// card still fits on screen.
const BEACON = { x: 55, y: 50 };

/**
 * Login.
 *
 * The backdrop is the live detection network over India. Sign-in is itself a
 * node on that network: a glowing beacon you click to open the console. The
 * console is deliberately minimal — mark, two fields, one button — so the
 * product (the map) stays the hero.
 */
export default function Login() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Theme is scoped to this page via data-theme on <main> (dashboard unaffected).
  const [theme, setTheme] = useState("dark");
  useEffect(() => {
    const urlTheme = new URLSearchParams(window.location.search).get("theme");
    const saved =
      urlTheme === "light" || urlTheme === "dark"
        ? urlTheme
        : localStorage.getItem("rs-login-theme");
    if (saved !== "light" && saved !== "dark") return;
    // Deferred (not a synchronous setState in the effect body) — and it applies
    // the stored choice after mount, so server + client both first render dark.
    const id = requestAnimationFrame(() => setTheme(saved));
    return () => cancelAnimationFrame(id);
  }, []);
  const toggleTheme = () =>
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      localStorage.setItem("rs-login-theme", next);
      return next;
    });

  const handleLogin = async (e) => {
    if (e) e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${BACKEND_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "include",
      });
      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(
          errJson.detail || "Authentication failed. Please verify your credentials."
        );
      }
      const data = await response.json();
      localStorage.setItem("user", JSON.stringify(data.user));
      router.push("/");
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <main data-theme={theme} className="bg-canvas relative h-screen w-full overflow-hidden">
      {/* ══ The live detection network over India — the product as backdrop ══ */}
      <LiveNetwork theme={theme} />

      {/* Theme toggle — minimalist, opposite the REC marker */}
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        className="border-line bg-canvas/60 text-ink-2 hover:text-ink hover:border-accent/30 absolute top-14 right-6 z-30 grid h-8 w-8 cursor-pointer place-items-center rounded-lg border backdrop-blur-md transition-colors"
      >
        {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
      </button>

      {/* Corner instrumentation — the device frame, on-brand */}
      <div className="text-ink-3 pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-6 font-mono text-[10px]">
        <div className="flex items-start justify-between">
          <span className="flex items-center gap-3">
            <Logo size={34} className="text-ink" />
            <span className="flex flex-col leading-none">
              <span className="text-ink font-sans text-[19px] font-semibold tracking-tight">
                RoadSense<span className="text-ink-3 font-normal"> AI</span>
              </span>
              <span className="text-ink-3 mt-1.5 tracking-[0.2em]">RS-01 · LIVE</span>
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="bg-critical animate-breathe h-1.5 w-1.5 rounded-full" />
            REC · CAM 01
          </span>
        </div>
        <div className="flex items-end justify-between">
          <span className="tracking-[0.16em]">INDIA · v4-all · conf 0.29</span>
          <span className="tracking-[0.16em]">PHASE 3 · BETA</span>
        </div>
      </div>

      {/* ══ Sign-in beacon — a node on the network you open ══════════════════ */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close sign in" : "Open sign in"}
        className="group absolute z-30 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
        style={{ left: `${BEACON.x}%`, top: `${BEACON.y}%` }}
      >
        {/* breathing halo */}
        <span className="bg-accent absolute -inset-4 rounded-full opacity-25 blur-lg transition-opacity group-hover:opacity-40" />
        {/* expanding ping */}
        <motion.span
          className="border-accent absolute inset-0 rounded-full border-2"
          initial={{ scale: 1, opacity: 0.6 }}
          animate={{ scale: [1, 2.6], opacity: [0.6, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
        />
        {/* core */}
        <span className="border-canvas bg-accent relative block h-4 w-4 rounded-full border-2 shadow-[0_0_16px_rgba(34,211,238,0.9)] transition-transform group-hover:scale-110" />
        {/* label — invites the click, hides once open. Sits LEFT of the beacon,
            opposite the console (which opens to the right). */}
        <AnimatePresence>
          {!open && (
            <motion.span
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={T.base}
              className="border-accent/30 bg-canvas/80 text-accent absolute top-1/2 right-6 flex -translate-y-1/2 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[10px] tracking-[0.14em] whitespace-nowrap backdrop-blur-md"
            >
              <span className="bg-accent h-1 w-1 animate-pulse rounded-full" />
              SIGN IN
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {/* ══ Glass console — opens anchored to the beacon (left of it) ════════ */}
      <AnimatePresence>
        {open && (
          <div className="absolute z-40 left-1/2 top-1/2 sm:left-[55%]">
            <div className="-translate-x-1/2 -translate-y-1/2 sm:translate-x-[34px] sm:-translate-y-1/2">
              <motion.div
                initial={{ opacity: 0, scale: 0.92, x: -16 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.94, x: -16 }}
                transition={T.spring}
                className="glass glass-sheen relative w-[352px] max-w-[92vw] origin-center overflow-hidden rounded-3xl sm:origin-left"
              >
                {/* connector back to the beacon on the left (desktop) */}
                <span className="pointer-events-none absolute top-1/2 left-[-34px] hidden h-px w-[34px] -translate-y-1/2 bg-gradient-to-l from-transparent to-[var(--color-accent)] sm:block" />

                {/* close */}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="text-ink-3 hover:text-ink-2 hover:bg-white/5 absolute top-3 right-3 z-10 grid h-7 w-7 cursor-pointer place-items-center rounded-lg transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>

                {/* Brand header */}
                <div className="flex flex-col items-center gap-3 px-7 pt-8 pb-5">
                  <motion.div
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ ...T.spring, delay: 0.06 }}
                    className="text-ink relative grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]"
                  >
                    <span className="bg-accent/20 absolute inset-0 rounded-2xl blur-lg" />
                    <Logo size={26} className="relative" />
                  </motion.div>
                  <div className="flex flex-col items-center gap-1">
                    <h1 className="text-ink text-[19px] leading-none font-semibold tracking-tight">
                      RoadSense<span className="text-ink-3 font-normal"> AI</span>
                    </h1>
                    <p className="text-ink-3 text-[11.5px]">Road condition intelligence platform</p>
                  </div>
                </div>

                {/* Prompt */}
                <div className="px-7 pt-1 pb-7">
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
                      autoFocus
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
              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>

      <p className="text-ink-3 pointer-events-none absolute bottom-6 left-1/2 z-10 hidden -translate-x-1/2 text-[10px] sm:block">
        admin · officer · driver — pw: <span className="font-mono">password</span>
      </p>
    </main>
  );
}

/**
 * Field — a frosted input. The glass-input class carries the focus treatment;
 * the icon just follows it.
 */
function Field({ icon: Icon, label, type, value, onChange, placeholder, autoComplete, autoFocus }) {
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
          autoFocus={autoFocus}
          required
          className="text-ink placeholder:text-ink-3 h-10 w-full rounded-xl bg-transparent pr-3 pl-9 text-[13px] outline-none"
        />
      </div>
    </label>
  );
}
