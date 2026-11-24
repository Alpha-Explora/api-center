"use client";
import { useState } from "react";
import { BanknoteIcon, MoreHorizontalIcon, Settings2Icon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { EmptyState } from "@/components/patterns/empty-state";
import { Explainer } from "@/components/patterns/explainer";
import { GuardedButton } from "@/components/patterns/guarded-button";
import { ComingSoonBadge } from "@/components/patterns/coming-soon";
import { ErrorPanel, Notice } from "@/components/patterns/notices";
import { PageHeader } from "@/components/patterns/page-header";
import { Panel } from "@/components/patterns/panel";
import { RelativeTime } from "@/components/patterns/relative-time";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatDateTime } from "@/lib/format";
import { availabilityMessage, describeDestination, describeSchedule, formatCentavos, PAYOUT_OPERATOR_REASON, TRIGGER_LABELS, type Payout } from "../../model/payouts";
import { usePayees, usePayoutOverview, usePayouts, usePayoutSettings, useResolvePayout } from "../../view-models/payouts";
import { RequireEnvironment, useProjectEnvironment } from "../../view-models/project-environment";
import { useOrganization } from "../../view-models/use-organization";
import { PayeeSheet } from "./payee-sheet";
import { LinkedAccountPanel } from "./linked-account-panel";
import { PayoutSettingsSheet } from "./payout-settings-sheet";

export function PayoutsPage() {
  return (
    <RequireEnvironment>
      <Payouts />
    </RequireEnvironment>
  );
}

type Resolution = { payout: Payout; outcome: "paid" | "failed" };

