// The default `node` environment, as the worker's own test: this module runs
// in a service worker, never in a DOM context.
import { beforeEach, describe, expect, it } from "vitest";
import { READY_CACHE_NAME, READY_KEEP_UNTIL_META } from "@/lib/ready-offline";
import {
  forgetReadyPage,
  isReadyScope,
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

/** The live page as the server renders it: kept until `keepUntil` (default: well past NOW). */
function page(body = "<p>Ready</p>", init: ResponseInit = {}, keepUntil = NOW + 30 * DAY_MS) {
  return new Response(`<meta name="${READY_KEEP_UNTIL_META}" content="${keepUntil}"/>${body}`, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  });
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
    await forgetReadyPage(store.storage, `/ready/${OTHER}`);
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(1);
    await forgetReadyPage(store.storage, `/ready/${TOKEN}`);
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(0);
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
