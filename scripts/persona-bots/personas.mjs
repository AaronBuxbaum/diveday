/**
 * Who the weekly persona walk is, and where each of them goes (N-61).
 *
 * The fifteen personas are `docs/product/personas.md` — a standing frame for
 * evaluating UX work, distilled from the 2026-07-30 review. This file is that
 * frame turned into a route list a machine can walk, plus the probes that
 * decide, mechanically, whether a surface still holds the line the persona's
 * entry asks it to.
 *
 * **A probe is deterministic or it is not here.** No judgement, no model, no
 * "this copy feels long": every probe below answers yes or no from the DOM,
 * the response status, or axe's own rule set, so a finding is a fact a reader
 * can reproduce by opening the page. The persona doc's softer lines (does the
 * refusal state a *true* reason, is the jargon explained) stay a human's
 * reading — a bot that guessed at them would fill the triage inbox with
 * opinions, which is the exact failure the volume policy in
 * `scripts/persona-bots/findings.mjs` exists to prevent.
 *
 * Pure data and pure functions: nothing here touches a browser. `walk.spec.ts`
 * drives it and `findings.mjs` shapes what comes back, and both halves are
 * unit-tested without a network.
 */

/** The demo shop every surface below belongs to. Never a real shop. */
export const DEMO_SHOP_SLUG = "blue-mantis";

/**
 * A trip id that is well-formed and belongs to nobody — the "this departure is
 * gone" surface Tomas lands on when a link outlives its trip. The same id
 * `e2e/visual.spec.ts` photographs, so the two never diverge on what "missing"
 * looks like.
 */
const MISSING_TRIP_ID = "00000000-0000-4000-8000-000000000000";

/**
 * The only tokens the walk may put in a capability URL, and they are all dead.
 *
 * On every `CAPABILITY_ROUTE_PREFIXES` route (`src/lib/capability-urls.ts`) the
 * URL *is* the credential, and this bot publishes a screenshot of every surface
 * it finds something on plus an issue body naming each path — to a public
 * tracker and a public artifact. One capture of a real `/ready/<token>` page,
 * or one issue quoting that path, hands whoever reads it a working link.
 *
 * So the walk visits those routes only with a token that was never valid, and
 * that is what makes a redaction layer unnecessary rather than merely absent.
 * `findings.test.mjs` fails on a capability surface carrying anything not on
 * this list, so the next person to add one meets the rule instead of the
 * incident.
 */
export const DEAD_CAPABILITY_TOKENS = Object.freeze(["not-a-real-token"]);

/**
 * The fifteen personas, in the order `docs/product/personas.md` numbers them,
 * each with the surfaces its entry names under **Surfaces**.
 *
 * `as` is the staff role a surface is opened under (`src/db/dev-credentials.ts`);
 * a surface with no `as` is walked anonymously, which for a `/s/**` or public
 * route is the *point* — Nadia and Tomas never have a session.
 *
 * `refusal: true` marks a surface whose whole job is to be a refusal — a link
 * to a departure that no longer exists, a waiver token that has expired. Those
 * are asked only to *render*: under streaming, a `notFound()` reached inside a
 * segment cannot change a status line already sent, so the page answers 200
 * and logs a React 419 while saying its piece in the body. Both were measured
 * on the first dry run, and a probe that reported either would be wrong every
 * week forever. Everything else the walk visits still holds those two lines.
 */
