import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_Symbols_2 } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { SkipLink } from "@/components/SkipLink";
import { localeCorrectionScript } from "@/i18n/lang-script";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
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
// (→ ✓ ★ ☀ …) this app renders in real UI — they fell back to whatever font
// the OS happened to have, which is the runner image's fontconfig in CI.
// Self-hosting them the same way as Geist pins that fallback to the build,
// closing the residual risk ADR 20260730-pinned-browser-visual-determinism
// left open. `preload: false`: these only cover rare glyphs, not the
// above-the-fold text every page pays for on first paint.
//
// Pictographic emoji (🤿 🐬 ⛵ …) deliberately stay unpinned: a self-hosted
// Noto_Color_Emoji was tried and reverted (see the ADR) because it overrides
// every browser's own platform emoji font — Apple Color Emoji, Segoe UI
// Emoji — with Google's set, which renders visibly smaller and flatter than
// what users' actual browsers show natively. Matching real Chrome mattered
// more than pinning emoji for CI, so those glyphs still resolve through
// `system-ui, sans-serif` and remain a known source of CI-only diffs.
const notoSymbols = Noto_Sans_Symbols_2({
  variable: "--font-noto-symbols",
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

/**
 * The skip link's label needs the negotiated locale (`requestLocale`, backed
 * by `headers()`), same as every other diver-facing surface. Isolated in its
 * own component and wrapped in `<Suspense>` below so only this small piece
 * streams in at request time — the rest of the shell (including `<html>`,
 * fixed by the inline script instead; see lang-script.ts) stays static.
 */
async function LocalizedSkipLink() {
  const locale = await requestLocale();
  const t = diverTranslator(locale);
  return <SkipLink href="#main-content" label={t("nav.skipToContent")} />;
}

const defaultSkipLinkLabel = diverTranslator(DEFAULT_DIVER_LOCALE)("nav.skipToContent");

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang={DEFAULT_DIVER_LOCALE}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${notoSymbols.variable} h-full antialiased`}
    >
      <head>
        <script
          suppressHydrationWarning
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static, locally-generated script (no user input) that corrects `lang` before first paint — see lang-script.ts
          dangerouslySetInnerHTML={{ __html: localeCorrectionScript() }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <Suspense fallback={<SkipLink href="#main-content" label={defaultSkipLinkLabel} />}>
          <LocalizedSkipLink />
        </Suspense>
        {/*
         * Every page under `src/app` already renders its own top-level
         * `flex flex-1 flex-col` wrapper (or a `<main>` with the same
         * classes) as the direct child of `<body>` — this div reproduces
         * that same flex box one level up so the skip link has a stable,
         * focusable target without changing how any page's content sizes.
         */}
        <div id="main-content" tabIndex={-1} className="flex flex-1 flex-col outline-none">
          {children}
        </div>
        <Observability />
      </body>
    </html>
  );
}