function Payouts() {
  const { kind, canWrite } = useProjectEnvironment();
  const { platformAdmin } = useOrganization();
  const canOperate = canWrite && platformAdmin;
  const overview = usePayoutOverview();
  const settings = usePayoutSettings();
  const list = usePayouts();
  const payees = usePayees();
  const resolve = useResolvePayout();
  const [editing, setEditing] = useState(false);
  const [payeeId, setPayeeId] = useState<string | null>(null);
  const [resolving, setResolving] = useState<Resolution | null>(null);
  const payeeNames = new Map((payees.data?.records ?? []).map((payee) => [payee.id, payee.legalName]));
  const nameOf = (id: string) => payeeNames.get(id) ?? id;

  return (
    <>
      <PageHeader
        title="Payouts"
        description="Payees' earnings from this environment's payments, paid weekly from the payout wallet or when they cash out."
        actions={
          <GuardedButton allowed={canOperate} reason={PAYOUT_OPERATOR_REASON} variant="outline" onClick={() => setEditing(true)}>
            <Settings2Icon data-icon="inline-start" /> Payout settings
          </GuardedButton>
        }
      />

      {kind === "live" ? (
        <Notice tone="warning" title="Live payouts move real money">
          Resolving a payout or changing the schedule here affects what payees receive.
        </Notice>
      ) : null}

      <Explainer id="payouts" title="How payouts work">
        <ul className="list-disc space-y-0.5 pl-4">
          <li>Your application attaches payee shares (allocations) to payments and releases them when the work is done.</li>
          <li>Released earnings are pooled per payee and paid on the weekly schedule, or earlier when the payee cashes out.</li>
          <li>A payout whose transfer cannot be confirmed is never sent again. After a day it waits here for a person.</li>
        </ul>
      </Explainer>

      <Panel title="Wallet and schedule">
        {overview.error ? (
          <ErrorPanel title="The payout wallet could not be loaded" error={overview.error} />
        ) : overview.isLoading || !overview.data ? (
          <Skeleton className="h-16 w-full" />
        ) : !overview.data.availability.transfers.available ? (
          <Notice title={<span className="flex items-center gap-2">Sending payouts <ComingSoonBadge /></span>}>
            {availabilityMessage("transfers", overview.data.availability.transfers)}
          </Notice>
        ) : (
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Available in the wallet</dt>
              <dd className="text-lg font-semibold">
                {overview.data.wallet.available === null ? "Unavailable" : formatCentavos(overview.data.wallet.available)}
              </dd>
              <dd className="text-xs text-muted-foreground">Payouts pause below {formatCentavos(overview.data.wallet.lowFloatAlert)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Next weekly payout</dt>
              <dd className="font-medium" title={formatDateTime(overview.data.nextScheduledAt)}>
                {overview.data.nextScheduledAt ? formatDateTime(overview.data.nextScheduledAt) : "No weekly payout"}
              </dd>
              <dd className="text-xs text-muted-foreground">{settings.data ? describeSchedule(settings.data.schedule) : null}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Cash-out</dt>
              <dd className="font-medium">
                {settings.data?.onDemand
                  ? `${formatCentavos(settings.data.onDemand.minimum)} minimum, ${formatCentavos(settings.data.onDemand.dailyCap)} a day`
                  : settings.data ? "Off" : "—"}
              </dd>
            </div>
          </dl>
        )}
      </Panel>

      <LinkedAccountPanel key={kind} live={kind === "live"} canWrite={canWrite} platformAdmin={platformAdmin} />

      {overview.data?.wallets?.length ? (
        <Panel title="Collections by merchant account" description="Payments recorded in the last 30 days for this project." flush>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Account</TableHead><TableHead className="text-right">Collected</TableHead>
                <TableHead className="text-right">Wallet balance</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {overview.data.wallets.map((wallet) => (
                <TableRow key={wallet.accountId}>
                  <TableCell>{wallet.accountId === "parent" ? "Main account" : wallet.accountId}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCentavos(wallet.collectedCentavos)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {wallet.available === null ? "Unavailable" : formatCentavos(wallet.available)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      ) : null}

      {overview.data && overview.data.needsReview.length > 0 ? (
        <Panel
          title="Needs review"
          description="APICenter could not confirm these transfers with the provider. Look each reference up in the PayMongo dashboard before resolving it."
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payee</TableHead>
                <TableHead>Net</TableHead>
                <TableHead className="hidden sm:table-cell">Reference</TableHead>
                <TableHead className="hidden md:table-cell">Created</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.data.needsReview.map((payout) => (
                <TableRow key={payout.id}>
                  <TableCell className="font-medium">{nameOf(payout.payeeId)}</TableCell>
                  <TableCell>{formatCentavos(payout.net)}</TableCell>
                  <TableCell className="hidden font-mono text-xs sm:table-cell">{payout.id.replace(/^po_/, "").toUpperCase()}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    <RelativeTime value={payout.createdAt} />
                  </TableCell>
                  <TableCell className="text-right">
                    {canOperate ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`Resolve ${payout.id}`} />}>
                          <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => setResolving({ payout, outcome: "paid" })}>Mark as paid</DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => setResolving({ payout, outcome: "failed" })}>
                            Mark as failed
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      ) : null}

      <Panel title="Payouts" flush>
        {list.error ? (
          <div className="p-4">
            <ErrorPanel title="Payouts could not be loaded" error={list.error} />
          </div>
        ) : list.isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !list.data?.records.length ? (
          <EmptyState icon={<BanknoteIcon />} title="No payouts yet" description="Payouts appear once payees have released earnings and a payout runs." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Net</TableHead>
                <TableHead className="hidden sm:table-cell">Fee</TableHead>
                <TableHead className="hidden md:table-cell">Type</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.records.map((payout) => (
                <TableRow key={payout.id}>
                  <TableCell className="font-medium">{nameOf(payout.payeeId)}</TableCell>
                  <TableCell className="whitespace-normal">
                    <StatusBadge status={payout.status} />
                    {payout.failureCode ? <p className="mt-1 text-xs text-danger">{payout.failureCode}</p> : null}
                  </TableCell>
                  <TableCell>{formatCentavos(payout.net)}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{formatCentavos(payout.fee)}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{TRIGGER_LABELS[payout.trigger]}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell" title={formatDateTime(payout.createdAt)}>
                    <RelativeTime value={payout.createdAt} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <Panel title="Payees" flush>
        {payees.error ? (
          <div className="p-4">
            <ErrorPanel title="Payees could not be loaded" error={payees.error} />
          </div>
        ) : payees.isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !payees.data?.records.length ? (
          <EmptyState
            icon={<UsersIcon />}
            title="No payees yet"
            description="Your application registers payees through the API with api.payments.payees.create."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payee</TableHead>
                <TableHead className="hidden sm:table-cell">Your reference</TableHead>
                <TableHead>Paid to</TableHead>
                <TableHead className="hidden md:table-cell">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payees.data.records.map((payee) => (
                <TableRow key={payee.id}>
                  <TableCell>
                    <button type="button" className="font-medium hover:underline" onClick={() => setPayeeId(payee.id)}>
                      {payee.legalName}
                    </button>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs sm:table-cell">{payee.externalRef}</TableCell>
                  <TableCell className="text-muted-foreground">{describeDestination(payee.destination)}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <StatusBadge status={payee.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <PayoutSettingsSheet open={editing} onOpenChange={setEditing} />
      <PayeeSheet payeeId={payeeId} onOpenChange={(open) => !open && setPayeeId(null)}
        walletOnboarding={overview.data?.availability.payeeWallets} />
      <ConfirmDialog
        open={resolving !== null}
        onOpenChange={(next) => {
          if (!next) {
            setResolving(null);
            resolve.reset();
          }
        }}
        title={resolving?.outcome === "paid" ? "Mark this payout as paid" : "Mark this payout as failed"}
        description={
          resolving?.outcome === "paid"
            ? "Only if the PayMongo dashboard shows the transfer succeeded. The payee's earnings are recorded as paid."
            : "Only if the PayMongo dashboard has no transfer with this reference. The earnings return to the payee's balance and are paid in a later payout. Never send the money by hand as well."
        }
        confirmLabel={resolving?.outcome === "paid" ? "Mark as paid" : "Mark as failed"}
        destructive={resolving?.outcome === "failed"}
        reasonLabel="What you found in the dashboard"
        busy={resolve.isPending}
        onConfirm={(note) => {
          if (!resolving) return;
          resolve.mutate(
            { payoutId: resolving.payout.id, outcome: resolving.outcome, note },
            {
              onSuccess: () => {
                toast.success(resolving.outcome === "paid" ? "Payout marked as paid" : "Payout marked as failed");
                setResolving(null);
              },
              onError: (error: Error) => toast.error(error.message),
            },
          );
        }}
      />
    </>
  );
}
