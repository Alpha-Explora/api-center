import type { Metadata } from "next";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider";
import { getFumadocsPageTree } from "@/lib/source";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "APICenter Developer Documentation", template: "%s | APICenter Docs" },
  description: "Provider-neutral gateway, shared services documentation, and interactive API reference.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const tree = getFumadocsPageTree();

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <RootProvider theme={{ defaultTheme: "dark", enabled: false }}>
          <DocsLayout
            tree={tree}
            nav={{
              title: (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 800, fontSize: "15px" }}>
                  <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
                    <rect width="32" height="32" rx="6" fill="#3B82F6" />
                    <path d="M10 22L16 10L22 22H19.5L16 15L12.5 22H10Z" fill="white" />
                  </svg>
                  <span>APICenter</span>
                </div>
              ),
              children: (
                <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "13px", fontWeight: 500, color: "#888888", marginLeft: "12px" }}>
                  <a href="/reference/api" style={{ color: "#ededed" }}>Docs</a>
                  <a href="/guides/getting-started" style={{ color: "#888888" }}>Build</a>
                  <a href="/guides/sdk-usage" style={{ color: "#888888" }}>Learn</a>
                </div>
              ),
            }}
            sidebar={{
              defaultOpenLevel: 0,
              collapsible: true,
            }}
          >
            {children}
          </DocsLayout>
        </RootProvider>
      </body>
    </html>
  );
}