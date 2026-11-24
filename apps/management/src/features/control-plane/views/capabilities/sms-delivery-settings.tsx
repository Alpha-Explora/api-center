"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormRow } from "@/components/patterns/form";
import { ErrorPanel } from "@/components/patterns/notices";
import { FeatureAccess, useFeaturePrompt } from "@/components/patterns/feature-access";
import { capabilityConfiguration } from "../../data/capability-configuration";
import { configurationKey } from "../../view-models/configuration-key";
import { useProjectEnvironment } from "../../view-models/project-environment";

type Policy = { dailyLimit?: number | null; allowedPrefixes?: string[] | null };
export function SmsDeliverySettings({ current, capability }: {
  current: Policy & { defaults?: Policy | null }; capability: "sms" | "otp";
}) {
  const { organizationId, project, kind, canWrite } = useProjectEnvironment();
  const scope = { organizationId, projectId: project.id, kind };
  const client = useQueryClient();
  const prompt = useFeaturePrompt(scope);
  const savedLimit = current.dailyLimit ?? current.defaults?.dailyLimit ?? 500;
  const savedPrefixes = (current.allowedPrefixes ?? current.defaults?.allowedPrefixes ?? ["+63"]).join(", ");
  const [limit, setLimit] = useState(String(savedLimit));
  const [prefixes, setPrefixes] = useState(savedPrefixes);
  const codes = prefixes.split(",").map((prefix) => prefix.trim()).filter(Boolean);
  const validLimit = /^\d+$/.test(limit) && Number(limit) > 0 && Number(limit) <= 2_147_483_647;
  const validCodes = codes.length > 0 && codes.length <= 100 && codes.every((prefix) => /^\+[1-9]\d{0,3}$/.test(prefix));
  const save = useMutation({
    mutationFn: (policy: Policy) => capabilityConfiguration.saveSmsDeliverySettings(scope, capability, policy),
    onSuccess: () => {
      toast.success("SMS delivery settings saved");
      for (const service of ["sms", "otp"] as const) {
        void client.invalidateQueries({ queryKey: configurationKey(organizationId, project.id, kind, service) });
      }
    },
    onError: (error, policy) => { if (prompt.handle(error, policy)) save.reset(); },
  });

  return <section className="space-y-3 border-t pt-3">
    <p className="text-[13px] font-medium">SMS delivery</p>
    <FormRow label="Daily limit" htmlFor={`${capability}-daily-limit`} hint="SMS and OTP texts each use their own daily allowance.">
      <Input id={`${capability}-daily-limit`} inputMode="numeric" value={limit} disabled={!canWrite}
        onChange={(event) => setLimit(event.target.value)} />
    </FormRow>
    {capability === "sms" ? <FormRow label="Countries" htmlFor="sms-countries" hint="Separate calling codes with commas, for example +63, +65.">
      <Input id="sms-countries" value={prefixes} disabled={!canWrite} onChange={(event) => setPrefixes(event.target.value)} />
    </FormRow> : null}
    <FeatureAccess feature="sms.daily_limit" requestAccess={false} />
    {capability === "sms" ? <FeatureAccess feature="sms.international" requestAccess={false} /> : null}
    {canWrite ? <Button type="button" size="sm" variant="outline"
      disabled={!validLimit || !validCodes || (Number(limit) === savedLimit && codes.join(", ") === savedPrefixes) || save.isPending}
      onClick={() => save.mutate({
        ...(Number(limit) !== savedLimit ? { dailyLimit: Number(limit) } : {}),
        ...(codes.join(", ") !== savedPrefixes ? { allowedPrefixes: codes } : {}),
      })}>Save delivery settings</Button> : null}
    {save.error ? <ErrorPanel error={save.error} /> : null}
    {prompt.dialog}
  </section>;
}
