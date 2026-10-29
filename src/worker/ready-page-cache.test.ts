// The default `node` environment, as the worker's own test: this module runs
// in a service worker, never in a DOM context.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  READY_CACHE_NAME,
  READY_COPY_GENERATED_AT_ATTR,
  READY_COPY_GENERATED_AT_META,
  READY_COPY_LOCALE_META,
  READY_COPY_TIME_ZONE_META,
  READY_COPY_VERSION,
  READY_COPY_VERSION_META,
  READY_FORGOTTEN_CACHE_NAME,
  READY_KEEP_UNTIL_META,
  READY_OFFLINE_GENERATED_AT_PLACEHOLDER,
  READY_OFFLINE_NOTE_ATTR,
} from "@/lib/ready-offline";
import {
  beginReadyPageRequest,
  forgetReadyPage,
  isReadyScope,
  READY_COPY_KEY,
  READY_COPY_MAX_AGE_MS,
  readyPageFallback,
  readyPagePath,
  readyPageStylesheets,
  saveReadyPage,
} from "./ready-page-cache";

const ORIGIN = "https://dive.day";
const TOKEN = "A".repeat(43);
const OTHER = "B".repeat(43);
const NOW = 1_800_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A Cache Storage with just the surface the module uses, keyed by path. */
function fakeStorage() {
  const caches = new Map<string, Map<string, Response>>();
  const pathOf = (key: string | Request) =>
    new URL(typeof key === "string" ? key : key.url, ORIGIN).pathname;
  const storage = {
    delete: async (name: string) => caches.delete(name),
    open: async (name: string) => {
      const entries = caches.get(name) ?? new Map<string, Response>();
      caches.set(name, entries);
      return {
        keys: async () => [...entries.keys()].map((path) => new Request(`${ORIGIN}${path}`)),
        delete: async (key: string | Request) => entries.delete(pathOf(key)),
        put: async (key: string | Request, response: Response) => {
          entries.set(pathOf(key), response);
        },
        match: async (key: string | Request) => entries.get(pathOf(key))?.clone(),
      };
    },
  };
  return { storage: storage as unknown as CacheStorage, caches };
}

/** A current-format response with no automatic banner, for malformed-page tests. */
function renderedPage(body: string, init: ResponseInit = {}, keepUntil = NOW + 30 * DAY_MS) {
  return new Response(
    `<meta name="${READY_KEEP_UNTIL_META}" content="${keepUntil}"/><meta name="${READY_COPY_VERSION_META}" content="${READY_COPY_VERSION}"/>${body}`,
    {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      ...init,
    },
  );
}

/** The live page as the server renders it: kept until `keepUntil` (default: well past NOW). */
function page(body = "<p>Ready</p>", init: ResponseInit = {}, keepUntil = NOW + 30 * DAY_MS) {
  const generatedAt = body.includes(`name="${READY_COPY_GENERATED_AT_META}"`)
    ? ""
    : `<meta name="${READY_COPY_GENERATED_AT_META}" content="${NOW}"/>`;
  const withBanner = body.includes(`${READY_OFFLINE_NOTE_ATTR}=""`)
    ? `${generatedAt}${body}`
    : `<meta name="${READY_COPY_LOCALE_META}" content="en-US"/><meta name="${READY_COPY_TIME_ZONE_META}" content="America/New_York"/>${generatedAt}${body}<p ${READY_OFFLINE_NOTE_ATTR}="" hidden="">No signal: ${READY_OFFLINE_GENERATED_AT_PLACEHOLDER}</p>`;
  return renderedPage(withBanner, init, keepUntil);
}

describe("readyPagePath", () => {
  it("answers a readiness link on this origin and nothing else", () => {
    expect(readyPagePath(new URL(`${ORIGIN}/ready/${TOKEN}`), ORIGIN)).toBe(`/ready/${TOKEN}`);
    expect(readyPagePath(new URL(`${ORIGIN}/ready/${TOKEN}?saved=seat`), ORIGIN)).toBe(
      `/ready/${TOKEN}`,
    );
    expect(readyPagePath(new URL(`https://evil.example/ready/${TOKEN}`), ORIGIN)).toBeNull();
    expect(readyPagePath(new URL(`${ORIGIN}/ready/${TOKEN}/forms`), ORIGIN)).toBeNull();
    expect(readyPagePath(new URL(`${ORIGIN}/ready/short`), ORIGIN)).toBeNull();
    expect(readyPagePath(new URL(`${ORIGIN}/shop/blue-mantis`), ORIGIN)).toBeNull();
  });
});

describe("isReadyScope", () => {
  it("is the diver's registration only", () => {
    expect(isReadyScope(`${ORIGIN}/ready/`)).toBe(true);
    expect(isReadyScope(`${ORIGIN}/`)).toBe(false);
    expect(isReadyScope(undefined)).toBe(false);
  });
});

