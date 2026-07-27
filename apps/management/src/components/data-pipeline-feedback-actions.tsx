"use client";

import { useState } from "react";
import {
  BanIcon,
  CheckCircle2Icon,
  RefreshCwIcon,
  WrenchIcon,
} from "lucide-react";
import { toast } from "sonner";
import { createPipelineFeedbackAction } from "@/lib/api-center-client";
import type {
  PipelineFeedbackAction,
  PipelineFeedbackActionRequest,
  PipelineHealthEnvironment,
} from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type FeedbackActionOption = {
  action: PipelineFeedbackAction;
  label: string;
  icon: typeof RefreshCwIcon;
};

export const PIPELINE_FEEDBACK_ACTION_GROUPS = {
  health: [
    {
      action: "validation.rerun.requested",
      label: "Re-run validation",
      icon: RefreshCwIcon,
    },
    {
      action: "evidence.reviewed",
      label: "Mark reviewed",
      icon: CheckCircle2Icon,
    },
  ],
  quality: [
    {
      action: "schema.fix.requested",
      label: "Request schema fix",
      icon: WrenchIcon,
    },
    {
      action: "promotion.blocked",
      label: "Block promotion",
      icon: BanIcon,
    },
  ],
  gateway: [
    {
      action: "evidence.reviewed",
      label: "Mark reviewed",
      icon: CheckCircle2Icon,
    },
    {
      action: "promotion.blocked",
      label: "Block promotion",
      icon: BanIcon,
    },
  ],
  decision: [
    {
      action: "evidence.reviewed",
      label: "Acknowledge",
      icon: CheckCircle2Icon,
    },
    {
      action: "decision.false_positive.marked",
      label: "False positive",
      icon: BanIcon,
    },
    {
      action: "onboarding.state.opened",
      label: "Open state",
      icon: RefreshCwIcon,
    },
    {
      action: "schema.fix.requested",
      label: "Request fix",
      icon: WrenchIcon,
    },
    {
      action: "promotion.blocked",
      label: "Block promotion",
      icon: BanIcon,
    },
  ],
} satisfies Record<string, FeedbackActionOption[]>;

const DEFAULT_ACTIONS: FeedbackActionOption[] = [
  {
    action: "validation.rerun.requested",
    label: "Re-run validation",
    icon: RefreshCwIcon,
  },
  {
    action: "evidence.reviewed",
    label: "Mark reviewed",
    icon: CheckCircle2Icon,
  },
  {
    action: "promotion.blocked",
    label: "Block promotion",
    icon: BanIcon,
  },
  {
    action: "schema.fix.requested",
    label: "Request schema fix",
    icon: WrenchIcon,
  },
];

export function DataPipelineFeedbackActions({
  environment,
  targetType,
  targetId,
  ownerTribeId,
  evidenceLink,
  actions = DEFAULT_ACTIONS,
}: {
  environment: PipelineHealthEnvironment;
  targetType: PipelineFeedbackActionRequest["targetType"];
  targetId: string;
  ownerTribeId?: string;
  evidenceLink?: string;
  actions?: FeedbackActionOption[];
}) {
  const [reason, setReason] = useState("");
  const [pendingAction, setPendingAction] = useState<PipelineFeedbackAction>();
  const trimmedReason = reason.trim();

  async function submit(action: PipelineFeedbackAction) {
    setPendingAction(action);
    try {
      const record = await createPipelineFeedbackAction({
        action,
        environment,
        targetType,
        targetId,
        ownerTribeId,
        evidenceLink,
        reason: trimmedReason,
      });
      toast.success("Feedback action recorded", {
        description: `${record.status} ${record.id}`,
      });
      setReason("");
    } catch (error) {
      toast.error("Feedback action failed", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPendingAction(undefined);
    }
  }

  return (
    <div className="flex min-w-64 flex-col gap-2">
      <Textarea
        aria-label="Feedback reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Reason"
        className="min-h-16 text-xs"
      />
      <div className="flex flex-wrap gap-2">
        {actions.map((item) => {
          const Icon = item.icon;
          const isPending = pendingAction === item.action;
          return (
            <Button
              key={item.action}
              type="button"
              size="sm"
              variant={
                item.action === "promotion.blocked" ? "destructive" : "outline"
              }
              disabled={!trimmedReason || Boolean(pendingAction)}
              onClick={() => submit(item.action)}
              title={item.label}
            >
              <Icon data-icon="inline-start" />
              {isPending ? "Saving" : item.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