export const PERSONAS = Object.freeze([
  {
    id: "nadia",
    number: 1,
    name: "Nadia",
    lens: "the nervous first-timer",
    surfaces: [
      { path: `/s/${DEMO_SHOP_SLUG}` },
      { path: `/s/${DEMO_SHOP_SLUG}/courses` },
      { path: `/s/${DEMO_SHOP_SLUG}/courses/open-water-diver` },
    ],
  },
  {
    id: "tomas",
    number: 2,
    name: "Tomas",
    lens: "the certified traveler on a phone",
    surfaces: [
      { path: `/s/${DEMO_SHOP_SLUG}?canDive=open_water` },
      { path: `/s/${DEMO_SHOP_SLUG}/trips/${MISSING_TRIP_ID}`, refusal: true },
      { path: "/sign-in" },
    ],
  },
  {
    id: "priya",
    number: 3,
    name: "Priya",
    lens: "the parent booking a family",
    surfaces: [{ path: `/s/${DEMO_SHOP_SLUG}/courses/discover-scuba-diving` }],
  },
  {
    id: "marco",
    number: 4,
    name: "Marco",
    lens: "the repeat local who books in ten seconds",
    surfaces: [{ path: `/s/${DEMO_SHOP_SLUG}?lens=after-dark` }],
  },
  {
    id: "ingrid",
    number: 5,
    name: "Ingrid",
    lens: "the non-native English speaker",
    // Walked in Spanish rather than in English: a key that never resolved and a
    // figure formatted for the wrong locale are both invisible in en-US.
    locale: "es-ES",
    surfaces: [
      { path: `/s/${DEMO_SHOP_SLUG}` },
      { path: `/s/${DEMO_SHOP_SLUG}/courses` },
      { path: "/pricing" },
    ],
  },
  {
    id: "rob",
    number: 6,
    name: "Rob",
    lens: "the diver the night before",
    surfaces: [{ path: `/waivers/${DEAD_CAPABILITY_TOKENS[0]}`, refusal: true }],
  },
  {
    id: "amara",
    number: 7,
    name: "Amara",
    lens: "the diver after the trip",
    surfaces: [{ path: `/s/${DEMO_SHOP_SLUG}/reviews` }],
  },
  {
    id: "dana",
    number: 8,
    name: "Dana",
    lens: "the solo owner at 6am",
    surfaces: [
      { path: `/shop/${DEMO_SHOP_SLUG}`, as: "owner" },
      { path: `/shop/${DEMO_SHOP_SLUG}/schedule/board`, as: "owner" },
    ],
  },
  {
    id: "chloe",
    number: 9,
    name: "Chloe",
    lens: "the front desk in the morning rush",
    surfaces: [
      { path: `/shop/${DEMO_SHOP_SLUG}/divers`, as: "owner" },
      { path: `/shop/${DEMO_SHOP_SLUG}/bookings/new`, as: "owner" },
    ],
  },
  {
    id: "sal",
    number: 10,
    name: "Sal",
    lens: "the captain with wet hands",
    surfaces: [{ path: "/offline-manifest" }],
  },
  {
    id: "kai",
    number: 11,
    name: "Kai",
    lens: "the day-one seasonal hire",
    // The divemaster login, deliberately: Kai is the reader with the fewest
    // permissions and the least idea where anything is, and every surface here
    // looks different to him than it does to the owner beside him. His own
    // persona line — that a refusal names the actual rule — stays a human's
    // reading: no probe can tell a good refusal from a bad one, and pointing
    // the walk at a page he cannot open would file the same finding weekly
    // forever.
    surfaces: [
      { path: `/shop/${DEMO_SHOP_SLUG}`, as: "divemaster" },
      { path: `/shop/${DEMO_SHOP_SLUG}/schedule/board`, as: "divemaster" },
    ],
  },
  {
    id: "maren",
    number: 12,
    name: "Maren",
    lens: "the weekly-admin manager",
    surfaces: [
      { path: `/shop/${DEMO_SHOP_SLUG}/reviews`, as: "owner" },
      { path: `/shop/${DEMO_SHOP_SLUG}/promos`, as: "owner" },
      { path: `/shop/${DEMO_SHOP_SLUG}/settings`, as: "owner" },
    ],
  },
  {
    id: "victor",
    number: 13,
    name: "Victor",
    lens: "the owner evaluating a switch",
    surfaces: [
      { path: "/" },
      { path: "/pricing" },
      { path: "/switching" },
      { path: "/switching/eve" },
      { path: "/onboard" },
    ],
  },
  {
    id: "june",
    number: 14,
    name: "June",
    lens: "assistive tech and low vision",
    // June's surfaces are everybody else's: the axe scan and the skip-link
    // probe run on every page the walk opens, so her list is the short one of
    // the surfaces no other persona happens to visit.
    surfaces: [{ path: `/shop/${DEMO_SHOP_SLUG}/orders`, as: "owner" }],
  },
  {
    id: "leo",
    number: 15,
    name: "Leo",
    lens: "anyone on a slow island connection",
    surfaces: [
      { path: `/s/${DEMO_SHOP_SLUG}/register` },
      { path: `/shop/${DEMO_SHOP_SLUG}/gear`, as: "owner" },
    ],
  },
]);

