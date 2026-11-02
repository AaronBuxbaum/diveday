"use client";
// i18n-exempt-file: root crash boundary — it replaces the layout that would
// normally resolve a locale, and must render without depending on any state
// that might be what crashed.

import { useEffect } from "react";
import { LogoMark } from "@/components/Logo";
import { buttonClass } from "@/components/ui/button";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import { isStaleDeployError } from "@/lib/stale-deploy-error";
import { fontVariables } from "./_fonts/fonts";
import "./globals.css";

const RELOADED_KEY = "diveday:stale-deploy-reloaded";
const RELOAD_LOOP_WINDOW_MS = 60_000;

/**
 * Replaces the entire root layout when it crashes (Next convention — it must
 * define its own <html>/<body>), so it re-imports globals.css itself rather
 * than inheriting it. Reports to Sentry (docs ADR
 * 20260727-sentry-error-monitoring-q7fk2p) — this is the one render failure
 * `onRequestError` in src/instrumentation.ts doesn't already see, since it
 * happens client-side after hydration. Sentry is dynamically imported at the
 * point of the crash, not statically at module scope, so the SDK never ships
 * in this route's bundle on the golden path where nobody ever sees this page
 * (docs/architecture/performance-budgets.md).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // A tab older than the last deploy crashes on its first button press, and
  // `reset()` re-renders the same stale script. Load the page again instead,
  // once a minute: a second crash straight after is a real one and stays on screen.
  const stale = isStaleDeployError(error);
  useEffect(() => {
    if (!stale) {
      import("@sentry/nextjs").then(({ captureException }) => captureException(error));
      return;
    }
    try {
      const last = Number(window.sessionStorage.getItem(RELOADED_KEY));
      if (Date.now() - last < RELOAD_LOOP_WINDOW_MS) return;
      window.sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
    } catch {
      return;
    }
    window.location.reload();
  }, [error, stale]);

  return (
    <html lang="en" className={`${fontVariables} h-full antialiased`}>
      <body className="flex min-h-full flex-col items-center justify-center gap-6 bg-background px-6 text-center text-foreground">
        <span className="grid size-12 place-items-center rounded-inset bg-primary text-primary-foreground">
          <LogoMark className="size-6" />
        </span>
        <div className="max-w-md space-y-2">
          <h1 className={SHELL_TITLE_CLASS}>Something went sideways</h1>
          <p className="text-muted leading-7">
            That one's on us — it's already been reported. Try again, or write in directly if it
            keeps happening; reaching out is always welcome.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => (stale ? window.location.reload() : reset())}
            className={buttonClass()}
          >
            Try again
          </button>
          <a href={`mailto:${SUPPORT_EMAIL}`} className={buttonClass({ variant: "outline" })}>
            Email {SUPPORT_EMAIL}
          </a>
        </div>
      </body>
    </html>
  );
}
