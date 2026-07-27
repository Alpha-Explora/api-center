type EvidenceSection = {
  key: string;
  status: "pass" | "fail";
  data?: unknown;
};

export function PromotionEvidencePanel({
  serviceId = "campus-one",
  sections,
}: {
  serviceId?: string;
  sections: EvidenceSection[];
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold">Promotion evidence</h2>
        <a
          className="text-sm font-medium underline-offset-4 hover:underline"
          href={`/api/local/operations/evidence/${encodeURIComponent(serviceId)}?format=md`}
        >
          Export Markdown
        </a>
      </div>
      <div className="rounded-md border">
        {sections.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            No promotion evidence selected.
          </p>
        ) : (
          sections.map((section) => (
            <div
              className="flex items-center justify-between border-b p-3 text-sm last:border-b-0"
              key={section.key}
            >
              <span className="font-medium capitalize">{section.key}</span>
              <span>{section.status}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
