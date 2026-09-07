import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import { makeActivitySafe } from "../../e2e/fixtures";
import {
  offlineCopySaved,
  openManifestPerson,
  openThreadStep,
  signInAs,
  threadStatus,
  tripPathByTitle,
} from "../../e2e/helpers";
import { E2E_CRON_SECRET, E2E_TEST_ROUTE_SECRET } from "../../e2e/servers";
import { DEMO_SHOP_TIMEZONE, demoTodayDepartureStart } from "../../src/db/seed-clock";
import { DAY_STATES, dayTimeline, renderTranscript, screenshotName } from "./lib.mjs";
import {
  SIMULATION_BASE_URL,
  SIMULATION_DAY_START,
  SIMULATION_OUT_DIR,
  SIMULATION_SHOP_SLUG,
} from "./topology";

/**
 * **One dive day, rehearsed end to end** (N-60; V-04's rehearsal, run by a
 * machine every night).
 *
 * A fresh shop is minted, its clock set to six in the morning, and the day is
 * then driven as the people in it would drive it: a diver books a seat on the
 * public page and signs the waiver from their link; the counter checks them
 * in; the crew say the boat is boarding, run roll call before departure, tap
 * *Underway*, count heads after every dive, say *Heading in* and *Home*; the
 * shop closes the day; the recap pass runs after its floor; the diver reads
 * the recap. Between each state the frozen clock is moved forward through
 * `/api/test/clock`, so every stamp — a stage word, a signature, a close-out —
 * lands at the hour it would on a real day.
 *
 * The states are `DAY_STATES` in `lib.mjs`, in order, one `test` each and
 * serial: the first state the day cannot reach fails by name and stops the
 * run, and the transcript (`simulation/day.md`) records what was reached, when
 * on the shop's clock, how long it really took, and the screenshot each state
 * left.
 *
 * Written against the same surfaces and the same helpers as the e2e fleet —
 * it *is* the fleet's server, browser and helpers under a config of its own —
 * so a surface that changes fails here the way it fails there.
 */

/** The seeded departure's length: `seed-trips.ts` fixes it at 3.5 hours dock to dock. */
const SEEDED_DEPARTURE_MS = 3.5 * 60 * 60 * 1000;
const SEEDED_DEPARTURE_TITLE = "Two-Tank Reef — Molasses & French";
const DIVER_NAME = "Sam Simulation";
const CARD_NUMBER = "SIM-2026-0721";

type StateResult = {
  id: string;
  label: string;
  status: "reached" | "failed" | "not-attempted";
  simulatedAt?: Date;
  realMs?: number;
  screenshots?: string[];
  note?: string;
  error?: string;
};

type Timeline = ReturnType<typeof dayTimeline>;

/** Everything the states hand each other. Module-level because the run is serial in one worker. */
const day = {
  startedAt: new Date(),
  results: new Map<string, StateResult>(),
  timeline: null as Timeline | null,
  tripId: "",
  readyPath: "",
  /** The divers recorded aboard at departure — the only ones counted after a dive. */
  boardedNames: [] as string[],
};

let browser: Browser;
let diverContext: BrowserContext;
let staffContext: BrowserContext;
let diver: Page;
let staff: Page;
let api: APIRequestContext;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser: launched, playwright }) => {
  browser = launched;
  mkdirSync(SIMULATION_OUT_DIR, { recursive: true });
  api = await playwright.request.newContext({
    baseURL: SIMULATION_BASE_URL,
    extraHTTPHeaders: { authorization: `Bearer ${E2E_TEST_ROUTE_SECRET}` },
  });
  diverContext = await newActorContext();
  staffContext = await newActorContext();
  diver = makeActivitySafe(await diverContext.newPage());
  staff = makeActivitySafe(await staffContext.newPage());
  writeTranscript();
});

test.afterAll(async () => {
  writeTranscript();
  await diverContext?.close();
  await staffContext?.close();
  await api?.dispose();
});

