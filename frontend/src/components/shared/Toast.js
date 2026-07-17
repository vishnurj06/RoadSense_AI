"use client";

import React from "react";
import { AlertTriangle, CheckCircle, Activity } from "lucide-react";

/**
 * Toast — fixed bottom-right notification badge.
 *
 * Props:
 *   toast: { message: string, type: "success" | "error" | "info" } | null
 */
export default function Toast({ toast }) {
  if (!toast) return null;

  return (
    <div
      data-testid="toast"
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border border-slate-800/80 backdrop-blur-md transition-all duration-300 ${
        toast.type === "success"
          ? "bg-green-950/90 border-green-500/30 text-green-300"
          : toast.type === "error"
          ? "bg-red-950/90 border-red-500/30 text-red-300"
          : "bg-slate-900/90 border-slate-800 text-slate-300"
      }`}
    >
      {toast.type === "success" ? (
        <CheckCircle className="h-5 w-5 text-green-400 shrink-0" />
      ) : toast.type === "error" ? (
        <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
      ) : (
        <Activity className="h-5 w-5 text-blue-400 shrink-0" />
      )}
      <span className="text-xs font-semibold">{toast.message}</span>
    </div>
  );
}
