import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * The offline shell's asset list, read from the production build's own route
 * manifest instead of guessed from rendered HTML.
 *
 * Next writes, per App Router page, `server/app/<route>/page_client-reference-manifest.js`
 * with the entry chunks of the page and each layout above it (`entryJSFiles`,
 * `entryCSSFiles`) and the chunks every client component under it needs
 * (`clientModules[*].chunks`, which is where lazily imported chunks appear).
 * `build-manifest.json` adds the files every App Router page loads
 * (`rootMainFiles`). Its `polyfillFiles` are left out: that is the `noModule`
 * legacy bundle, which a browser that runs a service worker never requests, so
 * it can never be an offline miss. Webpack omits `entryJSFiles`; its own page
 * chunk comes from `clientModules`, and its reachable async imports come from
 * `react-loadable-manifest.json`. `next build` itself unions the first
 * two for its route size table (`route-bundle-stats.js`).
 *
 * `clientModules` lists only client-reference chunks. A chunk reached by
 * `import()` or `next/dynamic` inside a client module (the root layout's
 * Observability widgets, for one) is a separate async chunk group that no
 * manifest names, so the walk below follows every `static/chunks/...` path a
 * listed chunk's text mentions, transitively, to the files on disk. A chunk
 * missed here is a ChunkLoadError at sea that lands in `global-error`.
 *
 * The list is deliberately a superset of what the page's HTML names: a missed
 * chunk breaks the offline screen, and an extra one costs bytes. It is bounded
 * by one route's manifest, never the app's whole chunk graph.
 *
 * Defensive by construction: every failure is a thrown error that fails the
 * build, because a worker built from a wrong list fails on a boat, not here.
 */
export const SHELL_ROUTE = "/offline-manifest";

/** `static/chunks/x.js`, `/_next/static/chunks/x.js` or webpack's `123:static/chunks/x.js` to `/_next/static/chunks/x.js`. */
export function normalizeAsset(file) {
  if (typeof file !== "string") return null;
  const match = /(?:^|[:/])(static\/[^\s?#]+\.(?:js|css))(?:[?#].*)?$/.exec(
    file.replaceAll("\\", "/"),
  );
  return match ? `/_next/${match[1]}` : null;
}

function readRouteManifest(distDir, route) {
  const file = path.join(distDir, "server/app", route, "page_client-reference-manifest.js");
  if (!existsSync(file)) {
    throw new Error(`offline shell assets: ${file} is missing; run this after \`next build\``);
  }
  const sandbox = { globalThis: undefined };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync(file, "utf8"), sandbox, { timeout: 5_000 });
  const manifests = sandbox.__RSC_MANIFEST ?? {};
  const keys = Object.keys(manifests);
  const key = keys.find((k) => k === `${route}/page`) ?? (keys.length === 1 ? keys[0] : undefined);
  if (!key) throw new Error(`offline shell assets: no manifest entry for ${route}/page in ${file}`);
  return manifests[key];
}

/** The id `next build` wrote for this build (`generateBuildId` in next.config.ts). */
export function readBuildId(distDir) {
  const file = path.join(distDir, "BUILD_ID");
  if (!existsSync(file)) throw new Error(`offline shell assets: ${file} is missing`);
  const id = readFileSync(file, "utf8").trim();
  if (!/^[\w.-]+$/.test(id)) throw new Error(`offline shell assets: unusable build id "${id}"`);
  return id;
}

const CHUNK_MENTION = /static\/chunks\/[\w.~%@+-]+\.(?:js|css)/g;

/** Every listed chunk's `import()` targets, transitively: names it mentions that exist on disk. */
function followAsyncChunks(distDir, seeds) {
  const found = new Set(seeds);
  const queue = seeds.filter((a) => a.endsWith(".js"));
  while (queue.length > 0) {
    const asset = queue.pop();
    const text = readFileSync(
      path.join(distDir, decodeURIComponent(asset.slice("/_next/".length))),
      "utf8",
    );
    for (const mention of text.match(CHUNK_MENTION) ?? []) {
      const next = normalizeAsset(mention);
      if (!next || found.has(next)) continue;
      if (!existsSync(path.join(distDir, decodeURIComponent(next.slice("/_next/".length)))))
        continue;
      found.add(next);
      if (next.endsWith(".js")) queue.push(next);
    }
  }
  return found;
}

