import { CheckCircle2Icon, CircleIcon } from "lucide-react";

type TribeSecretRotationWorkflowProps = {
  secretName: string;
  hasGeneratedSecret: boolean;
  provisionedVersionName?: string;
};

const steps = [
  {
    state: "active_current",
    label: "Generate new secret",
    description: "Create a one-time plaintext value and keep only its hash.",
  },
  {
    state: "active_dual_valid",
    label: "Secure handoff",
    description: "Send the plaintext value through the approved secret channel.",
  },
  {
    state: "old_pending_revoke",
    label: "Verify SDK",
    description: "Confirm the tribe backend authenticates with the new value.",
  },
  {
    state: "old_revoked",
    label: "Revoke old secret",
    description: "Promote the new hash and record the audit evidence.",
  },
];

export function TribeSecretRotationWorkflow({
  secretName,
  hasGeneratedSecret,
  provisionedVersionName,
}: TribeSecretRotationWorkflowProps) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-sm font-medium">Rotation workflow</div>
      <div className="mt-1 text-xs text-muted-foreground">
        The API Center resolver supports active_current, active_dual_valid,
        old_pending_revoke, and old_revoked payload states for {secretName}.
      </div>
      <div className="mt-3 grid gap-2">
        {steps.map((step, index) => {
          const completed =
            (index === 0 && hasGeneratedSecret) ||
            (index === 1 && Boolean(provisionedVersionName));
          const Icon = completed ? CheckCircle2Icon : CircleIcon;
          return (
            <div
              key={step.state}
              className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 text-sm"
            >
              <Icon
                className={
                  completed
                    ? "mt-0.5 size-4 text-emerald-600"
                    : "mt-0.5 size-4 text-muted-foreground"
                }
                aria-hidden="true"
              />
              <div>
                <div className="font-medium">{step.label}</div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-mono">{step.state}</span>
                  {" - "}
                  {step.description}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {provisionedVersionName ? (
        <div className="mt-3 rounded-md bg-muted px-3 py-2 text-xs">
          Latest Secret Manager version:{" "}
          <span className="break-all font-mono">{provisionedVersionName}</span>
        </div>
      ) : null}
    </div>
  );
}
