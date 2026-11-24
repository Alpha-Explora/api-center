"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { ErrorPanel } from "@/components/patterns/notices";
import { Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatDateTime } from "@/lib/format";
import { featureAccess } from "../../data/features";
import type { EnvironmentKind } from "../../model/control-plane";
import type { featurePauseSchema } from "../../model/features";
import { useOrganization } from "../../view-models/use-organization";

const labels = { payouts_sending: "Sending payouts", payee_wallets: "Payee wallet onboarding", merchant_account: "Merchant onboarding" };

export function PayoutPausePanel() {
  return <Panel title="Payout features" description="Pause an action for an environment and resume it without a deploy.">
    <div className="grid gap-5 lg:grid-cols-2"><EnvironmentPauses kind="test" /><EnvironmentPauses kind="live" /></div>
  </Panel>;
}

function EnvironmentPauses({ kind }: { kind: EnvironmentKind }) {
  const key = ["payout-pauses", kind];
  const query = useQuery({ queryKey: key, queryFn: () => featureAccess.pauses(kind) });
  const client = useQueryClient();
  const [selected, setSelected] = useState<z.infer<typeof featurePauseSchema> | null>(null);
  const update = useMutation({
    mutationFn: ({ row, reason }: { row: z.infer<typeof featurePauseSchema>; reason: string }) =>
      featureAccess.setPause(kind, row.feature, !row.paused, reason),
    onSuccess: () => {
      setSelected(null);
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: ["features"] });
    },
  });
  return <section aria-label={`${kind} payout features`}>
    <h3 className={`mb-2 text-sm font-medium capitalize ${kind === "live" ? "text-live" : ""}`}>{kind}</h3>
    {query.error ? <ErrorPanel title="Payout pauses could not be loaded" error={query.error} /> : null}
    <ul className="divide-y">
      {query.data?.map((row) => <li key={row.feature} className="flex items-start justify-between gap-3 py-2">
        <div>
          <div className="flex items-center gap-2 text-[13px]">
            <span>{labels[row.feature]}</span><StatusBadge tone={row.paused ? "warning" : "neutral"}>{row.paused ? "Paused" : "Unpaused"}</StatusBadge>
          </div>
          {row.updatedAt ? <p className="text-xs text-muted-foreground">{row.updatedBy} · {formatDateTime(row.updatedAt)} · {row.reason}</p> : null}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => { update.reset(); setSelected(row); }}>
          {row.paused ? "Resume" : "Pause"}
        </Button>
      </li>)}
    </ul>
    <ConfirmDialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}
      title={selected ? `${selected.paused ? "Resume" : "Pause"} ${labels[selected.feature].toLowerCase()} in ${kind}` : ""}
      description="Project approvals are kept. Changes to this pause are recorded in the audit log."
      confirmLabel={selected?.paused ? "Resume feature" : "Pause feature"} reasonLabel="Reason" destructive={!selected?.paused}
      busy={update.isPending} onConfirm={(reason) => { if (selected) update.mutate({ row: selected, reason }); }}>
      {update.error ? <ErrorPanel error={update.error} /> : null}
    </ConfirmDialog>
  </section>;
}

export function PlatformOperatorsPanel() {
  const { session } = useOrganization();
  const key = ["platform-operators"];
  const client = useQueryClient();
  const query = useQuery({ queryKey: key, queryFn: featureAccess.operators });
  const [email, setEmail] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (input: { email: string; method: "PUT" | "DELETE" }) => featureAccess.changeOperator(input.email, input.method),
    onSuccess: () => {
      setEmail("");
      setRemoving(null);
      void client.invalidateQueries({ queryKey: key });
    },
  });
  return <Panel title="Operators" description="Operators can approve requests and manage payout pauses.">
    {query.error ? <ErrorPanel title="Operators could not be loaded" error={query.error} /> : null}
    <ul className="divide-y">
      {query.data?.map((row) => <li key={row.email} className="flex items-center justify-between gap-3 py-2 text-[13px]">
        <div><span>{row.email}</span>
          <p className="text-xs text-muted-foreground">{row.source === "configuration" ? "From deployment configuration"
            : `Added by ${row.addedBy} on ${formatDateTime(row.addedAt)}`}</p>
        </div>
        {row.source === "console" && row.email !== session?.email ? <Button type="button" size="sm" variant="outline"
          onClick={() => { update.reset(); setRemoving(row.email); }}>Remove</Button> : null}
      </li>)}
    </ul>
    <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => {
      event.preventDefault();
      if (z.email().safeParse(email.trim()).success) update.mutate({ email: email.trim(), method: "PUT" });
    }}>
      <label className="flex min-w-48 flex-col gap-1 text-xs">Email address
        <Input type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <Button type="submit" size="sm" disabled={!email.trim() || update.isPending}>Add operator</Button>
    </form>
    {update.error && !removing ? <ErrorPanel error={update.error} /> : null}
    <ConfirmDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }}
      title={`Remove operator access for ${removing ?? ""}?`} confirmLabel="Remove operator" destructive busy={update.isPending}
      onConfirm={() => { if (removing) update.mutate({ email: removing, method: "DELETE" }); }}>
      {update.error ? <ErrorPanel error={update.error} /> : null}
    </ConfirmDialog>
  </Panel>;
}
