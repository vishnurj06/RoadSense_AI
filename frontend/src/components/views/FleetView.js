"use client";

import React from "react";
import { motion } from "motion/react";
import { VehicleRegistry } from "@/components/dashboards/FleetDashboard";
import UploadPanel from "@/components/shared/UploadPanel";
import { stagger, rise } from "@/lib/motion";

/**
 * FleetView — vehicle registry at page width, with the upload beside it.
 *
 * The registry is a list of vehicles with live camera health; at 400px it could
 * only show a plate and a dot. Here the health, report count and camera id all
 * fit on one line without truncating.
 */
export default function FleetView({ vehicles, loading, error, onSelect, onUpload, uploading }) {
  return (
    <motion.div
      variants={stagger(0.05)}
      initial="hidden"
      animate="show"
      className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-3"
    >
      <div className="grid grid-cols-1 items-start gap-3">
        <motion.div variants={rise}>
          <VehicleRegistry
            vehicles={vehicles}
            loading={loading}
            error={error}
            onSelect={onSelect}
            maxHeight="none"
          />
        </motion.div>
        <motion.div variants={rise}>
          <UploadPanel onUpload={onUpload} uploading={uploading} />
        </motion.div>
      </div>
    </motion.div>
  );
}