/**
 * Every surface the walk opens, deduped by (path, role, locale) so a route two
 * personas share is visited once and its findings credited to both.
 *
 * Ordered so the anonymous surfaces come first: the walk signs in once per
 * staff role, and grouping the visits keeps that to one sign-in each rather
 * than one per page.
 */
export function walkPlan(personas = PERSONAS) {
  const visits = new Map();
  for (const persona of personas) {
    for (const surface of persona.surfaces) {
      const locale = persona.locale ?? "en-US";
      const key = `${surface.as ?? "anon"}|${locale}|${surface.path}`;
      const existing = visits.get(key);
      if (existing) {
        if (!existing.personas.includes(persona.id)) existing.personas.push(persona.id);
        continue;
      }
      visits.set(key, {
        key,
        path: surface.path,
        as: surface.as ?? null,
        locale,
        refusal: surface.refusal ?? false,
        personas: [persona.id],
      });
    }
  }
  return [...visits.values()].sort((a, b) => {
    const role = String(a.as).localeCompare(String(b.as));
    if (role !== 0) return role;
    const locale = a.locale.localeCompare(b.locale);
    if (locale !== 0) return locale;
    return a.path.localeCompare(b.path);
  });
}

/**
 * The personas the opt-in judged pass reads for (#1498), and only these two.
 *
 * Nadia's list and Kai's are almost entirely about words on a screen — is the
 * jargon explained, does the refusal name the actual rule — which is the half
 * no mechanical probe can see and the half a model reading a screenshot can.
 * Two rather than fifteen because a model's opinion arriving unattended in a
 * tracker is a trust question before it is a coverage one, and the condition
 * for widening is a month of dispatched output somebody has actually read.
 */
export const JUDGE_PERSONAS = Object.freeze(["nadia", "kai"]);

/** Persona by id, for turning a finding's id list back into names. */
export function personaById(id, personas = PERSONAS) {
  return personas.find((persona) => persona.id === id) ?? null;
}

/**
 * The probes, and the persona whose line each one holds.
 *
 * `axe:<rule>` findings are minted at walk time rather than declared here —
 * axe carries hundreds of rules and the walk reports whichever ones fire — so
 * `probeFor` falls back to the axe template for any id with that prefix.
 *
 * `touches` is the `**Touches:**` line the filed issue carries, and every path
 * on it has to exist on `main` (docs/agents/issue-tracker.md): a path only an
 * unmerged branch adds reddens `pnpm check:follow-ups` for every other session.
 * These are all long-standing files; the *route's* own `page.tsx` is added at
 * shaping time, and only when it is on disk.
 */
