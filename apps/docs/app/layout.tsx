import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { RootProvider } from "fumadocs-ui/provider/next";
import "./globals.css";

// The console's type: Geist for text, Geist Mono for code, IDs and paths.
const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: "APICenter Docs", template: "%s | APICenter Docs" },
  description: "Call email, SMS, one-time codes, Google sign-in, geolocation and payments from your backend through one API and one key.",
  icons: { icon: "/brand/apicenter-logo-icon-v2.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        {/* Light, dark or the system's, like the console. Search runs on a static index (no server). */}
        <RootProvider theme={{ defaultTheme: "system", enableSystem: true }} search={{ options: { type: "static" } }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
