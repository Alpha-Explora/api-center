export function TribeCostAndQuotaPanel({
  totalCost,
  quotaUsagePercent,
}: {
  totalCost: number;
  quotaUsagePercent: number;
}) {
  const state = quotaUsagePercent >= 90 ? "High usage" : "Normal usage";

  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">Cost and quota pressure</h2>
      <p className="text-sm text-muted-foreground">{state}</p>
      <p className="text-2xl font-semibold">${totalCost.toFixed(2)}</p>
    </section>
  );
}
