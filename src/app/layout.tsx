import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Color_Emoji, Noto_Sans_Symbols_2 } from "next/font/google";
import "./globals.css";
import { publicAppUrl } from "@/lib/notifications";
import { Observability } from "./observability-client";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Geist's "latin" subset does not cover the arrows, checkmarks, and dingbats
// (→ ✓ ★ ☀ …) this app renders in real UI, or the emoji (🤿 🐬 ⛵ …) in
// marketing copy — both fell back to whatever font the OS happened to have,
// which is the runner image's fontconfig in CI. Self-hosting them the same
// way as Geist pins that fallback to the build, closing the residual risk
// ADR 20260730-pinned-browser-visual-determinism left open. `preload: false`:
// these only cover rare glyphs, not the above-the-fold text every page pays
// for on first paint.
const notoSymbols = Noto_Sans_Symbols_2({
  variable: "--font-noto-symbols",
  weight: "400",
  preload: false,
});

const notoEmoji = Noto_Color_Emoji({
  variable: "--font-noto-emoji",
  weight: "400",
  preload: false,
});

export const metadata: Metadata = {
  // The canonical origin comes from APP_HOST (the same source bearer-token
  // links use); localhost keeps relative-URL resolution working in dev/e2e.
  metadataBase: new URL(publicAppUrl() ?? "http://localhost:3000"),
  title: "DiveDay — a calmer way to run a dive day",
  description:
    "Bookings, waivers, cert checks, trip prep, and boat manifests — one calm system for the whole dive shop.",
  openGraph: {
    siteName: "DiveDay",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSymbols.variable} ${notoEmoji.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Observability />
      </body>
    </html>
  );
}
