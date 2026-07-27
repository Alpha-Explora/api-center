import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type RecoveryStep = {
  label: ReactNode;
  description?: ReactNode;
};

type QueryStateProps = {
  title: string;
  description: ReactNode;
  recoverySteps?: RecoveryStep[];
};

export function SetupRequiredState({
  title,
  description,
  recoverySteps,
}: QueryStateProps) {
  return (
    <Alert role="status" aria-live="polite">
      <AlertTitle>{title}</AlertTitle>
      <QueryStateDescription
        description={description}
        recoverySteps={recoverySteps}
      />
    </Alert>
  );
}

export function EmptyDataState({
  title,
  description,
  recoverySteps,
}: QueryStateProps) {
  return (
    <Alert role="status" aria-live="polite">
      <AlertTitle>{title}</AlertTitle>
      <QueryStateDescription
        description={description}
        recoverySteps={recoverySteps}
      />
    </Alert>
  );
}

export function ActionFailedState({
  title,
  description,
  recoverySteps,
}: QueryStateProps) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <QueryStateDescription
        description={description}
        recoverySteps={recoverySteps}
      />
    </Alert>
  );
}

function QueryStateDescription({
  description,
  recoverySteps,
}: {
  description: ReactNode;
  recoverySteps?: RecoveryStep[];
}) {
  return (
    <AlertDescription>
      <div>{description}</div>
      {recoverySteps && recoverySteps.length > 0 ? (
        <div className="mt-3 border-t pt-3">
          <div className="font-medium text-foreground">Recovery path</div>
          <ol
            aria-label="Recovery path"
            className="mt-2 list-decimal space-y-1 pl-5"
          >
            {recoverySteps.map((step, index) => (
              <li key={index} className="pl-1">
                <span className="font-medium text-foreground">
                  {step.label}
                </span>
                {step.description ? (
                  <span className="ml-1">{step.description}</span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </AlertDescription>
  );
}