for (const [index, state] of DAY_STATES.entries()) {
  test(state.label, async () => {
    const started = Date.now();
    const result: StateResult = { id: state.id, label: state.label, status: "failed" };
    day.results.set(state.id, result);
    try {
      const outcome = await runState(state.id, index);
      result.status = "reached";
      result.note = outcome?.note;
      result.screenshots = outcome?.screenshots;
      result.simulatedAt = await serverNow();
    } catch (error) {
      // The message, not the call log: the transcript names what could not be
      // reached, and Playwright's trace and screenshot hold the rest.
      result.error = (error instanceof Error ? error.message : String(error)).split(
        "\nCall log",
      )[0];
      result.simulatedAt = await serverNow().catch(() => undefined);
      throw error;
    } finally {
      result.realMs = Date.now() - started;
      writeTranscript();
    }
  });
}

type Outcome = { note?: string; screenshots?: string[] };

async function runState(id: string, index: number): Promise<Outcome | undefined> {
  const at = (id: string, occurrence = 0) => {
    const state = day.timeline?.find((entry) => entry.id === id);
    if (!state) throw new Error(`no timeline entry for ${id}`);
    return state.at[occurrence];
  };

  switch (id) {
    case "shop-open": {
      const dayStart = new Date(SIMULATION_DAY_START);
      await advanceClock(dayStart);
      // The first request pays the one-time migrate + seed, then a whole shop of
      // this run's own is minted on top of it, as the fleet's `privateShop`
      // fixture does (ADR 20260815-per-test-private-shops).
      const reset = await api.post("/api/test/reset", { timeout: 120_000 });
      if (!reset.ok()) throw new Error(`reset failed: ${reset.status()} ${await reset.text()}`);
      await api.delete(`/api/test/seed-private-shop?slug=${SIMULATION_SHOP_SLUG}`).catch(() => {});
      const mint = await api.post(`/api/test/seed-private-shop?slug=${SIMULATION_SHOP_SLUG}`, {
        timeout: 60_000,
      });
      if (!mint.ok()) throw new Error(`mint failed: ${mint.status()} ${await mint.text()}`);
      const minted = (await mint.json()) as { slug: string; ownerEmail: string; password: string };
      await signInAs(staff, { email: minted.ownerEmail, password: minted.password });

      await staff.goto(shopPath());
      await expect(staff.getByRole("heading", { name: /^Good morning,/ })).toBeVisible();
      const shots = [await snap(staff, index, id)];

      // The morning read of the board: find the departure and open its manifest
      // once, to learn how many dives it plans — which is how many head counts
      // the day will hold.
      day.tripId = tripIdFromPath(
        await tripPathByTitle(staff, SIMULATION_SHOP_SLUG, SEEDED_DEPARTURE_TITLE),
      );
      await staff.goto(manifestPath());
      await offlineCopySaved(staff);
      const plannedDives = await staff.getByRole("link", { name: /^After dive \d+$/ }).count();
      const sailAt = demoTodayDepartureStart(dayStart, DEMO_SHOP_TIMEZONE);
      const endsAt = new Date(sailAt.getTime() + SEEDED_DEPARTURE_MS);
      day.timeline = dayTimeline({ dayStart, sailAt, endsAt, plannedDives });
      shots.push(await snap(staff, index, id, "manifest"));
      return {
        note: `${SEEDED_DEPARTURE_TITLE}: sails ${shopTime(sailAt)}, home ${shopTime(endsAt)}, ${plannedDives} dives`,
        screenshots: shots,
      };
    }

    case "seat-booked": {
      await advanceClock(at(id));
      await diver.goto(`/s/${SIMULATION_SHOP_SLUG}/trips/${day.tripId}`);
      await expect(diver.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
      const shots = [await snap(diver, index, id, "trip-page")];
      await diver.getByLabel("Name", { exact: true }).fill(DIVER_NAME);
      await diver.getByLabel("Email", { exact: true }).fill("sam.simulation@example.com");
      await diver.getByRole("button", { name: /^Book/ }).click();
      await expect(diver).toHaveURL(/\/ready\//);
      await expect(status()).toBeVisible();
      day.readyPath = new URL(diver.url()).pathname;
      shots.push(await snap(diver, index, id));
      return { note: `${DIVER_NAME}, one seat; thread: ${await statusText()}`, screenshots: shots };
    }

    case "waiver-signed": {
      await advanceClock(at(id));
      await diver.goto(day.readyPath);
      await diver.getByRole("button", { name: "Sign your waiver" }).click();
      await expect(diver).toHaveURL(/\/waivers\//);
      await expect(
        diver.getByRole("heading", { name: "A quick step before the dock" }),
      ).toBeVisible();
      await diver.getByLabel("Type your full name").fill(DIVER_NAME);
      await diver.getByLabel("I have read this waiver, understand it, and agree to it.").check();
      const noRadios = diver.getByRole("radio", { name: "No" });
      await noRadios.first().waitFor();
      const questions = await noRadios.count();
      for (let i = 0; i < questions; i += 1) await noRadios.nth(i).check();
      const shots = [await snap(diver, index, id, "form")];
      await diver.getByRole("button", { name: "Sign waiver" }).click();
      await expect(diver).toHaveURL(/\/ready\//);
      await expect(status()).toBeVisible();
      shots.push(await snap(diver, index, id));
      return {
        note: `${questions} medical questions answered; thread: ${await statusText()}`,
        screenshots: shots,
      };
    }

    case "card-added": {
      // The counter refuses a diver with no certification on file for this
      // departure, and the thread says so as the next step — so the diver
      // files their card from the link, the one place a diver can (ADR
      // 20260820-attested-at-booking-verified-at-boarding, amended).
      await advanceClock(at(id));
      await diver.goto(day.readyPath);
      const step = await openThreadStep(diver, "certification");
      const entry = step
        .locator("details")
        .filter({ has: diver.getByText("Add your certification", { exact: true }) });
      await entry.getByText("Add your certification", { exact: true }).click();
      await entry.getByLabel("Training agency").selectOption({ label: "PADI" });
      await entry
        .getByLabel("Level", { exact: true })
        .selectOption({ label: "Advanced Open Water" });
      await entry.getByLabel("Certification number").fill(CARD_NUMBER);
      const shots = [await snap(diver, index, id, "form")];
      await entry.getByRole("button", { name: "Add my certification" }).click();
      await expect(
        diver.getByRole("status").filter({ hasText: "Certification added" }),
      ).toBeVisible();
      shots.push(await snap(diver, index, id));
      return {
        note: `PADI Advanced Open Water ${CARD_NUMBER}, self-declared; thread: ${await statusText()}`,
        screenshots: shots,
      };
    }

    case "card-verified": {
      // A diver-typed card clears nothing until a staffer reads the agency and
      // number off the plastic — which is what the counter does when the diver
      // arrives with it.
      await advanceClock(at(id));
      await staff.goto(`${shopPath()}/divers`);
      await staff.getByRole("searchbox", { name: "Search divers" }).fill(DIVER_NAME);
      await staff.getByRole("link", { name: new RegExp(DIVER_NAME) }).click();
      const card = staff
        .locator("li")
        .filter({ hasText: CARD_NUMBER })
        .filter({ visible: true })
        .last();
      await expect(card).toContainText("Self-declared");
      await card.locator("summary").filter({ hasText: "Verify certification record" }).click();
      await card.getByLabel("Agency").selectOption({ label: "PADI" });
      await card.getByLabel("Certification number").fill(CARD_NUMBER);
      const shots = [await snap(staff, index, id, "record")];
      await card.getByRole("button", { name: "Mark certified" }).click();
      await expect(
        staff.locator("li").filter({ hasText: CARD_NUMBER }).filter({ visible: true }).last(),
      ).not.toContainText("Self-declared");
      shots.push(await snap(staff, index, id));
      return { screenshots: shots };
    }

    case "checked-in": {
      await advanceClock(at(id));
      await staff.goto(`${shopPath()}/check-in`);
      const search = staff.getByRole("searchbox", { name: "Scan or search diver" });
      await expect(search).toHaveAttribute("data-hydrated", "true");
      await search.fill(DIVER_NAME);
      await search.press("Enter");
      const card = staff
        .locator("article")
        .filter({ hasText: DIVER_NAME })
        .filter({ visible: true });
      await expect(card).toHaveCount(1);
      const checkIn = card.getByRole("button", { name: `Check in ${DIVER_NAME}` });
      if ((await checkIn.count()) === 0) {
        throw new Error(
          `the counter cannot check ${DIVER_NAME} in — the card reads: ${(await card.innerText()).replace(/\s+/g, " ")}`,
        );
      }
      const shots = [await snap(staff, index, id, "queue")];
      await checkIn.click();
      const settled = staff.locator("details").filter({ hasText: /Checked in — \d+/ });
      await expect(settled.getByRole("heading", { name: /Checked in — \d+/ })).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        staff.getByRole("button", { name: `Undo check-in for ${DIVER_NAME}` }),
      ).toBeVisible();
      shots.push(await snap(staff, index, id));
      return { screenshots: shots };
    }

    case "boarding":
    case "underway":
    case "heading-in":
    case "home": {
      const word = {
        boarding: "Boarding",
        underway: "Underway",
        "heading-in": "Heading in",
        home: "Home",
      }[id];
      await advanceClock(at(id));
      await staff.goto(manifestPath());
      await offlineCopySaved(staff);
      const tap = staff.getByRole("button", { name: word, exact: true });
      await tap.click();
      await expect(tap).toHaveAttribute("aria-pressed", "true");
      const shots = [await snap(staff, index, id)];
      // The word reaches the diver's own link — the point of saying it. The
      // diver reads it as a sentence (`tripStage.*` in diver.json), not the
      // crew's one-word tap.
      const sentence = {
        boarding: /is boarding\./,
        underway: /is out on /,
        "heading-in": /is heading in\./,
        home: /is back at the dock\./,
      }[id];
      await diver.goto(day.readyPath);
      await expect(diver.getByText(sentence).first()).toBeVisible();
      shots.push(await snap(diver, index, id, "diver"));
      if (id === "home") {
        // The shop home's station for this boat, read rather than asserted:
        // at the scheduled end the station still says "Still out" for the
        // standing one-hour late-arrival buffer, whatever the crew tapped, and
        // the transcript records what a staffer would see at that moment.
        await staff.goto(shopPath());
        // A station is a `SectionCard as="li"` (DayStation.tsx).
        const station = staff.locator("li").filter({ hasText: SEEDED_DEPARTURE_TITLE }).first();
        await expect(station).toBeVisible();
        const reading = (await station.locator("p").nth(1).innerText()).replace(/\s+/g, " ").trim();
        shots.push(await snap(staff, index, id, "shop-home"));
        return { note: `shop home station reads: ${reading}`, screenshots: shots };
      }
      return { screenshots: shots };
    }

    case "roll-call-departure": {
      await advanceClock(at(id));
      await staff.goto(`${manifestPath()}?checkpoint=departure`);
      await offlineCopySaved(staff);
      const counted = await countEveryone(staff, { checkpoint: "departure" });
      day.boardedNames = counted.boarded;
      await expect(staff.getByRole("heading", { name: "Roll call complete" })).toBeVisible();
      return {
        note: `${counted.boarded.length} divers boarded, ${counted.notBoarded.length} recorded not boarded (${counted.notBoarded.join(", ") || "none"}), ${counted.crew} crew aboard`,
        screenshots: [await snap(staff, index, id)],
      };
    }

    case "roll-call-after-dives": {
      const shots: string[] = [];
      const notes: string[] = [];
      const checkpoints = day.timeline?.find((entry) => entry.id === id)?.at ?? [];
      for (const [dive, instant] of checkpoints.entries()) {
        await advanceClock(instant);
        await staff.goto(`${manifestPath()}?checkpoint=after_dive_${dive + 1}`);
        await offlineCopySaved(staff);
        // Between dives the crew say where the boat is — the one word with no
        // state of its own on the timeline.
        if (dive === 0) {
          const surface = staff.getByRole("button", { name: "Surface", exact: true });
          await surface.click();
          await expect(surface).toHaveAttribute("aria-pressed", "true");
        }
        const counted = await countEveryone(staff, {
          checkpoint: `after_dive_${dive + 1}`,
          onlyNames: day.boardedNames,
        });
        await expect(staff.getByRole("heading", { name: "Roll call complete" })).toBeVisible();
        shots.push(await snap(staff, index, id, `dive-${dive + 1}`));
        notes.push(
          `after dive ${dive + 1}: ${counted.boarded.length} divers and ${counted.crew} crew back aboard`,
        );
      }
      return { note: notes.join("; "), screenshots: shots };
    }

    case "day-closed": {
      await advanceClock(at(id));
      await staff.goto(shopPath());
      const close = staff.getByRole("button", { name: /^Close the day( again)?$/ }).first();
      await expect(close).toBeVisible();
      const shots = [await snap(staff, index, id, "evening")];
      await close.click();
      await expect(staff.getByText("Day closed. The record is below")).toBeVisible();
      await expect(staff.getByText(/Closed by .+ at/)).toBeVisible();
      shots.push(await snap(staff, index, id));
      return { screenshots: shots };
    }

    case "recap-sent": {
      await advanceClock(at(id));
      const pass = await api.get("/api/cron/recaps", {
        headers: { authorization: `Bearer ${E2E_CRON_SECRET}` },
        timeout: 60_000,
      });
      if (!pass.ok()) throw new Error(`recap pass failed: ${pass.status()} ${await pass.text()}`);
      const summary = (await pass.json()) as Record<string, number>;
      if (!(summary.scanned >= 1)) {
        throw new Error(`the recap pass found nothing due: ${JSON.stringify(summary)}`);
      }
      // The simulation has no email provider, so the delivery row records
      // `not_configured` rather than a send; what the pass proves is that the
      // booking became due at its floor and was handled.
      return {
        note: `recap pass: ${Object.entries(summary)
          .map(([k, v]) => `${k} ${v}`)
          .join(
            ", ",
          )} (no email provider in the simulation, so delivery is recorded as not configured)`,
      };
    }

    case "recap-read": {
      await advanceClock(at(id));
      await diver.goto(day.readyPath);
      await expect(diver.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
      return { screenshots: [await snap(diver, index, id)] };
    }

    default:
      throw new Error(`no driver for state ${id}`);
  }
}

/**
 * Record everybody at one checkpoint, the way the crew does: every diver with
 * a boarding control is boarded; at departure a diver *without* one (blocked,
 * still on the dock) is recorded not boarded from their own panel — the
 * two-step the manifest insists on; then every crew member is called aboard.
 * After a dive only the divers who boarded are counted — a straggler who never
 * got on the boat is not "back aboard" because somebody's thumb slipped.
 */
async function countEveryone(
  page: Page,
  options: { checkpoint: string; onlyNames?: string[] },
): Promise<{ boarded: string[]; notBoarded: string[]; crew: number }> {
  const rows = page.locator("#roll-call-list > ul > li");
  await rows.first().waitFor();
  const boarded: string[] = [];
  const notBoarded: string[] = [];
  const total = await rows.count();
  for (let i = 0; i < total; i += 1) {
    const row = rows.nth(i);
    const name = await rowName(row);
    if (options.onlyNames && !options.onlyNames.includes(name)) continue;
    const settled = row.getByRole("button", { name: "Boarded — tap again to undo" });
    if (await settled.count()) {
      boarded.push(name);
      continue;
    }
    const board = row.getByRole("button", { name: "Mark boarded" });
    if (await board.count()) {
      const before = await page
        .getByRole("button", { name: "Boarded — tap again to undo" })
        .count();
      await board.evaluate((button) => button.scrollIntoView({ block: "center" }));
      await board.click();
      await expect(page.getByRole("button", { name: "Boarded — tap again to undo" })).toHaveCount(
        before + 1,
      );
      boarded.push(name);
      continue;
    }
    if (options.checkpoint === "departure") {
      await openManifestPerson(row);
      const dialog = page.getByRole("dialog");
      const notBoard = dialog.getByRole("button", { name: "Mark not boarded" });
      await notBoard.evaluate((button) => button.scrollIntoView({ block: "center" }));
      await notBoard.click();
      await expect(
        dialog.getByRole("button", { name: "Not boarded — tap again to undo" }),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "Close person details" }).click();
      await expect(dialog).toHaveCount(0);
      notBoarded.push(name);
    }
  }
  const crewAboard = page.getByRole("button", { name: "Mark aboard" });
  let crew = await page.getByRole("button", { name: "Aboard — tap again to undo" }).count();
  for (let guard = 0; guard < 12; guard += 1) {
    if ((await crewAboard.count()) === 0) break;
    const settled = page.getByRole("button", { name: "Aboard — tap again to undo" });
    const before = await settled.count();
    const next = crewAboard.first();
    await next.evaluate((button) => button.scrollIntoView({ block: "center" }));
    await next.click();
    await expect(settled).toHaveCount(before + 1);
    crew = before + 1;
  }
  return { boarded, notBoarded, crew };
}

/**
 * The thread's one status line, visible only. The diver's page lives for the
 * whole day, and React's `<Activity>` keeps the previous render of `/ready`
 * in the DOM for instant back-navigation — so the fleet's unfiltered
 * `threadStatus` (which counts) would see two of them here.
 */
function status(): Locator {
  return threadStatus(diver).filter({ visible: true });
}

async function statusText(): Promise<string> {
  return (await status().innerText()).replace(/\s+/g, " ").trim();
}

/** The person a roll-call row is about: the name on its own panel trigger. */
async function rowName(row: Locator): Promise<string> {
  // The trigger's accessible name is "Open details for {name}"
  // (`manifest.openPersonDetails`); its visible text starts with the row's
  // index, which is not a person.
  const trigger = row.locator('button[aria-haspopup="dialog"]').first();
  const label = (await trigger.getAttribute("aria-label")) ?? "";
  return label.replace(/^Open details for\s+/, "").trim();
}

/** Move the server's clock and the browsers' clocks to `instant`, together. */
async function advanceClock(instant: Date): Promise<void> {
  const response = await api.post("/api/test/clock", { data: { now: instant.toISOString() } });
  if (!response.ok()) {
    throw new Error(
      `could not move the clock to ${instant.toISOString()}: ${response.status()} ${await response.text()}`,
    );
  }
  for (const context of [diverContext, staffContext]) {
    await context.addCookies([
      { name: "diveday_sim_clock", value: instant.toISOString(), url: SIMULATION_BASE_URL },
    ]);
  }
}

async function serverNow(): Promise<Date> {
  const response = await api.get("/api/test/clock");
  const body = (await response.json()) as { now: string };
  return new Date(body.now);
}

/**
 * A browser context whose `Date` follows the simulated clock. The fleet pins
 * one instant in an init script (`e2e/fixtures.ts`); here the instant has to
 * move, so the script reads it from a cookie `advanceClock` rewrites on every
 * step — the same cookie-at-document-start pattern the fleet's offline switch
 * uses. Only argless `new Date()` / `Date.now()` are pinned; parsing and every
 * Date method are untouched. Third-party requests are answered the way the
 * fleet answers them, so no state waits on the outside world.
 */
async function newActorContext(): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: SIMULATION_BASE_URL,
    extraHTTPHeaders: { authorization: `Bearer ${E2E_TEST_ROUTE_SECRET}` },
    timezoneId: "America/New_York",
    colorScheme: "light",
    viewport: { width: 1279, height: 720 },
  });
  await context.addInitScript((fallback: string) => {
    const match = document.cookie.match(/(?:^|; )diveday_sim_clock=([^;]+)/);
    const fixed = new Date(match ? decodeURIComponent(match[1]) : fallback).getTime();
    const RealDate = Date;
    globalThis.Date = new Proxy(RealDate, {
      construct: (target, args) => Reflect.construct(target, args.length === 0 ? [fixed] : args),
      get: (target, prop, receiver) =>
        prop === "now" ? () => fixed : Reflect.get(target, prop, receiver),
    });
  }, SIMULATION_DAY_START);
  await context.route("https://maps.google.com/**", (route) => route.abort());
  await context.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  );
  await context.route("https://fonts.gstatic.com/**", (route) => route.abort());
  return context;
}

