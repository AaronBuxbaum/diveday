/**
 * The three SDK functions the browser reporter calls (`SentryBrowserSdk`), and
 * nothing else. `sentry-client.ts` reaches this module only through `import()`;
 * loading `@sentry/nextjs` itself that way handed the whole namespace to
 * `deferSentry`, so the idle chunk carried Replay and Feedback too. Static named
 * re-exports let the bundler drop the rest.
 */
export { captureException, captureRouterTransitionStart, init } from "@sentry/nextjs";
