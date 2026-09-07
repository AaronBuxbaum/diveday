/**
 * The fifteen personas, as walks a machine can take.
 *
 * `docs/product/personas.md` is the standing evaluation frame: fifteen people
 * with a surface list and a "hold the line on" checklist each. This file is
 * that document turned into an itinerary — for every persona, which stops they
 * make and which lenses are read at each one — so a weekly run can walk their
 * flows against the demo shop and report what it finds (N-61).
 *
 * It is deliberately a *subset* of each checklist. Most of what those lists
 * hold ("a refusal states a true, specific reason") is a judgement no lens can
 * make; what is here are the mechanical failures that surface *as* those
 * checklist items — a page that renders nothing, a request that answered 500, a
 * control a wet thumb cannot hit, a page that says it is in English while the
 * reader asked for Spanish. A persona finding is a lead for a human, never a
 * verdict, which is why nothing in this run gates a build.
 *
 * No sixteenth persona is invented here. When `personas.md` changes, this file
 * changes with it, and `personas.test.mjs` fails if the two disagree on the
 * roster.
 */

/**
 * The lenses a stop can be read through, most consequential first.
 *
 * `severity` orders what a capped run files: with room for three issues a week
 * (see `lib.mjs`), a page that rendered nothing outranks a link four pixels
 * short of the tap floor. `kind` is the follow-up **Kind:** the filed issue
 * carries.
 */
export const LENSES = Object.freeze({
  "stop-unreachable": {
    severity: 0,
    kind: "risk",
    title: "a persona could not reach one of their own surfaces",
  },
  "blank-render": {
    severity: 1,
    kind: "risk",
    title: "a surface rendered without a heading or main content",
  },
  "request-failed": {
    severity: 2,
    kind: "risk",
    title: "a surface asked for something the server refused",
  },
  "console-error": {
    severity: 3,
    kind: "risk",
    title: "a surface wrote an error to the browser console",
  },
  axe: { severity: 4, kind: "improvement", title: "an accessibility rule failed on a surface" },
  "page-language": {
    severity: 5,
    kind: "improvement",
    title: "a surface declared a language the reader did not ask for",
  },
  "no-skip-link": { severity: 6, kind: "improvement", title: "a surface offers no skip link" },
  "tap-target": {
    severity: 7,
    kind: "improvement",
    title: "a control sits under the 44px tap floor on a phone",
  },
});

export const LENS_IDS = Object.freeze(Object.keys(LENSES));

/** Lenses every persona reads, whatever else they came to look at. */
const ALWAYS = Object.freeze([
  "stop-unreachable",
  "blank-render",
  "request-failed",
  "console-error",
]);

/** The demo shop every walk is taken against. */
export const WALK_SHOP_SLUG = "blue-mantis";

const shop = (...segments) => ["/shop", WALK_SHOP_SLUG, ...segments].join("/");
const storefront = (...segments) => ["/s", WALK_SHOP_SLUG, ...segments].join("/");

/**
 * The fifteen, in `personas.md` order. Each carries:
 *
 * - `number`/`name`/`role` — the row in `personas.md`, so a filed issue can
 *   name the person whose walk found it and a reader can go and read them.
 * - `actor` — `public` (nobody signed in) or a key of `DEV_STAFF_LOGINS`.
 * - `viewport` — `phone` or `desktop`; the persona's own device, because a tap
 *   target and a wrapped header are only defects on one of them.
 * - `locale` — what the browser asks for in `Accept-Language`.
 * - `lenses` — read at every stop, on top of `ALWAYS`.
 * - `stops` — where they go. A `path` is walked directly; a `flow` is a named
 *   sequence `walk.spec.ts` knows how to drive. `{tripId}` and `{recapToken}`
 *   are resolved against the seeded demo departure at run time, and
 *   `expectMissing` marks the stop whose *point* is the refusal it lands on.
 * - `touches` — real paths in this repository, so a filed issue's **Touches:**
 *   line points a cold reader at where the surface lives. `personas.test.mjs`
 *   asserts every one of them exists.
 */
