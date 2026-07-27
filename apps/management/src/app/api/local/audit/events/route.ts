import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  const format = url.searchParams.get("format");
  for (const key of ["limit", "serviceId", "type", "actionFamily", "actor"]) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await apiCenterAdminRequest(
    `/api/v1/analytics/audit/events${suffix}`,
  );

  if (format !== "csv") return response;
  if (!response.ok) return response;

  const payload = await response.json();
  const events = Array.isArray(payload.data) ? payload.data : [];
  const rows = [
    ["timestamp", "type", "actionFamily", "actor", "severity", "message"],
    ...events.map((event: Record<string, unknown>) => [
      event.timestamp,
      event.type,
      event.actionFamily ?? "",
      event.actor ?? "",
      event.severity,
      event.message,
    ]),
  ];

  return new Response(rows.map(toCsvRow).join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="audit-events.csv"',
    },
  });
}

function toCsvRow(values: unknown[]) {
  return values
    .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
    .join(",");
}
