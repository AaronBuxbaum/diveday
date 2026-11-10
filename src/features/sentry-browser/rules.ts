import type * as SentrySdk from "@sentry/nextjs";

/**
 * **The browser's Sentry, loaded when the page is idle** (code review
 * 2026-10-13b, item 34; ADR 20260727-sentry-error-monitoring-q7fk2p).
 *
 * `src/instrumentation-client.ts` used to `import * as Sentry` at the top, so
 * the SDK was about 55 to 60 KB of the shared first-load floor: every diver,
 * marketing and staff route downloaded and evaluated it before it painted.
 * Before the first idle moment the reporter has one job, to remember what was
 * thrown, and two listeners do that. Once the page is idle the SDK loads,
 * initialises (installing its own global handlers), and is handed the errors
 * that arrived before it, marked unhandled as its own handlers would have
 * marked them. An explicit root-boundary report starts loading immediately
 * and waits for initialization. A load that fails (an extension blocking the
 * chunk) lets the page go: a broken reporter must never break a page.
 *
 * Framework-free and handed its `window`, its loader and its idle scheduler,
 * so the test drives every step.
 */
export type SentryBrowserSdk = Pick<
  typeof SentrySdk,
  "init" | "captureException" | "captureRouterTransitionStart"
>;

type Listener = (event: unknown) => void;

/** Early errors kept for the SDK; a page throwing in a loop does not grow without end. */
const EARLY_ERROR_LIMIT = 20;

export function deferSentry<Sdk extends SentryBrowserSdk>(options: {
  load: () => Promise<Sdk>;
  init: (sdk: Sdk) => void;
  target: {
    addEventListener: (type: string, listener: Listener) => void;
    removeEventListener: (type: string, listener: Listener) => void;
  };
  whenIdle: (run: () => void) => void;
}): {
  captureException: (error: unknown) => void;
  onRouterTransitionStart: (href: string, navigationType: string) => void;
} {
  const early: Array<{ error: unknown; type?: "onerror" | "onunhandledrejection" }> = [];
  const remember = (error: unknown, type: "onerror" | "onunhandledrejection") => {
    if (early.length < EARLY_ERROR_LIMIT) early.push({ error, type });
  };
  const onError: Listener = (event) => {
    const { error, message } = event as { error?: unknown; message?: unknown };
    remember(error ?? message, "onerror");
  };
  const onRejection: Listener = (event) => {
    remember((event as { reason?: unknown }).reason, "onunhandledrejection");
  };
  options.target.addEventListener("error", onError);
  options.target.addEventListener("unhandledrejection", onRejection);
  const letGo = () => {
    options.target.removeEventListener("error", onError);
    options.target.removeEventListener("unhandledrejection", onRejection);
  };

  let loaded: Sdk | undefined;
  let starting = false;
  const capture = (sdk: Sdk, error: unknown, type?: "onerror" | "onunhandledrejection") => {
    try {
      if (type) sdk.captureException(error, { mechanism: { type, handled: false } });
      else sdk.captureException(error);
    } catch {
      // A failed reporter must not break the error fallback or other reports.
    }
  };
  const start = () => {
    if (starting || loaded) return;
    starting = true;
    void Promise.resolve()
      .then(options.load)
      .then((sdk) => {
        options.init(sdk);
        letGo();
        loaded = sdk;
        for (const { error, type } of early.splice(0)) capture(sdk, error, type);
      })
      .catch(() => {
        starting = false;
        letGo();
        early.length = 0;
      });
  };
  options.whenIdle(start);

  return {
    captureException(error) {
      if (loaded) capture(loaded, error);
      else {
        // Keep the explicit root error even if a noisy page filled the buffer.
        if (early.length === EARLY_ERROR_LIMIT) early.shift();
        early.push({ error });
        start();
      }
    },
    onRouterTransitionStart(href, navigationType) {
      loaded?.captureRouterTransitionStart(href, navigationType);
    },
  };
}
