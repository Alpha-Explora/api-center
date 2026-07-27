"use client";

export function ComplianceExportPanel({
  onExport,
}: {
  onExport?: (input: { from: string; to: string; format: string }) => void;
}) {
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const input = {
          from: String(form.get("from")),
          to: String(form.get("to")),
          format: String(form.get("format")),
        };
        if (onExport) {
          onExport(input);
          return;
        }
        window.location.href = `/api/local/compliance/export?from=${encodeURIComponent(input.from)}&to=${encodeURIComponent(input.to)}&format=${encodeURIComponent(input.format)}`;
      }}
    >
      <h2 className="text-base font-semibold">Compliance export</h2>
      <div className="grid gap-3 md:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(10rem,0.8fr)_auto] md:items-end">
        <label
          className="flex flex-col gap-1 text-sm font-medium"
          htmlFor="compliance-export-from"
        >
          From date
          <input
            id="compliance-export-from"
            name="from"
            type="date"
            required
            className="h-9 rounded-md border bg-background px-3 text-sm"
          />
        </label>
        <label
          className="flex flex-col gap-1 text-sm font-medium"
          htmlFor="compliance-export-to"
        >
          To date
          <input
            id="compliance-export-to"
            name="to"
            type="date"
            required
            className="h-9 rounded-md border bg-background px-3 text-sm"
          />
        </label>
        <label
          className="flex flex-col gap-1 text-sm font-medium"
          htmlFor="compliance-export-format"
        >
          Evidence format
          <select
            id="compliance-export-format"
            name="format"
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="json">JSON</option>
            <option value="md">Markdown</option>
          </select>
        </label>
        <button className="h-9 rounded-md border px-3 text-sm" type="submit">
          Export evidence
        </button>
      </div>
    </form>
  );
}