export const PERSONAS = Object.freeze([
  {
    id: "nadia",
    number: 1,
    name: "Nadia",
    role: "the nervous first-timer",
    actor: "public",
    viewport: "desktop",
    locale: "en-US",
    lenses: [],
    stops: [
      { id: "storefront", path: storefront(), touches: ["src/app/s/[shopSlug]/page.tsx"] },
      {
        id: "course-catalog",
        path: storefront("courses"),
        touches: ["src/app/s/[shopSlug]/courses/page.tsx"],
      },
      {
        id: "open-water",
        path: storefront("courses", "open-water-diver"),
        touches: ["src/app/s/[shopSlug]/courses/[slug]/page.tsx"],
      },
    ],
  },
  {
    id: "tomas",
    number: 2,
    name: "Tomas",
    role: "the certified traveler booking from a phone abroad",
    actor: "public",
    viewport: "phone",
    locale: "en-US",
    lenses: ["tap-target"],
    stops: [
      { id: "storefront", path: storefront(), touches: ["src/app/s/[shopSlug]/page.tsx"] },
      {
        id: "departure",
        path: storefront("trips", "{tripId}"),
        touches: ["src/app/s/[shopSlug]/trips/[id]/page.tsx"],
      },
      {
        id: "missing-departure",
        path: storefront("trips", "00000000-0000-4000-8000-000000000000"),
        touches: ["src/app/s/[shopSlug]/not-found.tsx"],
        expectMissing: true,
      },
    ],
  },
  {
    id: "priya",
    number: 3,
    name: "Priya",
    role: "the parent booking a family",
    actor: "public",
    viewport: "phone",
    locale: "en-US",
    lenses: ["tap-target"],
    stops: [
      {
        id: "departure",
        path: storefront("trips", "{tripId}"),
        touches: ["src/app/s/[shopSlug]/trips/[id]/page.tsx"],
      },
      {
        id: "course",
        path: storefront("courses", "open-water-diver"),
        touches: ["src/app/s/[shopSlug]/courses/[slug]/page.tsx"],
      },
    ],
  },
  {
    id: "marco",
    number: 4,
    name: "Marco",
    role: "the repeat local who wants to book in ten seconds",
    actor: "public",
    viewport: "desktop",
    locale: "en-US",
    lenses: [],
    stops: [
      { id: "storefront", path: storefront(), touches: ["src/app/s/[shopSlug]/page.tsx"] },
      {
        id: "has-space",
        path: `${storefront()}?space=open`,
        touches: ["src/app/s/[shopSlug]/_components"],
      },
      {
        id: "departure",
        path: storefront("trips", "{tripId}"),
        touches: ["src/app/s/[shopSlug]/trips/[id]/page.tsx"],
      },
    ],
  },
  {
    id: "ingrid",
    number: 5,
    name: "Ingrid",
    role: "the non-native English speaker",
    actor: "public",
    viewport: "desktop",
    locale: "es-ES",
    lenses: ["page-language"],
    stops: [
      { id: "storefront", path: storefront(), touches: ["src/i18n/locales/es-ES/diver.json"] },
      {
        id: "departure",
        path: storefront("trips", "{tripId}"),
        touches: ["src/i18n/locales/es-ES/diver.json"],
      },
      {
        id: "course-catalog",
        path: storefront("courses"),
        touches: ["src/i18n/locales/es-ES/diver.json"],
      },
    ],
  },
  {
    id: "rob",
    number: 6,
    name: "Rob",
    role: "the diver the night before",
    actor: "public",
    viewport: "phone",
    locale: "en-US",
    lenses: ["tap-target"],
    stops: [
      {
        id: "thread-and-waiver",
        flow: "book-and-sign",
        touches: ["src/app/ready/[token]/page.tsx", "src/app/waivers/[token]/page.tsx"],
      },
      {
        id: "dead-waiver-link",
        path: "/waivers/not-a-real-token",
        touches: ["src/app/waivers/[token]/page.tsx"],
      },
    ],
  },
  {
    id: "amara",
    number: 7,
    name: "Amara",
    role: "the diver after the trip",
    actor: "public",
    viewport: "phone",
    locale: "en-US",
    lenses: ["tap-target"],
    stops: [
      { id: "recap", path: "/recap/{recapToken}", touches: ["src/app/recap/[token]/page.tsx"] },
      {
        id: "dead-recap-link",
        path: "/recap/not-a-real-token",
        touches: ["src/app/recap/[token]/page.tsx"],
      },
    ],
  },
  {
    id: "dana",
    number: 8,
    name: "Dana",
    role: "the solo owner at 6am",
    actor: "owner",
    viewport: "phone",
    locale: "en-US",
    lenses: ["tap-target"],
    stops: [
      { id: "today", path: shop(), touches: ["src/app/shop/[shopSlug]/page.tsx"] },
      {
        id: "board",
        path: shop("schedule", "board"),
        touches: ["src/app/shop/[shopSlug]/schedule/board/page.tsx"],
      },
      {
        id: "departure",
        path: shop("trips", "{tripId}"),
        touches: ["src/app/shop/[shopSlug]/trips/[id]/page.tsx"],
      },
    ],
  },
  {
    id: "chloe",
    number: 9,
    name: "Chloe",
    role: "the front desk in a morning rush",
    actor: "owner",
    viewport: "desktop",
    locale: "en-US",
    lenses: ["tap-target"],
    stops: [
      {
        id: "check-in",
        path: shop("check-in"),
        touches: ["src/app/shop/[shopSlug]/check-in/page.tsx"],
      },
      {
        id: "add-booking",
        path: shop("bookings", "new"),
        touches: ["src/app/shop/[shopSlug]/bookings/new/page.tsx"],
      },
      {
        id: "guests",
        path: shop("trips", "{tripId}", "guests"),
        touches: ["src/app/shop/[shopSlug]/trips/[id]/guests/page.tsx"],
      },
    ],
  },
  {
    id: "sal",
    number: 10,
    name: "Sal",
    role: "the captain with wet hands",
    actor: "captain",
    viewport: "phone",
    locale: "en-US",
    lenses: ["tap-target"],
    stops: [
      {
        id: "manifest",
        path: shop("trips", "{tripId}", "manifest"),
        touches: ["src/app/shop/[shopSlug]/trips/[id]/manifest/page.tsx"],
      },
      {
        id: "offline-manifest",
        path: "/offline-manifest",
        touches: ["src/app/offline-manifest/page.tsx"],
      },
    ],
  },
  {
    id: "kai",
    number: 11,
    name: "Kai",
    role: "the day-one seasonal hire",
    actor: "divemaster",
    viewport: "phone",
    locale: "en-US",
    lenses: ["tap-target"],
    stops: [
      { id: "today", path: shop(), touches: ["src/lib/staff-destinations.ts"] },
      {
        id: "a-door-they-cannot-open",
        path: shop("settings"),
        touches: ["src/lib/session.ts"],
        expectMissing: true,
      },
      {
        id: "manifest",
        path: shop("trips", "{tripId}", "manifest"),
        touches: ["src/app/shop/[shopSlug]/trips/[id]/manifest/page.tsx"],
      },
    ],
  },
  {
    id: "maren",
    number: 12,
    name: "Maren",
    role: "the weekly-admin manager",
    actor: "owner",
    viewport: "desktop",
    locale: "en-US",
    lenses: [],
    stops: [
      {
        id: "reviews",
        path: shop("reviews"),
        touches: ["src/app/shop/[shopSlug]/reviews/page.tsx"],
      },
      { id: "promos", path: shop("promos"), touches: ["src/app/shop/[shopSlug]/promos/page.tsx"] },
      {
        id: "reports",
        path: shop("reports"),
        touches: ["src/app/shop/[shopSlug]/reports/page.tsx"],
      },
      {
        id: "settings",
        path: shop("settings"),
        touches: ["src/app/shop/[shopSlug]/settings/page.tsx"],
      },
    ],
  },
  {
    id: "victor",
    number: 13,
    name: "Victor",
    role: "the skeptical owner evaluating a switch",
    actor: "public",
    viewport: "desktop",
    locale: "en-US",
    lenses: [],
    stops: [
      { id: "landing", path: "/", touches: ["src/app/page.tsx"] },
      { id: "product", path: "/product", touches: ["src/app/product/page.tsx"] },
      { id: "pricing", path: "/pricing", touches: ["src/app/pricing/page.tsx"] },
      { id: "switching", path: "/switching", touches: ["src/lib/migration-guides.ts"] },
      { id: "onboard", path: "/onboard", touches: ["src/app/onboard/page.tsx"] },
    ],
  },
  {
    id: "june",
    number: 14,
    name: "June",
    role: "the assistive-tech and low-vision reader",
    actor: "public",
    viewport: "desktop",
    locale: "en-US",
    lenses: ["axe", "no-skip-link"],
    stops: [
      { id: "landing", path: "/", touches: ["src/app/page.tsx"] },
      { id: "storefront", path: storefront(), touches: ["src/app/s/[shopSlug]/page.tsx"] },
      {
        id: "departure",
        path: storefront("trips", "{tripId}"),
        touches: ["src/app/s/[shopSlug]/trips/[id]/page.tsx"],
      },
      { id: "sign-in", path: "/sign-in", touches: ["src/app/sign-in/page.tsx"] },
    ],
  },
  {
    id: "leo",
    number: 15,
    name: "Leo",
    role: "anyone on a slow island connection",
    actor: "public",
    viewport: "phone",
    locale: "en-US",
    lenses: [],
    stops: [
      { id: "storefront", path: storefront(), touches: ["src/app/s/[shopSlug]/loading.tsx"] },
      {
        id: "departure",
        path: storefront("trips", "{tripId}"),
        touches: ["src/app/s/[shopSlug]/trips/[id]/loading.tsx"],
      },
      {
        id: "embed-grid",
        path: storefront("embed", "grid"),
        touches: ["src/app/s/[shopSlug]/embed"],
      },
    ],
  },
]);

/** Every lens a persona reads, in severity order, `ALWAYS` included. */
export function lensesFor(persona) {
  const declared = new Set([...ALWAYS, ...(persona.lenses ?? [])]);
  return LENS_IDS.filter((id) => declared.has(id));
}

/** `Nadia (1) — the nervous first-timer`, the phrase a filed issue and the summary both use. */
export function personaLabel(persona) {
  return `${persona.name} (${persona.number}) — ${persona.role}`;
}

export function personaById(id) {
  return PERSONAS.find((persona) => persona.id === id) ?? null;
}

/** How many stops the whole run makes, which is what a reader wants from a summary. */
export function stopCount() {
  return PERSONAS.reduce((total, persona) => total + persona.stops.length, 0);
}
