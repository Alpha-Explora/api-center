"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { ComingSoonBadge } from "@/components/patterns/coming-soon";
import { FeatureAccess } from "@/components/patterns/feature-access";
import { ErrorPanel, Notice } from "@/components/patterns/notices";
import { GuardedButton } from "@/components/patterns/guarded-button";
import { Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatDateTime } from "@/lib/format";
import { availabilityMessage, type LinkedAccountAction } from "../../model/payouts";
import { useLinkedAccount, useUpdateLinkedAccount } from "../../view-models/payouts";

const fields = [
  { name: "businessName", label: "Business name" },
  { name: "tin", label: "Business TIN" },
  { name: "expectedMonthlyVolume", label: "Expected monthly volume in centavos", type: "number", min: 0, step: 1 },
  { name: "firstName", label: "Representative’s first name" },
  { name: "lastName", label: "Representative’s last name" },
  { name: "email", label: "Representative’s email", type: "email" },
] as const;

export function LinkedAccountPanel({ live, canWrite, platformAdmin, paused = false }: {
  live: boolean;
  canWrite: boolean;
  platformAdmin: boolean;
  paused?: boolean;
}) {
  const query = useLinkedAccount();
  const mutation = useUpdateLinkedAccount();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmation, setConfirmation] = useState<"child" | "parent" | "close" | null>(null);
  const account = query.data?.onboarding;
  const roleReason = "Your role cannot change this environment.";
  const platformReason = "A platform admin must change this setting.";
  const enabled = query.data?.environmentEnabled && query.data.projectEnabled && !paused;

  async function execute(action: LinkedAccountAction): Promise<boolean> {
    setCopied(false);
    try {
      setLink(await mutation.mutateAsync(action));
      mutation.reset();
      setConfirmation(null);
      return true;
    } catch {
      return false;
    }
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const field = (name: string) => String(data.get(name) ?? "").trim();
    if (await execute({ kind: "start", details: {
      businessName: field("businessName"), tin: field("tin"), expectedMonthlyVolume: Number(field("expectedMonthlyVolume")),
      representative: { firstName: field("firstName"), lastName: field("lastName"), email: field("email") },
    } })) form.reset();
  }

  return (
    <Panel title="Project merchant account">
      <div className="flex flex-col gap-4 text-sm">
        {query.error ? <ErrorPanel title="The linked account could not be loaded" error={query.error} /> : null}
        {mutation.error ? <ErrorPanel title="The linked account could not be updated" error={mutation.error} /> : null}
        {query.isPending ? <Skeleton className="h-10 w-full" /> : null}
        {query.data ? (
          <>
            {paused || !query.data.projectEnabled ? <FeatureAccess feature="payouts.merchant_account" fallback requestAccess={!query.data.projectEnabled} /> : null}
            {live ? <p className="text-live font-medium">Live environment</p> : null}
            {!query.data.environmentEnabled && !platformAdmin ? (
              <Notice title={<span className="flex items-center gap-2">Project merchant account <ComingSoonBadge live={live} /></span>}>
                {availabilityMessage("linkedAccounts", { available: false, reason: live ? "not_enabled" : "provider_unavailable" })}
              </Notice>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{query.data.projectEnabled ? "Enabled for this project"
                  : live ? "Not enabled for this project yet. A platform operator enables it." : "Off for this project. Turn it on to try it in test."}</span>
                <GuardedButton allowed={canWrite && (platformAdmin || !live)} reason={canWrite ? platformReason : roleReason} variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => void execute({ kind: "enabled", enabled: !query.data?.projectEnabled })}>
                  {query.data.projectEnabled ? "Disable for project" : "Enable for project"}
                </GuardedButton>
              </div>
            )}
            {enabled && !query.data.providerAvailable ? <Notice title="Onboarding is waiting on the payment provider's verification of this feature" /> : null}
            {account ? (
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={account.status} />
                <span className="text-muted-foreground">{account.attempts} of 3 verification attempts used</span>
                <Button variant="ghost" onClick={() => void query.refetch()}>Refresh status</Button>
              </div>
            ) : null}
            {account?.declineReason ? <p>{account.declineReason}</p> : null}
            {account?.nextAction === "await_manual_review" ? <p>The payment provider’s manual review can take 7 to 14 days.</p> : null}
            {link ? (
              <div className="space-y-2 rounded-md border p-3">
                <p>This link is shown once. Reissue it if it is lost.</p>
                <a className="break-all underline" href={link.url} target="_blank" rel="noreferrer">{link.url}</a>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Expires {formatDateTime(link.expiresAt)}</span>
                  <Button variant="outline" size="sm" onClick={() => {
                    void navigator.clipboard.writeText(link.url).then(() => setCopied(true), () => setCopied(false));
                  }}>{copied ? "Copied" : "Copy link"}</Button>
                  <Button variant="ghost" size="sm" onClick={() => setLink(null)}>Dismiss</Button>
                </div>
              </div>
            ) : null}
            {enabled && query.data.providerAvailable && (!account
              || account.status === "declined" || account.nextAction === "create" || account.nextAction === "submit_details") ? (
              <form onSubmit={start} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  {fields.map(({ label, ...input }) => (
                    <label key={input.name} className="flex flex-col gap-1.5">
                      <span className="font-medium">{label}</span>
                      <Input {...input} required disabled={!canWrite || mutation.isPending} autoComplete="off" />
                    </label>
                  ))}
                </div>
                <GuardedButton type="submit" allowed={canWrite} reason={roleReason} disabled={mutation.isPending}>
                  {account && account.status !== "declined" ? "Continue onboarding" : "Start onboarding"}
                </GuardedButton>
              </form>
            ) : null}
            {account ? (
              <div className="flex flex-wrap gap-2">
                {enabled && query.data.providerAvailable && ["await_verification", "issue_verification_link", "reissue_verification_link"].includes(account.nextAction) ? (
                  <GuardedButton allowed={canWrite} reason={roleReason} disabled={mutation.isPending} variant="outline"
                    onClick={() => void execute({ kind: "verification-link", id: account.id, requestKey: crypto.randomUUID() })}>
                    {account.nextAction === "issue_verification_link" ? "Issue verification link" : "Reissue verification link"}
                  </GuardedButton>
                ) : null}
                {enabled && query.data.providerAvailable && account.nextAction === "activate" ? (
                  <GuardedButton allowed={canWrite} reason={roleReason} disabled={mutation.isPending}
                    onClick={() => void execute({ kind: "advance", id: account.id })}>Request activation</GuardedButton>
                ) : null}
                {enabled && query.data.providerAvailable && account.nextAction === "request_payment_methods" ? (
                  <GuardedButton allowed={canWrite} reason={roleReason} disabled={mutation.isPending} variant="outline"
                    onClick={() => void execute({ kind: "advance", id: account.id })}>Request payment methods</GuardedButton>
                ) : null}
                {enabled && query.data.collectionMoveAvailable && account.status === "active" && !account.walletOnly ? (
                  <GuardedButton allowed={canWrite} reason={roleReason} disabled={mutation.isPending}
                    onClick={() => setConfirmation("child")}>Move project to this account</GuardedButton>
                ) : null}
                {account.status === "active" && query.data.collectionMoveAvailable ? (
                  <GuardedButton allowed={canWrite} reason={roleReason} disabled={mutation.isPending} variant="outline"
                    onClick={() => setConfirmation("parent")}>Move back to main account</GuardedButton>
                ) : null}
                <GuardedButton allowed={canWrite && platformAdmin} reason={platformReason} disabled={mutation.isPending}
                  variant="outline" onClick={() => setConfirmation("close")}>Close onboarding</GuardedButton>
              </div>
            ) : null}
          </>
        ) : null}
        <ConfirmDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }}
          title={confirmation === "close" ? "Close the project account?" : "Move project payments?"}
          description={confirmation === "child"
            ? "New payments will go to the project’s account. Money already collected keeps paying from the account that holds it."
            : confirmation === "close"
              ? "Close the account in APICenter after its allocations are paid or cancelled."
              : "New payments will go to the main account. Prior payments and earnings stay with the account that holds them."}
          confirmLabel={confirmation === "close" ? "Close account" : "Move project"}
          destructive={confirmation === "close"} busy={mutation.isPending}
          onConfirm={() => {
            if (!account || !confirmation) return;
            void execute(confirmation === "close" ? { kind: "close", id: account.id }
              : { kind: "move", id: account.id, target: confirmation });
          }}
        />
      </div>
    </Panel>
  );
}
