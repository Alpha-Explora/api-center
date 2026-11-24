"use client";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ComingSoonBadge } from "@/components/patterns/coming-soon";
import { ErrorPanel } from "@/components/patterns/notices";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatDateTime } from "@/lib/format";
import { availabilityMessage, describeDestination, formatCentavos, type FeatureAvailability } from "../../model/payouts";
import { usePayee } from "../../view-models/payouts";

const EARNINGS: Array<[keyof import("../../model/payouts").PayeeDetail["earnings"], string]> = [
  ["awaitingPayment", "Awaiting payment"],
  ["held", "Held until released"],
  ["available", "Ready for the next payout"],
  ["inFlight", "Being paid"],
  ["paidThisWeek", "Paid this week"],
];

/** One payee: where they are paid and what they have earned. */
export function PayeeSheet({ payeeId, onOpenChange, walletOnboarding }: {
  payeeId: string | null;
  onOpenChange: (open: boolean) => void;
  /** Whether payee wallet onboarding is available; shown as coming soon until it is. */
  walletOnboarding?: FeatureAvailability;
}) {
  const payee = usePayee(payeeId);
  return (
    <Sheet open={payeeId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{payee.data?.legalName ?? "Payee"}</SheetTitle>
          <SheetDescription>{payee.data ? <span className="font-mono text-xs">{payee.data.externalRef}</span> : null}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4 text-sm">
          {payee.error ? (
            <ErrorPanel title="The payee could not be loaded" error={payee.error} />
          ) : !payee.data ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <StatusBadge status={payee.data.status} />
                </dd>
                <dt className="text-muted-foreground">Verification</dt>
                <dd>
                  {payee.data.verification ? (
                    <>
                      <span className="capitalize">{payee.data.verification.method.replaceAll("_", " ")}</span>
                      <span className="block text-xs text-muted-foreground">
                        {payee.data.verification.verifiedBy} · {formatDateTime(payee.data.verification.verifiedAt)}
                      </span>
                    </>
                  ) : "Unrecorded"}
                </dd>
                {walletOnboarding && !walletOnboarding.available ? (
                  <>
                    <dt className="text-muted-foreground">Wallet onboarding</dt>
                    <dd title={availabilityMessage("payeeWallets", walletOnboarding) ?? undefined}>
                      <ComingSoonBadge />
                    </dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Paid to</dt>
                <dd>
                  {describeDestination(payee.data.destination)}
                  {payee.data.destination ? <span className="block text-xs text-muted-foreground">{payee.data.destination.accountName}</span> : null}
                </dd>
                {/* Compared with when the payee was read, so rendering stays pure. */}
                {payee.data.destinationHoldUntil && Date.parse(payee.data.destinationHoldUntil) > payee.dataUpdatedAt ? (
                  <>
                    <dt className="text-muted-foreground">On hold until</dt>
                    <dd title="Payouts wait 24 hours after the destination changes.">{formatDateTime(payee.data.destinationHoldUntil)}</dd>
                  </>
                ) : null}
              </dl>
              <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 border-t pt-3">
                {EARNINGS.map(([key, label]) => (
                  <div key={key} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right font-medium tabular-nums">{formatCentavos(payee.data.earnings[key])}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
