import type { DiverMessageKey } from "@/i18n/messages";
import type { DemoRoleId } from "./demo-roles";

/**
 * **The three stories the live demo tells** (issue #1215, delight report D55).
 *
 * Named by the owner's triage ruling of 2026-09-02: a first-time diver booking
 * on the public schedule, a returning diver whose gear and fit are already
 * known, and a weather-affected day the crew handles well. The ruling was
 * explicit that every mechanism was already shipped and the only thing missing
 * was the naming — which is what this file is.
 *
 * **"Each resetting its state on entry" is already true, and that is worth
 * knowing before anybody writes a reset door.** `enterDemoAction` mints a whole
 * seeded shop per entry (`createDemoShop`), so two visitors never share state
 * and a prospect who books a seat leaves nothing behind for the next one. The
 * story is a *destination* in a fresh shop, not a mutation of a shared one.
 *
 * **No story seeds a failure.** The weather day lands on the blow-out confirm
 * page with the departure still running, so the visitor performs the act and
 * watches the cascade they caused. Pre-cancelling it would seed a trouble state
 * into a demo — the thing AGENTS.md refuses, because "a demo permanently
 * shouting that four payments are broken is a worse demo" — and it would take
 * away the only part of the story that shows the crew handling anything.
 *
 * Keys, never words (the pattern `src/lib/marketing.ts` and `demo-roles.ts`
 * keep): `scripts/check-domain-strings.mjs` hard-fails on a prose literal here.
 */
export const DEMO_STORY_IDS = ["first-booking", "returning-diver", "weather-day"] as const;

export type DemoStoryId = (typeof DEMO_STORY_IDS)[number];

export function isDemoStoryId(value: unknown): value is DemoStoryId {
  return typeof value === "string" && (DEMO_STORY_IDS as readonly string[]).includes(value);
}

/**
 * Who each story is told to.
 *
 * The first is the shop's *customer*, so it needs no session at all and lands
 * on the public schedule. The second is whoever preps the boat. The third is
 * the person whose call it is to cancel — a divemaster cannot blow out a
 * departure, so telling that story as anyone else would land the visitor on a
 * refusal.
 */
export const DEMO_STORY_ROLE: Record<DemoStoryId, DemoRoleId> = {
  "first-booking": "diver",
  "returning-diver": "instructor",
  "weather-day": "owner",
};

/** Title and the one line under it, per story. */
export const DEMO_STORY_KEYS: Record<
  DemoStoryId,
  { title: DiverMessageKey; desc: DiverMessageKey }
> = {
  "first-booking": {
    title: "demo.stories.firstBooking.title",
    desc: "demo.stories.firstBooking.desc",
  },
  "returning-diver": {
    title: "demo.stories.returningDiver.title",
    desc: "demo.stories.returningDiver.desc",
  },
  "weather-day": {
    title: "demo.stories.weatherDay.title",
    desc: "demo.stories.weatherDay.desc",
  },
};