describe("saveReadyPage and readyPageFallback", () => {
  let store: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    store = fakeStorage();
  });

  it("keeps one copy, the last page rendered, and serves it by its own path", async () => {
    expect(await saveReadyPage(store.storage, `/ready/${OTHER}`, page("older"), NOW)).toBe(true);
    expect(await saveReadyPage(store.storage, `/ready/${TOKEN}`, page("newer"), NOW)).toBe(true);
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(1);

    const served = await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW + 1000);
    expect(await served?.text()).toContain("newer");
    expect(await readyPageFallback(store.storage, `/ready/${OTHER}`, NOW)).toBeUndefined();
  });

  it("shows the server page-generation time in the page locale and shop zone, not device save or fallback time", async () => {
    const locale = "en-US";
    const timeZone = "America/New_York";
    const body = [
      `<meta name="${READY_COPY_LOCALE_META}" content="${locale}"/>`,
      `<meta name="${READY_COPY_TIME_ZONE_META}" content="${timeZone}"/>`,
      `<meta name="${READY_COPY_GENERATED_AT_META}" content="${NOW}"/>`,
      `<p ${READY_OFFLINE_NOTE_ATTR}="" hidden="">Saved ${READY_OFFLINE_GENERATED_AT_PLACEHOLDER}</p>`,
    ].join("");
    const request = await beginReadyPageRequest(store.storage, `/ready/${TOKEN}`);
    expect(await saveReadyPage(store.storage, `/ready/${TOKEN}`, page(body), NOW, request)).toBe(
      true,
    );

    const served = await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW + DAY_MS);
    const text = await served?.text();
    const expected = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone,
    }).format(new Date(NOW));
    expect(text?.replaceAll("\u00a0", " ")).toContain(`Saved ${expected}`);
    expect(text).not.toContain(READY_OFFLINE_GENERATED_AT_PLACEHOLDER);
    expect(text).toMatch(
      new RegExp(`${READY_OFFLINE_NOTE_ATTR}=""[^>]*${READY_COPY_GENERATED_AT_ATTR}="${NOW}"`),
    );
  });

  it("does not make a replayed server page look newer using the device clock", async () => {
    const deviceSaveAt = NOW + 40 * 60_000;
    expect(
      await saveReadyPage(store.storage, `/ready/${TOKEN}`, page("replayed page"), deviceSaveAt),
    ).toBe(true);
    const text = await (
      await readyPageFallback(store.storage, `/ready/${TOKEN}`, deviceSaveAt)
    )?.text();
    const serverLabel = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone: "America/New_York",
    }).format(new Date(NOW));
    expect(text?.replaceAll("\u00a0", " ")).toContain(`No signal: ${serverLabel}`);
    expect(text).toContain(`${READY_COPY_GENERATED_AT_ATTR}="${NOW}"`);
    expect(text).not.toContain(`${READY_COPY_GENERATED_AT_ATTR}="${deviceSaveAt}"`);
  });

  it.each([
    ["missing generation metadata", ""],
    [
      "duplicate generation metadata",
      `<meta name="${READY_COPY_GENERATED_AT_META}" content="${NOW}"/>`,
    ],
  ])("does not save a response with %s", async (_label, extraMetadata) => {
    const generationMeta = `<meta name="${READY_COPY_GENERATED_AT_META}" content="${NOW}"/>`;
    const body = [
      `<meta name="${READY_COPY_LOCALE_META}" content="en-US"/>`,
      `<meta name="${READY_COPY_TIME_ZONE_META}" content="America/New_York"/>`,
      extraMetadata === "" ? "" : generationMeta,
      extraMetadata,
      `<p ${READY_OFFLINE_NOTE_ATTR}="" hidden="">${READY_OFFLINE_GENERATED_AT_PLACEHOLDER}</p>`,
    ].join("");
    expect(await saveReadyPage(store.storage, `/ready/${TOKEN}`, renderedPage(body), NOW)).toBe(
      false,
    );
    expect(store.caches.get(READY_CACHE_NAME)?.size ?? 0).toBe(0);
  });

  it.each([
    [
      "English",
      "No signal: this is the copy your phone saved. Anything you change here needs signal.",
      "No signal: this is the copy your phone saved. Save time unavailable; later changes may be missing. Anything you change here needs signal.",
    ],
    [
      "Spanish",
      "Sin cobertura: esta es la copia que guardó tu teléfono. Para cambiar algo aquí necesitas cobertura.",
      "Sin cobertura: esta es la copia que guardó tu teléfono. No se conoce la hora de guardado; puede que falten cambios posteriores. Para cambiar algo aquí necesitas cobertura.",
    ],
  ])(
    "transforms the exact historical %s banner without inventing a time",
    async (_locale, oldNote, warning) => {
      await saveReadyPage(store.storage, `/ready/${TOKEN}`, page("current copy"), NOW);
      const cache = await store.storage.open(READY_CACHE_NAME);
      const previous = await cache.match(READY_COPY_KEY);
      expect(previous).toBeDefined();
      await cache.put(
        READY_COPY_KEY,
        new Response(
          `<meta name="${READY_KEEP_UNTIL_META}" content="${NOW + 30 * DAY_MS}"/><p ${READY_OFFLINE_NOTE_ATTR}="">${oldNote}</p><a href="/ready/__diveday_kept_token__">Return</a>`,
          { headers: previous?.headers },
        ),
      );

      expect(
        await readyPageFallback(store.storage, `/ready/${OTHER}`, NOW + 1_000),
      ).toBeUndefined();
      expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(1);
      const served = await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW + 1_000);
      const text = await served?.text();
      expect(text).toContain(warning);
      expect(text).not.toContain("__diveday_ready_saved_at__");
      expect(text).not.toContain(READY_COPY_GENERATED_AT_ATTR);
      expect(text).toContain(`/ready/${TOKEN}`);
      expect(text).not.toContain("__diveday_kept_token__");
      expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(1);
    },
  );

  it.each([
    ["unknown text", `<p ${READY_OFFLINE_NOTE_ATTR}="">Unrecognized older banner</p>`],
    [
      "malformed markup",
      `<p ${READY_OFFLINE_NOTE_ATTR}="">No signal: this is the copy your phone saved. Anything you change here needs signal.`,
    ],
    [
      "duplicate banners",
      `<p ${READY_OFFLINE_NOTE_ATTR}="">No signal: this is the copy your phone saved. Anything you change here needs signal.</p><p ${READY_OFFLINE_NOTE_ATTR}="">No signal: this is the copy your phone saved. Anything you change here needs signal.</p>`,
    ],
    ["missing banner", "<p>Old saved page without a recognized banner</p>"],
  ])(
    "fails closed for a matching path with %s, without deleting on a wrong-path probe",
    async (_case, body) => {
      await saveReadyPage(store.storage, `/ready/${TOKEN}`, page("current copy"), NOW);
      const cache = await store.storage.open(READY_CACHE_NAME);
      const previous = await cache.match(READY_COPY_KEY);
      expect(previous).toBeDefined();
      await cache.put(READY_COPY_KEY, new Response(body, { headers: previous?.headers }));

      expect(
        await readyPageFallback(store.storage, `/ready/${OTHER}`, NOW + 1_000),
      ).toBeUndefined();
      expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(1);
      expect(
        await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW + 1_000),
      ).toBeUndefined();
      expect(store.caches.get(READY_CACHE_NAME)?.size ?? 0).toBe(0);
    },
  );

  it.each([
    ["locale", `name="${READY_COPY_TIME_ZONE_META}" content="America/New_York"`],
    ["shop time zone", `name="${READY_COPY_LOCALE_META}" content="es-ES"`],
    ["valid locale", `name="${READY_COPY_LOCALE_META}" content="not-a-locale"`],
    ["valid shop time zone", `name="${READY_COPY_TIME_ZONE_META}" content="Not/AZone"`],
  ])("does not save a timestamped copy without a usable %s", async (_label, metadata) => {
    const body = `${metadata}<p ${READY_OFFLINE_NOTE_ATTR}="" hidden="">${READY_OFFLINE_GENERATED_AT_PLACEHOLDER}</p>`;
    expect(await saveReadyPage(store.storage, `/ready/${TOKEN}`, page(body), NOW)).toBe(false);
    expect(store.caches.get(READY_CACHE_NAME)?.size ?? 0).toBe(0);
  });

  it.each([
    ["missing", `<p>Unmarked page content</p>`],
    [
      "duplicate",
      `<p ${READY_OFFLINE_NOTE_ATTR}="" hidden="">${READY_OFFLINE_GENERATED_AT_PLACEHOLDER}</p><p ${READY_OFFLINE_NOTE_ATTR}="" hidden="">${READY_OFFLINE_GENERATED_AT_PLACEHOLDER}</p>`,
    ],
    [
      "malformed duplicate",
      `<p ${READY_OFFLINE_NOTE_ATTR}="" hidden="">${READY_OFFLINE_GENERATED_AT_PLACEHOLDER}</p><p ${READY_OFFLINE_NOTE_ATTR}="" hidden="">unfinished`,
    ],
    [
      "malformed",
      `<p ${READY_OFFLINE_NOTE_ATTR}="" hidden="">${READY_OFFLINE_GENERATED_AT_PLACEHOLDER}<strong>nested markup</strong></p>`,
    ],
  ])("does not save a current-format response with a %s offline banner", async (_case, banner) => {
    const body = [
      `<meta name="${READY_COPY_LOCALE_META}" content="en-US"/>`,
      `<meta name="${READY_COPY_TIME_ZONE_META}" content="America/New_York"/>`,
      `<meta name="${READY_COPY_GENERATED_AT_META}" content="${NOW}"/>`,
      banner,
    ].join("");
    expect(await saveReadyPage(store.storage, `/ready/${TOKEN}`, renderedPage(body), NOW)).toBe(
      false,
    );
    expect(store.caches.get(READY_CACHE_NAME)?.size ?? 0).toBe(0);
  });

  it.each([
    ["missing", (html: string, banner: string) => html.replace(banner, "")],
    ["duplicate", (html: string, banner: string) => html.replace(banner, `${banner}${banner}`)],
    [
      "malformed duplicate",
      (html: string, banner: string) =>
        html.replace(banner, `${banner}<p ${READY_OFFLINE_NOTE_ATTR}="">unfinished`),
    ],
    [
      "malformed",
      (html: string, banner: string) =>
        html.replace(banner, banner.replace("<p", "<div").replace("</p>", "</div>")),
    ],
    [
      "wrong save time",
      (html: string) =>
        html.replace(
          new RegExp(`${READY_COPY_GENERATED_AT_ATTR}="\\d+"`),
          `${READY_COPY_GENERATED_AT_ATTR}="${NOW - DAY_MS}"`,
        ),
    ],
    [
      "missing time zone",
      (html: string) => html.replace(/<meta name="diveday-ready-copy-time-zone"[^>]*>/, ""),
    ],
    [
      "missing generation time",
      (html: string) => html.replace(/<meta name="diveday-ready-copy-generated-at"[^>]*>/, ""),
    ],
    [
      "duplicate generation time",
      (html: string) =>
        html.replace(/(<meta name="diveday-ready-copy-generated-at"[^>]*>)/, "$1$1"),
    ],
  ])(
    "deletes a matching-path current copy with a %s banner, never on wrong-path lookup",
    async (_case, alter) => {
      await saveReadyPage(store.storage, `/ready/${TOKEN}`, page("current"), NOW);
      const cache = await store.storage.open(READY_CACHE_NAME);
      const previous = await cache.match(READY_COPY_KEY);
      expect(previous).toBeDefined();
      const html = await previous?.text();
      const banner = html?.match(/<p\b[^>]*data-ready-offline-note=""[^>]*>[^<>]*<\/p>/)?.[0];
      expect(html).toBeDefined();
      expect(banner).toBeDefined();
      await cache.put(
        READY_COPY_KEY,
        new Response(alter(html ?? "", banner ?? ""), { headers: previous?.headers }),
      );

      expect(
        await readyPageFallback(store.storage, `/ready/${OTHER}`, NOW + 1_000),
      ).toBeUndefined();
      expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(1);
      expect(
        await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW + 1_000),
      ).toBeUndefined();
      expect(store.caches.get(READY_CACHE_NAME)?.size ?? 0).toBe(0);
    },
  );

  it("formats Spanish server generation times in the shop zone", async () => {
    const locale = "es-ES";
    const timeZone = "Pacific/Auckland";
    const body = [
      `<meta name="${READY_COPY_LOCALE_META}" content="${locale}"/>`,
      `<meta name="${READY_COPY_TIME_ZONE_META}" content="${timeZone}"/>`,
      `<meta name="${READY_COPY_GENERATED_AT_META}" content="${NOW}"/>`,
      `<p ${READY_OFFLINE_NOTE_ATTR}="" hidden="">Sin cobertura: ${READY_OFFLINE_GENERATED_AT_PLACEHOLDER}</p>`,
    ].join("");
    expect(await saveReadyPage(store.storage, `/ready/${TOKEN}`, page(body), NOW)).toBe(true);
    const text = await (await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW))?.text();
    const expected = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone,
    }).format(new Date(NOW));
    expect(text?.replaceAll("\u00a0", " ")).toContain(`Sin cobertura: ${expected}`);
  });

  /**
   * Two saves of the same page overlap (the navigation's and the page's own
   * keep request). A reload with no signal that lands between them must still
   * find a copy, so a save replaces the copy and never empties the cache first.
   */
  it("never leaves the cache without a copy while it replaces one", async () => {
    expect(await saveReadyPage(store.storage, `/ready/${TOKEN}`, page("first"), NOW)).toBe(true);
    const entries = store.caches.get(READY_CACHE_NAME);
    const sizes: number[] = [];
    const open = store.storage.open.bind(store.storage);
    const watched = {
      open: async (name: string) => {
        const cache = await open(name);
        return {
          ...cache,
          delete: async (key: RequestInfo | URL) => {
            const deleted = await cache.delete(key);
            sizes.push(entries?.size ?? 0);
            return deleted;
          },
        };
      },
    } as unknown as CacheStorage;
    expect(await saveReadyPage(watched, `/ready/${TOKEN}`, page("second"), NOW)).toBe(true);
    expect(sizes).not.toContain(0);
    const served = await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW);
    expect(await served?.text()).toContain("second");
  });

  /**
   * Security review of layer 8, D1: Cache Storage is origin-wide, so any
   * same-origin script can list its keys. The copy is filed under one fixed
   * key that carries no token, and answers a path only by its hash.
   */
  it("files the copy under a key that names no token", async () => {
    await saveReadyPage(store.storage, `/ready/${TOKEN}`, page(), NOW);
    const keys = [...(store.caches.get(READY_CACHE_NAME)?.keys() ?? [])];
    expect(keys).toHaveLength(1);
    expect(keys.join(" ")).not.toContain(TOKEN);
    const kept = store.caches.get(READY_CACHE_NAME)?.values().next().value;
    expect([...(kept?.headers.values() ?? [])].join(" ")).not.toContain(TOKEN);
  });

  /** The page's own links carry the token; the stored body must not (D1, residual). */
  it("keeps a body that names the token only with the placeholder, and puts the token back", async () => {
    const body = `<a href="/ready/${TOKEN}/forms">Forms</a><p>${TOKEN}</p>`;
    await saveReadyPage(store.storage, `/ready/${TOKEN}`, page(body), NOW);

    const kept = store.caches.get(READY_CACHE_NAME)?.values().next().value;
    const stored = await kept?.clone().text();
    expect(stored).not.toContain(TOKEN);
    expect(stored).toContain("__diveday_kept_token__");

    const served = await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW + 1000);
    const text = await served?.text();
    expect(text).toContain(`href="/ready/${TOKEN}/forms"`);
    expect(text).toContain(`<p>${TOKEN}</p>`);
    expect(text).not.toContain("__diveday_kept_token__");
    expect(await readyPageFallback(store.storage, `/ready/${OTHER}`, NOW + 1000)).toBeUndefined();
  });

  /** A party seat's claim link is a second bearer token; the copy keeps none of it. */
  it("keeps no party claim token in the stored body", async () => {
    const claim = "C".repeat(43);
    const body = `<a href="/claim/${claim}">Seat</a><input value="https://dive.day/claim/${claim}"/>`;
    await saveReadyPage(store.storage, `/ready/${TOKEN}`, page(body), NOW);

    const kept = store.caches.get(READY_CACHE_NAME)?.values().next().value;
    const stored = await kept?.clone().text();
    expect(stored).not.toContain(claim);
    expect(stored).toContain("/claim/__diveday_claim_not_kept__");

    const served = await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW + 1000);
    expect(await served?.text()).not.toContain(claim);
  });

  /**
   * **No way to pay, and no other link's capability, in the kept copy** (issue
   * #2693). A pending tip's Stripe checkout link opens a live checkout, and a
   * bound server action carries its bound arguments in the page twice: as the
   * form's `$ACTION_*` hidden fields and in the inline Flight payload. On the
   * after-state those arguments are a recap token, a second bearer credential
   * this copy has no business holding.
   */
  it("keeps no checkout link and no bound action payload", async () => {
    const recapToken = `cmVjYXA6${"r".repeat(70)}.${"S".repeat(43)}`;
    const body = [
      `<a href="https://checkout.stripe.com/c/pay/cs_test_a1B2c3#fidkdWxOYHwn">Finish your tip</a>`,
      `<form action="" method="POST" enctype="multipart/form-data">`,
      `<input type="hidden" name="$ACTION_REF_«R1»"/>`,
      `<input type="hidden" name="$ACTION_«R1»:0" value="{&quot;id&quot;:&quot;7f00aa&quot;,&quot;bound&quot;:&quot;$@1&quot;}"/>`,
      `<input type="hidden" name="$ACTION_«R1»:1" value="[&quot;${recapToken}&quot;]"/>`,
      `<input type="hidden" name="$ACTION_KEY" value="k1234"/>`,
      `<input type="hidden" name="photoId" value="5b1d7e2a"/>`,
      `</form>`,
      // The Flight payload is a JS string of JSON: its quotes arrive escaped.
      String.raw`<script>self.__next_f.push([1,"5:{\"id\":\"7f00aa\",\"bound\":\"$@6\"}\n6:[\"` +
        recapToken +
        String.raw`\"]\n7:[\"$\",\"a\",null,{\"href\":\"https://checkout.stripe.com/c/pay/cs_test_a1B2c3\"}]\n"])</script>`,
    ].join("");
    await saveReadyPage(store.storage, `/ready/${TOKEN}`, page(body), NOW);

    const kept = store.caches.get(READY_CACHE_NAME)?.values().next().value;
    const stored = (await kept?.clone().text()) ?? "";
    expect(stored).toContain("Finish your tip");
    expect(stored).not.toContain("checkout.stripe.com");
    expect(stored).not.toContain("$ACTION_");
    expect(stored).not.toContain(recapToken);
    // A form's own hidden fields are the page, not a capability.
    expect(stored).toContain(`name="photoId" value="5b1d7e2a"`);

    const served =
      (await (await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW))?.text()) ?? "";
    expect(served).not.toContain("checkout.stripe.com");
    expect(served).not.toContain(recapToken);
  });

  /**
   * **No Flight payload in the kept copy** (issue #3003). Next writes the
   * payload as `self.__next_f.push` scripts cut at an arbitrary byte, so a
   * token straddling a cut reaches the page in two halves that no pattern
   * matches. Joining the push strings back together must find no token.
   */
  it("keeps no Flight push script, so a token split between two survives nowhere", async () => {
    const claim = "C".repeat(20) + "D".repeat(23);
    const body = [
      `<a href="/ready/${TOKEN}/forms">Forms</a>`,
      `<script>(self.__next_f=self.__next_f||[]).push([0])</script>`,
      // The payload's quotes arrive escaped (`\"`), as in the test above.
      `<script>self.__next_f.push([1,"8:[\\"$\\",\\"a\\",null,{\\"href\\":\\"/claim/${claim.slice(0, 20)}"])</script>`,
      `<script>self.__next_f.push([1,"${claim.slice(20)}\\"}]\\n"])</script>`,
      `<script src="/_next/static/chunks/main-app.js" async=""></script>`,
      // React's own streaming instruction moves a Suspense boundary's content
      // into place: the copy needs it to show anything past the skeleton.
      `<div hidden id="S:0"><p>Where to go</p></div><script>$RC("B:0","S:0")</script>`,
    ].join("");
    await saveReadyPage(store.storage, `/ready/${TOKEN}`, page(body), NOW);

    const kept = store.caches.get(READY_CACHE_NAME)?.values().next().value;
    const stored = (await kept?.clone().text()) ?? "";
    const joined = [...stored.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)]
      .map((match) => match[1])
      .join("");
    expect(`${stored}${joined}`).not.toContain(claim);
    expect(stored).not.toContain("__next_f");
    // With no payload to hydrate from, the client runtime is left out too, so
    // the copy is the server's markup as rendered rather than a failed hydration.
    expect(stored).not.toContain("main-app.js");
    expect(stored).toContain(`$RC("B:0","S:0")`);
    expect(stored).toContain("Where to go");

    const served =
      (await (await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW))?.text()) ?? "";
    expect(served).toContain(`href="/ready/${TOKEN}/forms"`);
    expect(served).not.toContain(claim);
  });

  it("drops a script whose end tag carries whitespace or junk, and one the first pass joins", async () => {
    const body = [
      `<p>Kept</p>`,
      `<script>self.__next_f.push([1,"a"])</script\t\n bar>`,
      // Removing the inner element joins the outer one's halves into a script.
      `<scr<script src="/x.js"></script>ipt>self.__next_f.push([1,"b"])</script>`,
    ].join("");
    await saveReadyPage(store.storage, `/ready/${TOKEN}`, page(body), NOW);

    const kept = store.caches.get(READY_CACHE_NAME)?.values().next().value;
    const stored = (await kept?.clone().text()) ?? "";
    expect(stored).not.toContain("__next_f");
    expect(stored).not.toContain("x.js");
    expect(stored).toContain("<p>Kept</p>");
  });

  /**
   * D2: a copy does not outlive the trip it is for (the page names the day
   * after the boat is due back), and a page that names no day (a cancelled
   * booking, a dead link) clears it rather than replacing it.
   */
  it("stops serving the copy the moment the page said, and keeps none the page did not ask for", async () => {
    const path = `/ready/${TOKEN}`;
    await saveReadyPage(store.storage, path, page("x", {}, NOW + 1000), NOW);
    expect(await readyPageFallback(store.storage, path, NOW + 999)).toBeDefined();
    expect(await readyPageFallback(store.storage, path, NOW + 1001)).toBeUndefined();
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(0);

    await saveReadyPage(store.storage, path, page(), NOW);
    expect(
      await saveReadyPage(
        store.storage,
        path,
        new Response("<p>Cancelled</p>", {
          headers: { "content-type": "text/html" },
        }),
        NOW,
      ),
    ).toBe(false);
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(0);
    expect(await saveReadyPage(store.storage, path, page("x", {}, NOW - 1), NOW)).toBe(false);
  });

  it("forgets the copy for a path, and only that path's", async () => {
    await saveReadyPage(store.storage, `/ready/${TOKEN}`, page(), NOW);
    await forgetReadyPage(store.storage, `/ready/${OTHER}`, NOW);
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(1);
    await forgetReadyPage(store.storage, `/ready/${TOKEN}`, NOW);
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(0);
  });

  it("keeps cancellation ordering in one bounded storage record across many paths", async () => {
    for (let index = 0; index < 20; index += 1) {
      await forgetReadyPage(store.storage, `/ready/${String(index).padStart(43, "A")}`, NOW);
    }
    expect(store.caches.get(READY_FORGOTTEN_CACHE_NAME)?.size).toBe(1);
  });

  /**
   * Security review 2026-10-24 (#2979, finding 2): on a slow link a keep
   * request's fetch can start before the cancel and answer after it. What it
   * brings back is the pre-cancel page, and it must not revive the copy.
   */
  it("stores nothing from a fetch that began before the path was forgotten", async () => {
    const path = `/ready/${TOKEN}`;
    const staleRequest = await beginReadyPageRequest(store.storage, path);
    await forgetReadyPage(store.storage, path, NOW + 10);
    expect(await saveReadyPage(store.storage, path, page("stale"), NOW + 20, staleRequest)).toBe(
      false,
    );
    expect(store.caches.get(READY_CACHE_NAME)?.size ?? 0).toBe(0);
    // A load asked for after the forget is kept as ever, and another path is untouched.
    const freshRequest = await beginReadyPageRequest(store.storage, path);
    expect(await saveReadyPage(store.storage, path, page("fresh"), NOW + 20, freshRequest)).toBe(
      true,
    );
    const otherRequest = await beginReadyPageRequest(store.storage, `/ready/${OTHER}`);
    expect(
      await saveReadyPage(store.storage, `/ready/${OTHER}`, page("other"), NOW + 20, otherRequest),
    ).toBe(true);
  });

  it("keeps the cancellation epoch across worker restart when the device clock moves backward", async () => {
    const path = `/ready/${TOKEN}`;
    const request = await beginReadyPageRequest(store.storage, path);
    const cancellationObserved = NOW - 10;
    await forgetReadyPage(store.storage, path, cancellationObserved);
    vi.resetModules();
    const restarted = await import("./ready-page-cache");

    expect(
      await restarted.saveReadyPage(
        store.storage,
        path,
        page("pre-cancel page"),
        NOW + 20,
        request,
      ),
    ).toBe(false);
    expect(await restarted.readyPageFallback(store.storage, path, NOW + 20)).toBeUndefined();
  });

  it("lets only the newest overlapping request publish, even after a worker restart", async () => {
    const path = `/ready/${TOKEN}`;
    const older = await beginReadyPageRequest(store.storage, path);
    const newer = await beginReadyPageRequest(store.storage, path);

    expect(await saveReadyPage(store.storage, path, page("newer response"), NOW, newer)).toBe(true);
    expect(await saveReadyPage(store.storage, path, page("older response"), NOW, older)).toBe(
      false,
    );
    expect(await (await readyPageFallback(store.storage, path, NOW))?.text()).toContain(
      "newer response",
    );
  });

  it("drops the copy a save put down when the forget lands while it was storing", async () => {
    const path = `/ready/${TOKEN}`;
    const request = await beginReadyPageRequest(store.storage, path);
    const open = store.storage.open.bind(store.storage);
    let forgot = false;
    let forgetting: Promise<boolean> | undefined;
    const racing = {
      delete: store.storage.delete.bind(store.storage),
      open: async (name: string) => {
        const cache = await open(name);
        return {
          ...cache,
          put: async (key: RequestInfo | URL, response: Response) => {
            await cache.put(key as string, response);
            if (!forgot && name === READY_CACHE_NAME) {
              forgot = true;
              forgetting = forgetReadyPage(store.storage, path, NOW + 10);
            }
          },
        };
      },
    } as unknown as CacheStorage;
    expect(await saveReadyPage(racing, path, page("stale"), NOW + 20, request)).toBe(false);
    expect(await forgetting).toBe(true);
    expect(store.caches.get(READY_CACHE_NAME)?.size ?? 0).toBe(0);
  });

  it("removes a stale copy when cancellation lands after validation but before the write completes", async () => {
    const path = `/ready/${TOKEN}`;
    const request = await beginReadyPageRequest(store.storage, path);
    const open = store.storage.open.bind(store.storage);
    let enteredPut: (() => void) | undefined;
    let releasePut: (() => void) | undefined;
    const putEntered = new Promise<void>((resolve) => {
      enteredPut = resolve;
    });
    const putGate = new Promise<void>((resolve) => {
      releasePut = resolve;
    });
    const racing = {
      delete: store.storage.delete.bind(store.storage),
      open: async (name: string) => {
        const cache = await open(name);
        return {
          ...cache,
          put: async (key: RequestInfo | URL, response: Response) => {
            if (name === READY_CACHE_NAME) {
              enteredPut?.();
              await putGate;
            }
            await cache.put(key as string, response);
          },
        };
      },
    } as unknown as CacheStorage;
    const saving = saveReadyPage(racing, path, page("pre-cancel page"), NOW, request);

    await putEntered;
    const forgetting = forgetReadyPage(store.storage, path, NOW - 10);
    releasePut?.();

    expect(await saving).toBe(false);
    expect(await forgetting).toBe(true);
    expect(store.caches.get(READY_CACHE_NAME)?.size ?? 0).toBe(0);
  });

  /** Finding 3: a forget that cannot read the copy takes the whole cache rather than none of it. */
  it("deletes the whole copy cache when the forget itself fails", async () => {
    await saveReadyPage(store.storage, `/ready/${TOKEN}`, page(), NOW);
    const broken = {
      delete: store.storage.delete.bind(store.storage),
      open: async () => {
        throw new Error("storage gone");
      },
    } as unknown as CacheStorage;
    await forgetReadyPage(broken, `/ready/${TOKEN}`, NOW);
    expect(store.caches.has(READY_CACHE_NAME)).toBe(false);
  });

  it("does not acknowledge a failed epoch write or let an in-flight save republish", async () => {
    const path = `/ready/${TOKEN}`;
    const pendingRequest = beginReadyPageRequest(store.storage, path);
    const broken = {
      delete: store.storage.delete.bind(store.storage),
      open: async (name: string) => {
        const cache = await store.storage.open(name);
        if (name !== READY_FORGOTTEN_CACHE_NAME) return cache;
        return {
          ...cache,
          put: async () => {
            throw new Error("quota exceeded");
          },
        };
      },
    } as unknown as CacheStorage;

    const forgetting = forgetReadyPage(broken, path, NOW);
    const request = await pendingRequest;
    expect(await forgetting).toBe(false);
    expect(
      await saveReadyPage(store.storage, path, page("pre-forget response"), NOW, request),
    ).toBe(false);
    expect(store.caches.get(READY_CACHE_NAME)?.size ?? 0).toBe(0);

    // A later request durably replaces the old request ID even though the
    // dedicated forget attempt failed; after restart, the old response stays stale.
    await beginReadyPageRequest(store.storage, path);
    vi.resetModules();
    const restarted = await import("./ready-page-cache");
    expect(
      await restarted.saveReadyPage(store.storage, path, page("pre-forget response"), NOW, request),
    ).toBe(false);
  });

  it("keeps nothing that is not the page itself", async () => {
    const path = `/ready/${TOKEN}`;
    expect(await saveReadyPage(store.storage, path, page("x", { status: 404 }), NOW)).toBe(false);
    expect(
      await saveReadyPage(
        store.storage,
        path,
        new Response("{}", { headers: { "content-type": "application/json" } }),
        NOW,
      ),
    ).toBe(false);
    const redirected = page();
    Object.defineProperty(redirected, "redirected", { value: true });
    expect(await saveReadyPage(store.storage, path, redirected, NOW)).toBe(false);
    const opaque = page();
    Object.defineProperty(opaque, "type", { value: "opaque" });
    expect(await saveReadyPage(store.storage, path, opaque, NOW)).toBe(false);
    expect(await readyPageFallback(store.storage, path, NOW)).toBeUndefined();
  });

  it("deletes a copy older than two weeks rather than serving it", async () => {
    const path = `/ready/${TOKEN}`;
    await saveReadyPage(store.storage, path, page(), NOW);
    expect(await readyPageFallback(store.storage, path, NOW + READY_COPY_MAX_AGE_MS + 1)).toBe(
      undefined,
    );
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(0);
  });
});

describe("readyPageStylesheets", () => {
  it("finds the page's own stylesheets and nobody else's", () => {
    const html = `<link rel="stylesheet" href="/_next/static/css/app.css"/><link href="https://cdn.example/_next/static/css/x.css"/><script src="/_next/static/chunks/a.js"></script>`;
    expect(readyPageStylesheets(html, ORIGIN)).toEqual(["/_next/static/css/app.css"]);
  });
});
