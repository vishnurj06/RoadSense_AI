"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Lock, User as UserIcon, AlertTriangle, Shield } from "lucide-react";

const BACKEND_URL = "http://localhost:8000";

export default function Login() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleLogin = async (e, customCreds = null) => {
    if (e) e.preventDefault();
    setLoading(true);
    setError(null);

    const loginUser = customCreds ? customCreds.username : username;
    const loginPass = customCreds ? customCreds.password : password;

    try {
      const response = await fetch(`${BACKEND_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: loginUser,
          password: loginPass,
        }),
        credentials: "include", // Pass cookies automatically
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.detail || "Authentication failed. Please verify your credentials.");
      }

      const data = await response.json();
      
      // Store user details in localStorage for UI access
      localStorage.setItem("user", JSON.stringify(data.user));
      
      router.push("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = (role) => {
    let creds = { username: "", password: "password" };
    if (role === "admin") creds.username = "admin";
    if (role === "authority") creds.username = "officer";
    if (role === "fleet") creds.username = "driver";

    setUsername(creds.username);
    setPassword(creds.password);
    
    // Automatically trigger login for rapid testing
    handleLogin(null, creds);
  };

  return (
    <div className="relative min-h-screen w-screen flex items-center justify-center bg-[#07090e] text-slate-100 font-sans overflow-hidden">
      {/* Decorative background glow circles */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[35rem] h-[35rem] bg-blue-600/10 rounded-full blur-[100px] pointer-events-none z-0"></div>
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-[35rem] h-[35rem] bg-indigo-600/10 rounded-full blur-[100px] pointer-events-none z-0"></div>

      <div className="w-full max-w-md p-8 bg-slate-950/40 border border-slate-800/80 backdrop-blur-xl rounded-3xl shadow-2xl relative z-10 flex flex-col gap-6 mx-4">
        {/* Brand header */}
        <div className="flex flex-col items-center text-center gap-3">
          <div className="bg-blue-500/10 p-3.5 rounded-2xl border border-blue-500/20 shadow-[0_0_20px_rgba(59,130,246,0.15)]">
            <Activity className="h-7 w-7 text-blue-500 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-white flex items-center justify-center gap-2">
              RoadSense AI
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/25 text-blue-400">
                MVP
              </span>
            </h1>
            <p className="text-xs text-slate-500 font-medium mt-1">
              Sign in to access the Road Quality Platform
            </p>
          </div>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="flex items-start gap-3 bg-red-950/40 border border-red-500/30 text-red-400 text-xs p-3.5 rounded-xl animate-shake">
            <AlertTriangle className="h-4.5 w-4.5 shrink-0 text-red-500 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        {/* Credentials Form */}
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500">
              Username
            </label>
            <div className="relative flex items-center">
              <UserIcon className="absolute left-3.5 h-4 w-4 text-slate-500" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                className="w-full bg-slate-900/60 border border-slate-800/80 focus:border-blue-500/80 rounded-xl py-3 pl-11 pr-4 text-sm text-white placeholder-slate-600 focus:outline-none transition duration-150 shadow-inner"
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500">
              Password
            </label>
            <div className="relative flex items-center">
              <Lock className="absolute left-3.5 h-4 w-4 text-slate-500" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-900/60 border border-slate-800/80 focus:border-blue-500/80 rounded-xl py-3 pl-11 pr-4 text-sm text-white placeholder-slate-600 focus:outline-none transition duration-150 shadow-inner"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-extrabold text-sm rounded-xl cursor-pointer shadow-lg shadow-blue-500/10 hover:shadow-blue-500/20 active:translate-y-[1px] transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
          >
            {loading ? (
              <Activity className="animate-spin h-4 w-4" />
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        {/* Quick Fill Dev panel */}
        <div className="border-t border-slate-900/80 pt-5 flex flex-col gap-3">
          <div className="flex items-center gap-1.5 text-slate-500">
            <Shield className="h-3.5 w-3.5 text-indigo-400" />
            <span className="text-[10px] uppercase font-bold tracking-wider">
              Quick-Fill Dev Presets
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => handleQuickFill("admin")}
              type="button"
              className="flex flex-col items-center justify-center p-2.5 bg-slate-900/50 hover:bg-slate-800/60 active:bg-slate-950 border border-slate-800/70 hover:border-blue-500/35 rounded-xl cursor-pointer transition-all duration-150"
            >
              <span className="text-xs font-bold text-white">Admin</span>
              <span className="text-[8px] text-slate-500 mt-0.5">Full access</span>
            </button>

            <button
              onClick={() => handleQuickFill("authority")}
              type="button"
              className="flex flex-col items-center justify-center p-2.5 bg-slate-900/50 hover:bg-slate-800/60 active:bg-slate-950 border border-slate-800/70 hover:border-indigo-500/35 rounded-xl cursor-pointer transition-all duration-150"
            >
              <span className="text-xs font-bold text-white">Officer</span>
              <span className="text-[8px] text-slate-500 mt-0.5">Authority</span>
            </button>

            <button
              onClick={() => handleQuickFill("fleet")}
              type="button"
              className="flex flex-col items-center justify-center p-2.5 bg-slate-900/50 hover:bg-slate-800/60 active:bg-slate-950 border border-slate-800/70 hover:border-emerald-500/35 rounded-xl cursor-pointer transition-all duration-150"
            >
              <span className="text-xs font-bold text-white">Driver</span>
              <span className="text-[8px] text-slate-500 mt-0.5">Fleet</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
