"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FormRow, NativeSelect } from "@/components/patterns/form";
import { ErrorPanel } from "@/components/patterns/notices";
import { formatCentavos, parsePesos, PAYOUT_OPERATOR_REASON, WEEKDAYS, type PayoutPolicy } from "../../model/payouts";
import { usePayoutSettings, useSavePayoutSettings } from "../../view-models/payouts";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { useOrganization } from "../../view-models/use-organization";

/** The project's payout schedule, cash-out limits and who pays the transfer fee. */
export function PayoutSettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const settings = usePayoutSettings();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        {settings.error ? (
          <div className="p-4">
            <ErrorPanel title="Payout settings could not be loaded" error={settings.error} />
          </div>
        ) : settings.data && open ? (
          <SettingsForm initial={settings.data} onDone={() => onOpenChange(false)} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

const toPesos = (centavos: number) => (centavos / 100).toFixed(2);

function SettingsForm({ initial, onDone }: { initial: PayoutPolicy; onDone: () => void }) {
  const { kind, canWrite } = useProjectEnvironment();
  const { platformAdmin } = useOrganization();
  const canOperate = canWrite && platformAdmin;
  const save = useSavePayoutSettings();
  const [weekly, setWeekly] = useState(initial.schedule !== null);
  const [weekday, setWeekday] = useState(String(initial.schedule?.weekday ?? 5));
  const [hour, setHour] = useState(String(initial.schedule?.hour ?? 20));
  const [cashOut, setCashOut] = useState(initial.onDemand !== null);
  const [minimum, setMinimum] = useState(toPesos(initial.onDemand?.minimum ?? 10_000));
  const [dailyCap, setDailyCap] = useState(toPesos(initial.onDemand?.dailyCap ?? 1_000_000));
  const [scheduledBearer, setScheduledBearer] = useState(initial.feeBearer.scheduled);
  const [cashOutBearer, setCashOutBearer] = useState(initial.feeBearer.cashOut);
  const [settlementHoldDays, setSettlementHoldDays] = useState(String(initial.settlementHoldDays));
  const [requireVerification, setRequireVerification] = useState(initial.requirePayeeVerification);
  const [problem, setProblem] = useState<string | undefined>();

  function policy(): PayoutPolicy | string {
    const min = parsePesos(minimum);
    const cap = parsePesos(dailyCap);
    if (cashOut && (min === undefined || cap === undefined)) return "Enter the cash-out amounts in pesos, for example 100.00.";
    if (cashOut && cap! < min!) return "The daily cap must be at least the minimum.";
    if (!/^\d+$/.test(settlementHoldDays) || Number(settlementHoldDays) > 30) return "Use a settlement hold between 0 and 30 days.";
    return {
      ...initial,
      settlementHoldDays: Number(settlementHoldDays),
      requirePayeeVerification: requireVerification,
      schedule: weekly ? { weekday: Number(weekday), hour: Number(hour) } : null,
      onDemand: cashOut ? { minimum: min!, dailyCap: cap! } : null,
      feeBearer: { scheduled: scheduledBearer, cashOut: cashOutBearer },
    };
  }

  return (
    <form
      className="flex h-full flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        const next = policy();
        if (typeof next === "string") return setProblem(next);
        setProblem(undefined);
        save.mutate(next, {
          onSuccess: () => {
            toast.success("Payout settings saved");
            onDone();
          },
        });
      }}
    >
      <SheetHeader>
        <SheetTitle>Payout settings</SheetTitle>
        <SheetDescription>
          When this project&apos;s payees are paid in {kind}. Each transfer costs about {formatCentavos(initial.transferFee)}.
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-4 overflow-y-auto px-4">
        <FormRow label="Settlement hold (days)" htmlFor="payout-settlement-hold" hint="Released shares become payable after this many days.">
          <Input id="payout-settlement-hold" inputMode="numeric" value={settlementHoldDays}
            onChange={(event) => setSettlementHoldDays(event.target.value)} />
        </FormRow>
        <label className="flex items-center gap-2 text-[13px] font-medium">
          <input type="checkbox" checked={requireVerification} onChange={(event) => setRequireVerification(event.target.checked)} />
          Require a verification record before paying
        </label>
        <label className="flex items-center gap-2 text-[13px] font-medium">
          <input type="checkbox" checked={weekly} onChange={(event) => setWeekly(event.target.checked)} /> Pay weekly
        </label>
        {weekly ? (
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Day" htmlFor="payout-weekday">
              <NativeSelect id="payout-weekday" value={weekday} onChange={(event) => setWeekday(event.target.value)}>
                {WEEKDAYS.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </NativeSelect>
            </FormRow>
            <FormRow label="Hour (Philippine time)" htmlFor="payout-hour">
              <NativeSelect id="payout-hour" value={hour} onChange={(event) => setHour(event.target.value)}>
                {Array.from({ length: 24 }, (_, value) => (
                  <option key={value} value={value}>
                    {String(value).padStart(2, "0")}:00
                  </option>
                ))}
              </NativeSelect>
            </FormRow>
          </div>
        ) : null}
        <FormRow label="Weekly payout fee paid by" htmlFor="payout-scheduled-bearer">
          <NativeSelect id="payout-scheduled-bearer" value={scheduledBearer}
            onChange={(event) => setScheduledBearer(event.target.value as PayoutPolicy["feeBearer"]["scheduled"])}>
            <option value="platform">Your platform</option>
            <option value="payee">The payee</option>
          </NativeSelect>
        </FormRow>
        <label className="flex items-center gap-2 text-[13px] font-medium">
          <input type="checkbox" checked={cashOut} onChange={(event) => setCashOut(event.target.checked)} /> Allow cash-out
        </label>
        {cashOut ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <FormRow label="Minimum (₱)" htmlFor="payout-minimum">
                <Input id="payout-minimum" inputMode="decimal" value={minimum} onChange={(event) => setMinimum(event.target.value)} />
              </FormRow>
              <FormRow label="Daily cap (₱)" htmlFor="payout-cap">
                <Input id="payout-cap" inputMode="decimal" value={dailyCap} onChange={(event) => setDailyCap(event.target.value)} />
              </FormRow>
            </div>
            <FormRow label="Cash-out fee paid by" htmlFor="payout-cashout-bearer">
              <NativeSelect id="payout-cashout-bearer" value={cashOutBearer}
                onChange={(event) => setCashOutBearer(event.target.value as PayoutPolicy["feeBearer"]["cashOut"])}>
                <option value="payee">The payee</option>
                <option value="platform">Your platform</option>
              </NativeSelect>
            </FormRow>
          </>
        ) : null}
        {problem ? (
          <p role="alert" className="text-xs text-danger">
            {problem}
          </p>
        ) : null}
        {save.error ? <ErrorPanel title="The payout settings were not saved" error={save.error} /> : null}
        {!canOperate ? <p className="text-xs text-muted-foreground">{PAYOUT_OPERATOR_REASON}</p> : null}
      </div>
      <SheetFooter className="mt-auto flex-row justify-end border-t">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canOperate || save.isPending}>
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
      </SheetFooter>
    </form>
  );
}