/** Webpack names async chunks by id; its loadable manifest connects them to source importers. */
function webpackAsyncFiles(distDir, clientModules) {
  const file = path.join(distDir, "react-loadable-manifest.json");
  if (!existsSync(file))
    throw new Error("offline shell assets: webpack react-loadable-manifest.json is missing");
  const entries = Object.entries(JSON.parse(readFileSync(file, "utf8")));
  const withoutExtension = (source) => source.replace(/\.[cm]?[jt]sx?$/, "");
  const reachable = new Set(
    Object.keys(clientModules).map((source) => withoutExtension(source.replaceAll("\\", "/"))),
  );
  const consumed = new Set();
  const files = [];
  let advanced = true;
  while (advanced) {
    advanced = false;
    for (const [key, entry] of entries) {
      if (consumed.has(key)) continue;
      const [importer, target] = key.split(" -> ");
      const source = withoutExtension(importer);
      if (
        ![...reachable].some(
          (candidate) => candidate === source || candidate.endsWith(`/src/${source}`),
        )
      )
        continue;
      consumed.add(key);
      files.push(...(entry.files ?? []));
      const local = target?.startsWith("@/")
        ? target.slice(2)
        : target?.startsWith(".")
          ? path.posix.normalize(path.posix.join(path.posix.dirname(importer), target))
          : null;
      if (local) reachable.add(withoutExtension(local));
      advanced = true;
    }
  }
  return files;
}

/** Sorted, de-duplicated `/_next/static/...` paths the offline shell needs. Throws rather than returns a thin list. */
export function collectOfflineShellAssets(distDir, route = SHELL_ROUTE) {
  const manifest = readRouteManifest(distDir, route);
  // Turbopack supplies entryJSFiles. Webpack's own page chunk lives among
  // its client-reference chunks instead; require that exact route's chunk.
  const webpack = manifest.entryJSFiles === undefined;
  const clientModules = manifest.clientModules ?? {};
  const pagePrefix = `/_next/static/chunks/app${route}/page-`;
  const entryJs = manifest.entryJSFiles ?? {
    [`${route.slice(1)}/page`]: Object.values(clientModules)
      .flatMap((module) => module?.chunks ?? [])
      .map(normalizeAsset)
      .filter((asset) => asset?.startsWith(pagePrefix) && asset.endsWith(".js")),
  };
  const pageEntry = Object.keys(entryJs).find((k) => k.endsWith(`${route.slice(1)}/page`));
  const pageFiles = (pageEntry ? entryJs[pageEntry] : []).map(normalizeAsset).filter(Boolean);
  if (pageFiles.length === 0) {
    throw new Error(
      `offline shell assets: ${route} has no page chunks in its client-reference manifest`,
    );
  }

  const buildManifest = JSON.parse(readFileSync(path.join(distDir, "build-manifest.json"), "utf8"));
  const rootFiles = (buildManifest.rootMainFiles ?? []).map(normalizeAsset).filter(Boolean);
  if (!rootFiles.some((f) => f.endsWith(".js"))) {
    throw new Error("offline shell assets: build-manifest.json lists no rootMainFiles");
  }

  const raw = [
    ...Object.values(entryJs).flat(),
    ...Object.values(manifest.entryCSSFiles ?? {})
      .flat()
      .map((f) => (typeof f === "string" ? f : f?.path)),
    ...Object.values(manifest.clientModules ?? {}).flatMap((m) => m?.chunks ?? []),
    ...(buildManifest.rootMainFiles ?? []),
    ...(webpack ? webpackAsyncFiles(distDir, clientModules) : []),
  ];
  const listed = [...new Set(raw.map(normalizeAsset).filter(Boolean))];
  for (const asset of listed) {
    const onDisk = path.join(distDir, decodeURIComponent(asset.slice("/_next/".length)));
    if (!existsSync(onDisk)) {
      throw new Error(
        `offline shell assets: ${asset} is listed by the build but not on disk (${onDisk})`,
      );
    }
  }
  const assets = [...followAsyncChunks(distDir, listed)].sort();
  if (assets.length === 0) throw new Error("offline shell assets: the list is empty");

  return assets;
}
