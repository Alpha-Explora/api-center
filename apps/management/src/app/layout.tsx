import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "APICenter",
  description:
    "Control layer for tenant runtimes, shared services, gateway routing, and operational audit.",
  icons: {
    icon: "/brand/apicenter-logo-icon-v2.png",
    shortcut: "/brand/apicenter-logo-icon-v2.png",
    apple: "/brand/apicenter-logo-icon-v2.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
