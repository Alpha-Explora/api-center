"use client";

import { useEffect, useState } from "react";

interface ScalarApiReferenceProps {
  specUrl?: string;
}

export function ScalarApiReference({ specUrl = "/api/openapi.json" }: ScalarApiReferenceProps) {
  const [ScalarComponent, setScalarComponent] = useState<any>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    import("@scalar/api-reference-react")
      .then((mod) => {
        setScalarComponent(() => mod.ApiReferenceReact);
      })
      .catch((err) => {
        console.warn("Scalar API Reference React fallback mode activated:", err);
      });
  }, []);

  if (!mounted) {
    return (
      <div style={{ padding: "3rem", color: "#888", textAlign: "center", fontSize: "16px" }}>
        Loading interactive Scalar API sandbox...
      </div>
    );
  }

  if (ScalarComponent) {
    return (
      <div style={{ width: "100%", minHeight: "calc(100vh - 64px)", background: "#0f0f0f" }}>
        <ScalarComponent
          configuration={{
            spec: {
              url: specUrl,
            },
            theme: "saturn",
            layout: "modern",
            showSidebar: true,
            isEditable: false,
            darkMode: true,
            searchHotKey: "k",
            metaData: {
              title: "APICenter Interactive API Sandbox",
            },
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: "3rem", background: "#111", border: "1px solid #333", borderRadius: "8px", margin: "2rem" }}>
      <h3 style={{ color: "#fff", fontSize: "20px", marginBottom: "0.5rem" }}>Scalar API Sandbox</h3>
      <p style={{ color: "#aaa", fontSize: "15px" }}>
        Explore and test APICenter REST endpoints directly. Access raw OpenAPI contract at{" "}
        <a href="/api/openapi.json" target="_blank" style={{ color: "#0070f3", textDecoration: "underline" }}>
          openapi.json
        </a>.
      </p>
    </div>
  );
}
