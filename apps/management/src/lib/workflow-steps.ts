export type WorkflowStepStatus = "pending" | "active" | "complete" | "blocked";

export type WorkflowStep = {
  id: string;
  label: string;
  status: WorkflowStepStatus;
  detail?: string;
};

export function getWorkflowProgress(steps: WorkflowStep[]) {
  const current = steps.find((step) => step.status === "blocked" || step.status === "active");

  return {
    total: steps.length,
    complete: steps.filter((step) => step.status === "complete").length,
    blocked: steps.filter((step) => step.status === "blocked").length,
    currentStepId: current?.id ?? steps.find((step) => step.status === "pending")?.id,
  };
}
