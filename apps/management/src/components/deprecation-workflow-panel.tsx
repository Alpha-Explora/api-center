type DeprecationState = {
  productId: string;
  status: string;
  impactedConsumers: string[];
  nextAction?: string;
};

export function DeprecationWorkflowPanel({
  deprecations,
}: {
  deprecations: DeprecationState[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Deprecation workflow</h2>
      {deprecations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No deprecated products need action.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {deprecations.map((deprecation) => (
            <li className="p-3 text-sm" key={deprecation.productId}>
              <div className="font-medium">{deprecation.productId}</div>
              <div className="text-muted-foreground">
                {deprecation.status} - {deprecation.nextAction}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
