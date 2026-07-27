"use client";

import { useState } from "react";
import { toast } from "sonner";
import { EmergencyControlPanel } from "@/components/emergency-control-panel";
import {
  applyEmergencyControl,
  type EmergencyControlRequest,
} from "@/lib/api-center-client";

export function EmergencyControlWorkflow() {
  const [status, setStatus] = useState<"idle" | "applying">("idle");

  async function handleApply(input: EmergencyControlRequest) {
    setStatus("applying");
    try {
      await applyEmergencyControl(input);
      toast.success("Emergency control applied");
    } catch (error) {
      toast.error("Emergency control failed", {
        description:
          error instanceof Error
            ? error.message
            : "Check management auth and emergency operation availability.",
      });
    } finally {
      setStatus("idle");
    }
  }

  return (
    <EmergencyControlPanel
      onApply={(input) => {
        if (status === "applying") return;
        void handleApply(input);
      }}
    />
  );
}