async function snap(page: Page, index: number, id: string, suffix = ""): Promise<string> {
  const name = screenshotName(index, id, suffix);
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(SIMULATION_OUT_DIR, name),
    fullPage: true,
    animations: "disabled",
  });
  return name;
}

function writeTranscript(): void {
  const results = DAY_STATES.map(
    (state) =>
      day.results.get(state.id) ?? {
        id: state.id,
        label: state.label,
        status: "not-attempted" as const,
      },
  );
  writeFileSync(
    path.join(SIMULATION_OUT_DIR, "day.md"),
    renderTranscript({
      shopSlug: SIMULATION_SHOP_SLUG,
      timeZone: DEMO_SHOP_TIMEZONE,
      dayStart: SIMULATION_DAY_START,
      startedAt: day.startedAt,
      finishedAt: new Date(),
      results,
    }),
  );
}

function shopPath(): string {
  return `/shop/${SIMULATION_SHOP_SLUG}`;
}

function manifestPath(): string {
  return `${shopPath()}/trips/${day.tripId}/manifest`;
}

function tripIdFromPath(href: string): string {
  const id = href.match(/\/trips\/([0-9a-f-]+)/i)?.[1];
  if (!id) throw new Error(`could not read a trip id from "${href}"`);
  return id;
}

const shopClock = new Intl.DateTimeFormat("en-US", {
  timeZone: DEMO_SHOP_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
function shopTime(instant: Date): string {
  return shopClock.format(instant);
}
