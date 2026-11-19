"use client";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormRow, NativeSelect } from "@/components/patterns/form";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatDateTime, formatRelative } from "@/lib/format";
import { controlPlane } from "../../data/control-plane-repository";
import { formatQuotaLimit, formatWindow, WINDOW_PRESETS, type QuotaForm, type QuotaFormErrors, type QuotaPolicy } from "../../model/quotas";
import { cpKeys } from "../../view-models/query-keys";

export const QUOTA_RULES =
  "Every limit that applies must have room: the plan's daily allowance, the project's policies and any shared ceiling. Windows are fixed and aligned to the clock in UTC, so an hourly limit resets on the hour. Requests over an enforced limit get 429 QUOTA_EXCEEDED.";

export const QUOTA_LIMITATIONS =
  "Policies cannot be edited or deleted. To change one, disable it and create a new one. The console cannot show how much of a limit is used yet.";

/** The fields every quota policy has; the sheet around it adds what its scope needs. */
export function QuotaPolicyFields({
  form,
  onChange,
  errors,
  idPrefix,
}: {
  form: QuotaForm;
  onChange: (next: QuotaForm) => void;
  errors: QuotaFormErrors;
  idPrefix: string;
}) {
  const catalog = useQuery({ queryKey: cpKeys.catalog, queryFn: controlPlane.capabilities, staleTime: 5 * 60_000 });
  const set = (patch: Partial<QuotaForm>) => onChange({ ...form, ...patch });
  return (
    <>
      <FormRow label="Applies to" htmlFor={`${idPrefix}-capability`} hint="Every request, or only requests to one capability.">
        <NativeSelect id={`${idPrefix}-capability`} value={form.capability} onChange={(event) => set({ capability: event.target.value })}>
          <option value="">All requests</option>
          {(catalog.data ?? []).map((capability) => (
            <option key={capability.id} value={capability.id}>
              {capability.name} ({capability.id})
            </option>
          ))}
        </NativeSelect>
      </FormRow>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Maximum requests" htmlFor={`${idPrefix}-max`} error={errors.maxRequests}>
          <Input
            id={`${idPrefix}-max`}
            inputMode="numeric"
            placeholder="1000"
            aria-invalid={Boolean(errors.maxRequests)}
            value={form.maxRequests}
            onChange={(event) => set({ maxRequests: event.target.value })}
          />
        </FormRow>
        <FormRow label="Per" htmlFor={`${idPrefix}-window`}>
          <NativeSelect id={`${idPrefix}-window`} value={form.window} onChange={(event) => set({ window: event.target.value })}>
            {WINDOW_PRESETS.map((preset) => (
              <option key={preset.seconds} value={String(preset.seconds)}>
                {preset.label}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </NativeSelect>
        </FormRow>
      </div>
      {form.window === "custom" ? (
        <FormRow
          label="Window in seconds"
          htmlFor={`${idPrefix}-seconds`}
          error={errors.windowSeconds}
          hint={windowHint(form.customSeconds)}
        >
          <Input
            id={`${idPrefix}-seconds`}
            inputMode="numeric"
            placeholder="900"
            aria-invalid={Boolean(errors.windowSeconds)}
            value={form.customSeconds}
            onChange={(event) => set({ customSeconds: event.target.value })}
          />
        </FormRow>
      ) : null}
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1.5 text-[13px] font-medium">Mode</legend>
        {MODES.map((entry) => (
          <label
            key={entry.value}
            className="flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-[13px] has-checked:border-foreground/40 has-checked:bg-muted/60"
          >
            <input type="radio" name={`${idPrefix}-mode`} className="mt-0.5 accent-foreground" checked={form.mode === entry.value} onChange={() => set({ mode: entry.value })} />
            <span>
              <span className="block font-medium">{entry.label}</span>
              <span className="block text-xs text-muted-foreground">{entry.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </>
  );
}

const MODES: { value: QuotaForm["mode"]; label: string; description: string }[] = [
  { value: "enforce", label: "Enforce", description: "Requests over the limit are refused with 429 QUOTA_EXCEEDED." },
  { value: "observe", label: "Observe", description: "Requests are only counted against the limit, never refused. Use it to try a limit before enforcing it." },
];

function windowHint(value: string) {
  const seconds = Number(value.replace(/[,_\s]/g, ""));
  if (Number.isInteger(seconds) && seconds >= 1 && seconds <= 2_678_400) return `Every ${formatWindow(seconds)}. From 1 second to 31 days.`;
  return "From 1 second to 2,678,400 (31 days).";
}

/** Quota policies as a table; `extra` adds a scope-specific column, `actions` the row's buttons. */
export function QuotaPolicyTable({
  policies,
  extra,
  actions,
}: {
  policies: QuotaPolicy[];
  extra?: { label: string; render: (policy: QuotaPolicy) => ReactNode };
  actions?: (policy: QuotaPolicy) => ReactNode;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Limit</TableHead>
          <TableHead className="hidden sm:table-cell">Mode</TableHead>
          <TableHead>Status</TableHead>
          {extra ? <TableHead className="hidden md:table-cell">{extra.label}</TableHead> : null}
          <TableHead className="hidden lg:table-cell">Created</TableHead>
          {actions ? <TableHead className="w-0" /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {policies.map((policy) => (
          <TableRow key={policy.id} className={policy.status === "disabled" ? "text-muted-foreground" : undefined}>
            <TableCell className="whitespace-normal">
              <div className="font-medium tabular-nums">{formatQuotaLimit(policy.maxRequests, policy.windowSeconds)}</div>
              <div className="text-xs text-muted-foreground">
                {policy.capability ? <span className="font-mono">{policy.capability}</span> : "All requests"}
                <span className="sm:hidden"> · {policy.mode === "observe" ? "Observe" : "Enforce"}</span>
              </div>
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              <StatusBadge tone={policy.mode === "observe" ? "warning" : "info"}>{policy.mode === "observe" ? "Observe" : "Enforce"}</StatusBadge>
            </TableCell>
            <TableCell>
              <StatusBadge status={policy.status} />
            </TableCell>
            {extra ? <TableCell className="hidden max-w-64 md:table-cell">{extra.render(policy)}</TableCell> : null}
            <TableCell className="hidden text-muted-foreground lg:table-cell" title={`${formatDateTime(policy.createdAt)}${policy.createdBy ? ` by ${policy.createdBy}` : ""}`}>
              {formatRelative(policy.createdAt)}
            </TableCell>
            {actions ? <TableCell className="text-right">{actions(policy)}</TableCell> : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** What changing a policy's status does, for its confirm dialog. */
export function statusChangeCopy(policy: QuotaPolicy | null) {
  if (!policy) return { title: "", description: "", confirmLabel: "" };
  const limit = formatQuotaLimit(policy.maxRequests, policy.windowSeconds);
  return policy.status === "active"
    ? {
        title: `Disable ${limit}`,
        description: "The limit stops counting and stops refusing requests from the next request. You can enable it again later.",
        confirmLabel: "Disable policy",
      }
    : {
        title: `Enable ${limit}`,
        description:
          policy.mode === "enforce"
            ? "The limit applies again from the next request; requests over it are refused with 429 QUOTA_EXCEEDED."
            : "The limit starts counting again from the next request. It observes only and refuses nothing.",
        confirmLabel: "Enable policy",
      };
}
