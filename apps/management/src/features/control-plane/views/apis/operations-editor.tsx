"use client";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/patterns/form";
import { HTTP_METHODS, MAX_OPERATIONS, newOperationDraft, type HttpMethod, type OperationDraft, type OperationErrors } from "../../model/published-apis";

/**
 * Rows of METHOD + path pattern → action. Errors show only for rows the person has touched or after a submit
 * attempt (`showErrors`), so a fresh row is not red.
 */
export function OperationsEditor({
  rows,
  onChange,
  errors,
  formError,
  showErrors,
}: {
  rows: OperationDraft[];
  onChange: (rows: OperationDraft[]) => void;
  errors: Record<number, OperationErrors>;
  formError?: string;
  showErrors: boolean;
}) {
  const update = (index: number, change: Partial<OperationDraft>) => onChange(rows.map((row, at) => (at === index ? { ...row, ...change } : row)));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium">Operations</span>
        <span className="text-xs text-muted-foreground">
          {rows.length} of {MAX_OPERATIONS}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Each request to the API must match one operation; its action is what an application is granted. Use{" "}
        <code className="font-mono">{"{name}"}</code> for a path segment that varies.
      </p>
      <ol className="flex flex-col gap-2">
        {rows.map((row, index) => {
          const rowErrors = showErrors ? (errors[index] ?? {}) : {};
          const id = `operation-${row.key}`;
          return (
            <li key={row.key} className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2.5">
              <div className="flex items-start gap-2">
                <NativeSelect
                  aria-label={`Row ${index + 1} method`}
                  className="w-24 shrink-0"
                  value={row.method}
                  onChange={(event) => update(index, { method: event.target.value as HttpMethod })}
                >
                  {HTTP_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </NativeSelect>
                <Input
                  id={`${id}-path`}
                  aria-label={`Row ${index + 1} path`}
                  aria-invalid={Boolean(rowErrors.path)}
                  className="font-mono"
                  placeholder="/orders/{orderId}"
                  value={row.path}
                  onChange={(event) => update(index, { path: event.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground"
                  aria-label={`Remove row ${index + 1}`}
                  disabled={rows.length === 1}
                  onClick={() => onChange(rows.filter((_, at) => at !== index))}
                >
                  <Trash2Icon />
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <Input
                  aria-label={`Row ${index + 1} action`}
                  aria-invalid={Boolean(rowErrors.action)}
                  className="font-mono"
                  placeholder="orders:read"
                  value={row.action}
                  onChange={(event) => update(index, { action: event.target.value })}
                />
                <Input
                  aria-label={`Row ${index + 1} description`}
                  aria-invalid={Boolean(rowErrors.description)}
                  placeholder="Description (optional)"
                  value={row.description}
                  onChange={(event) => update(index, { description: event.target.value })}
                />
              </div>
              {rowErrors.method || rowErrors.path || rowErrors.action || rowErrors.description ? (
                <ul role="alert" className="flex flex-col gap-0.5 text-xs text-danger">
                  {[rowErrors.method, rowErrors.path, rowErrors.action, rowErrors.description].filter(Boolean).map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
      {showErrors && formError ? (
        <p role="alert" className="text-xs text-danger">
          {formError}
        </p>
      ) : null}
      <div>
        <Button type="button" variant="outline" size="sm" disabled={rows.length >= MAX_OPERATIONS} onClick={() => onChange([...rows, newOperationDraft()])}>
          <PlusIcon data-icon="inline-start" /> Add operation
        </Button>
      </div>
    </div>
  );
}
