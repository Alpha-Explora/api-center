export function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h2 className="text-xl font-semibold tracking-normal">{title}</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
