"use client";

import { useEffect, useState, type ComponentType } from "react";
import { useTheme } from "next-themes";
// Scalar's own styles, scoped to its container; its colors and fonts are set from ours below.
import "@scalar/api-reference-react/style.css";

interface ScalarApiReferenceProps {
  specUrl?: string;
}

/** Scalar's in-browser API client, in the docs' theme: light or dark with the site, Geist type, neutral colors. */
export function ScalarApiReference({ specUrl = "/api/openapi.json" }: ScalarApiReferenceProps) {
  const [Scalar, setScalar] = useState<ComponentType<{ configuration: Record<string, unknown> }> | null>(null);
  const [failed, setFailed] = useState(false);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    import("@scalar/api-reference-react")
      .then((mod) => setScalar(() => mod.ApiReferenceReact as ComponentType<{ configuration: Record<string, unknown> }>))
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <div className="m-8 rounded-lg border bg-fd-card p-6 text-sm">
        <p className="font-semibold">The interactive client could not load</p>
        <p className="mt-1 text-fd-muted-foreground">
          The <a href="/reference/api" className="underline">API reference</a> has every endpoint, and the raw contract is at{" "}
          <a href="/api/openapi.json" className="underline">openapi.json</a>.
        </p>
      </div>
    );
  }
  if (!Scalar || !resolvedTheme) {
    return <p className="p-12 text-center text-sm text-fd-muted-foreground">Loading the API client…</p>;
  }
  return (
    <div className="w-full">
      <Scalar
        key={resolvedTheme}
        configuration={{
          spec: { url: specUrl },
          theme: "none",
          layout: "modern",
          darkMode: resolvedTheme === "dark",
          hideDarkModeToggle: true,
          withDefaultFonts: false,
          isEditable: false,
          searchHotKey: "k",
          // A tool for trying requests: no developer toolbar, telemetry or hosted extras.
          showDeveloperTools: "never",
          telemetry: false,
          mcp: { disabled: true },
          agent: { disabled: true },
          documentDownloadType: "json",
          metaData: { title: "APICenter API client" },
          customCss: SCALAR_CSS,
        }}
      />
    </div>
  );
}

/** Scalar's color and font variables, set from the docs' tokens. */
const SCALAR_CSS = `
.light-mode, .dark-mode {
  --scalar-font: var(--font-sans);
  --scalar-font-code: var(--font-mono);
  --scalar-background-1: var(--background);
  --scalar-background-2: var(--card);
  --scalar-background-3: var(--muted);
  --scalar-background-accent: var(--accent);
  --scalar-color-1: var(--foreground);
  --scalar-color-2: var(--muted-foreground);
  --scalar-color-3: var(--muted-foreground);
  --scalar-color-accent: var(--foreground);
  --scalar-border-color: var(--border);
  --scalar-color-green: var(--success);
  --scalar-color-red: var(--danger);
  --scalar-color-yellow: var(--warning);
  --scalar-color-blue: var(--info);
  --scalar-color-orange: var(--warning);
  --scalar-color-purple: var(--info);
  --scalar-radius: 6px;
  --scalar-radius-lg: 8px;
}
`;
