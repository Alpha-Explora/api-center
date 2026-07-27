export function QuotaForecastPanel({
  daysUntilExhaustion,
  projectedMonthlyUsage,
}: {
  daysUntilExhaustion: number | null;
  projectedMonthlyUsage: number;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">Quota forecast</h2>
      <p className="text-sm text-muted-foreground">
        {daysUntilExhaustion === null
          ? "No exhaustion projected."
          : `Quota may be exhausted in ${daysUntilExhaustion} days.`}
      </p>
      <p className="text-sm">
        Projected monthly usage: {projectedMonthlyUsage.toLocaleString()} calls
      </p>
    </section>
  );
}