export const PROBES = Object.freeze({
  // No entry here declares `impact: "judged"`, and `findings.test.mjs` fails on
  // one that does. The band exists so a model's opinion can only ever spend the
  // issue budget a measurement did not; a mechanical probe borrowing it would
  // rank a fact below every opinion and quietly invert that.
  "skip-link": {
    persona: "june",
    kind: "risk",
    effort: "S",
    title: (count) => `Add the missing skip link to ${surfaceCount(count)}`,
    line: "every page keeps a skip link (persona 14, June)",
    touches: ["src/components/", "docs/product/personas.md"],
  },
  "untranslated-key": {
    persona: "ingrid",
    kind: "risk",
    effort: "S",
    title: (count) => `Replace the raw message keys rendering on ${surfaceCount(count)}`,
    line: "no reader ever sees a message key where a sentence belongs (persona 5, Ingrid)",
    touches: ["src/i18n/", "docs/product/personas.md"],
  },
  "page-error": {
    persona: "leo",
    kind: "risk",
    effort: "M",
    title: (count) => `Work out why ${surfaceCount(count)} did not render for the persona walk`,
    line: "a cold navigation is never a blank screen or a bare framework error (persona 15, Leo)",
    touches: ["src/app/", "docs/product/personas.md"],
  },
  "console-error": {
    persona: "leo",
    kind: "risk",
    effort: "M",
    title: (count) => `Clear the browser console errors on ${surfaceCount(count)}`,
    line: "a render throw never replaces the layout with the crash screen (persona 15, Leo)",
    touches: ["src/app/", "docs/product/personas.md"],
  },
  "shop-identity": {
    persona: "tomas",
    kind: "risk",
    effort: "S",
    title: (count) => `Put the shop's own name back on ${surfaceCount(count)}`,
    line: "anonymous public pages carry the shop's identity, never a bare shell (persona 2, Tomas)",
    touches: ["src/components/PublicShopChrome.tsx", "docs/product/personas.md"],
  },
});

/**
 * **Withdrawn: an "unsized image" probe.** Leo's line asks that content images
 * reserve their space, and an `<img>` carrying neither `width`/`height` nor
 * `loading="lazy"` looks like the test for it. It is not. Two dry runs found
 * two different shapes that reserve their space perfectly and fail that test:
 * `next/image` with `fill`, which is absolutely positioned inside a box that
 * already has a size (`src/components/StoredPhoto.tsx`), and a plain `<img>`
 * whose box is fixed by a Tailwind class (`size-16` on the settings page's logo
 * preview). Whether the layout shifts depends on the *specified* style, and a
 * computed style read after the image has loaded cannot recover what that was.
 * So the probe reported correct code, weekly, which is the one thing the
 * ceiling cannot absorb. `pnpm check:image-sizes` holds the neighbouring rule
 * over the source, where the answer is readable.
 */

/** `3 persona surfaces` / `one persona surface` — titles read badly with a bare number. */
function surfaceCount(count) {
  return count === 1 ? "one persona surface" : `${count} persona surfaces`;
}

/** The axe template, used for every `axe:<rule>` finding the walk reports. */
export const AXE_PROBE = Object.freeze({
  persona: "june",
  kind: "risk",
  effort: "M",
  line: "every tool-detectable accessibility defect is a fix, not an exclusion (persona 14, June)",
  touches: ["e2e/a11y.spec.ts", "docs/product/personas.md"],
});

/**
 * A judged probe id: `judged:<persona>:<url path>:<8 hex of the normalised claim>`.
 * Built in `judge.mjs`; parsed here so `probeFor` stays the one place a probe id
 * turns into a record, and so the two halves cannot drift apart unnoticed —
 * `judge.test.mjs` round-trips a built id through this.
 */
const JUDGED_PROBE = /^judged:([a-z][\w-]*):(.+):([0-9a-f]{8})$/;

/** The probe record behind a finding id, axe rules included. */
export function probeFor(probeId) {
  const judged = JUDGED_PROBE.exec(probeId);
  if (judged) {
    const [, personaId, urlPath] = judged;
    const persona = personaById(personaId);
    if (!persona) return null;
    return {
      persona: personaId,
      kind: "improvement",
      effort: "S",
      line: `the "hold the line on" list in ${persona.name}'s entry (persona ${persona.number}, ${persona.name})`,
      touches: ["docs/product/personas.md", "scripts/persona-bots/judge.mjs"],
      title: () => `Decide whether ${persona.name} is right about ${urlPath}`,
    };
  }
  if (probeId.startsWith("axe:")) {
    const rule = probeId.slice("axe:".length);
    return {
      ...AXE_PROBE,
      title: (count) =>
        `Fix the ${rule} accessibility violations axe reports on ${surfaceCount(count)}`,
    };
  }
  return PROBES[probeId] ?? null;
}
