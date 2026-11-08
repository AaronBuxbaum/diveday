/**
 * **How far React's `cache()` actually reaches**, measured rather than assumed
 * (issue #1737). Run by `src/db/shop-by-slug-cache.test.ts`, which is where the
 * reasoning for each scenario lives; this file is only the harness.
 *
 * It has to be a separate process. React ships two builds of itself and only
 * the `react-server` one memoizes at all — the client build's `cache()` is a
 * passthrough that calls straight through to the reader, which is what Vitest
 * resolves and why this cannot be an ordinary `import`. So: `node --conditions
 * react-server`, React's own Flight server, and a reader that counts its calls.
 *
 * Prints one JSON line, `{ scenario: count }`, and nothing else.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * The Flight server, from whichever bundler's copy this Next carries. Both are
 * React's own `react-server-dom-*` package, vendored; `server.edge` is the
 * entry Next itself renders Server Components with. Deliberately not skipped
 * when neither resolves — a proof that quietly stops running is worse than one
 * that fails loudly, and the fix is a one-line path, not a deleted test.
 */
function flightServer() {
  const candidates = [
    "next/dist/compiled/react-server-dom-webpack/server.edge",
    "next/dist/compiled/react-server-dom-turbopack/server.edge",
  ];
  const tried = [];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      tried.push(`${candidate}: ${error?.message ?? error}`);
    }
  }
  throw new Error(
    `no vendored React Flight server resolved, so the cache scope cannot be measured.\n${tried.join("\n")}`,
  );
}

const flight = flightServer();
const React = require("react");
const { cache, createElement: h, Suspense } = React;

let reads = [];

/** Stands in for `shopBySlugCached`: one argument, memoized, counts its reads. */
const readShop = cache(async (slug) => {
  reads.push(slug);
  return { slug };
});

/** An async Server Component that needs the shop row, like all three real ones. */
function needsShop(name) {
  return async function NeedsShop({ slug }) {
    const shop = await readShop(slug);
    return h("p", null, `${name}:${shop.slug}`);
  };
}

const Brand = needsShop("brand");
const Chrome = needsShop("chrome");
const Footer = needsShop("footer");
const Metadata = needsShop("metadata");
const Body = needsShop("body");

/** One render pass — one Flight request, which is one cache scope. */
async function renderPass(element) {
  await new Response(flight.renderToReadableStream(element, {})).text();
}

/**
 * `src/app/s/[shopSlug]/layout.tsx`, in shape: a synchronous function, three
 * async children each inside its own `<Suspense>`, and `{children}` sitting
 * between the second and the third with no boundary it could hide behind.
 */
function shellPass(slug) {
  return h(
    "div",
    null,
    h(Suspense, { fallback: null }, h(Brand, { slug })),
    h(Suspense, { fallback: null }, h(Chrome, { slug })),
    h("main", null, h("p", null, "the page")),
    h(Suspense, { fallback: null }, h(Footer, { slug })),
  );
}

async function measure(run) {
  reads = [];
  await run();
  return reads.length;
}

const result = {
  // The layout's three boundaries, one render.
  shell: await measure(() => renderPass(shellPass("blue-mantis"))),
  // A boundary nested inside another boundary is still not a new scope.
  nested: await measure(() =>
    renderPass(
      h(
        "div",
        null,
        h(Suspense, { fallback: null }, h(Brand, { slug: "blue-mantis" })),
        h(
          Suspense,
          { fallback: null },
          h(Suspense, { fallback: null }, h(Footer, { slug: "blue-mantis" })),
        ),
      ),
    ),
  ),
  // `generateMetadata` and the page body, which Next runs in the page's pass.
  page: await measure(async () => {
    await renderPass(
      h(
        "div",
        null,
        h(Suspense, { fallback: null }, h(Metadata, { slug: "blue-mantis" })),
        h(Suspense, { fallback: null }, h(Body, { slug: "blue-mantis" })),
      ),
    );
  }),
  // Two passes are two scopes: this is the shell/page split, and the reason
  // nothing here can reuse a row across requests.
  twoPasses: await measure(async () => {
    await renderPass(shellPass("blue-mantis"));
    await renderPass(h(Suspense, { fallback: null }, h(Body, { slug: "blue-mantis" })));
  }),
  // Keyed on the slug, so one render of two storefronts reads two rows.
  twoSlugs: await measure(() =>
    renderPass(
      h(
        "div",
        null,
        h(Suspense, { fallback: null }, h(Brand, { slug: "blue-mantis" })),
        h(Suspense, { fallback: null }, h(Chrome, { slug: "coral-key" })),
      ),
    ),
  ),
};

process.stdout.write(JSON.stringify(result));
