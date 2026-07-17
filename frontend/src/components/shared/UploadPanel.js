"use client";

import React from "react";
import { Upload } from "lucide-react";

/**
 * UploadPanel — drag-target for demo road-image uploads.
 *
 * Props:
 *   onUpload:  (e: ChangeEvent<HTMLInputElement>) => void
 *   uploading: boolean
 */
export default function UploadPanel({ onUpload, uploading }) {
  return (
    <section
      className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl flex flex-col gap-3 shrink-0"
      data-testid="upload-panel"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
          <Upload className="h-4 w-4" />
          <span>DEMO TELEMETRY UPLOAD</span>
        </div>
        {uploading && (
          <span className="text-[10px] text-blue-400 animate-pulse font-bold">
            Uploading...
          </span>
        )}
      </div>

      <label
        className={`w-full h-24 rounded-2xl border border-dashed border-slate-800 bg-slate-950/30 flex flex-col items-center justify-center cursor-pointer transition duration-150 relative ${
          uploading
            ? "opacity-50 pointer-events-none"
            : "hover:border-blue-500/50 hover:bg-slate-900/30"
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
        <Upload className="h-5 w-5 text-slate-500 mb-1.5" />
        <span className="text-xs text-slate-400 font-semibold text-center">
          Click to upload road image
        </span>
        <span className="text-[9px] text-slate-600 text-center mt-0.5">
          Mock GPS tags Mumbai area on map
        </span>
      </label>
    </section>
  );
}
