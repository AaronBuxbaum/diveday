import { describe, expect, it } from "vitest";
import { routeSource } from "@/test/route-source";

/**
 * **What the thread page is, and what it stopped being** — ADR
 * 20260827-the-divers-thread, decision 3 and decision 6, pinned as rules.
 *
 * Only the rules about which token, state and read each part of the page
 * answers to stay here; its layout and order are the visual suite's.
 *
 * It reads the route's source because the thing being pinned is a *server*
 * page's composition: there is no render to inspect without a database, a
 * request, a shop and a live capability token, and an e2e spec that scrolls
 * the real page cannot say *why* a section is where it is. Same shape as
 * `src/app/s/[shopSlug]/trips/[id]/page.composition.test.ts` and
 * `scripts/check-intl-providers.mjs`, for the same reason.
 */

const SOURCE = component("page.tsx");
/** The after-dive reads the page asks first (code review 2026-10-13, item 29). */
const AFTER_DIVE_READS = component("after-dive-reads.ts");
/** The after-state's doors, bound (security review r5-4, F3). */
const AFTER_STATE_ACTIONS = component("after-state-actions.ts");

/**
 * The source of a file the page composes, read by name: under the route's
 * `_components/`, or under `src/components/`. A section that moves out of the
 * page moves its pins with it by changing only the name passed here.
 */
/** The route's source, wherever a split put it (`src/test/route-source.ts`). */
function component(file: string): string {
  return routeSource(import.meta.dirname, file);
}

/** Where a marker first appears in the route's source, or -1. */
function positionOf(marker: string): number {
  return SOURCE.indexOf(marker);
}

/** How many times it appears. */
function countOf(marker: string): number {
  return SOURCE.split(marker).length - 1;
}

const MASTHEAD = component("ReadyMasthead.tsx");
const READY_LAYOUT = component("layout.tsx");
const BOOKED_SHELL = component("ReadyBookedShell.tsx");

/**
 * The sections under the spine, composed by the page as one `<ThreadSections>`
 * and spelled in their own file. The order and spacing rules below read them
 * there, with the same markers they read in the page before the split.
 */
const SECTIONS = component("ThreadSections.tsx");

/** How many times it appears across the page and its sections. */
function threadCountOf(marker: string): number {
  return countOf(marker) + SECTIONS.split(marker).length - 1;
}

/**
 * **The confirmation in the first paint** (UX audit #5, then UX review
 * 2026-10-10, item 7). After a booking POST the diver used to land on a
 * whole-page skeleton while the page's reads ran, at the one moment they were
 * waiting to be told it worked. The masthead and the moment once moved above
 * the thread's boundary, but still waited on the full loader, which reads the
 * departure's whole readiness roster. Now the booked card paints from one
 * narrow row (`getBookedCard`) and everything else streams under it.
 */
describe("the confirmation paints before the thread", () => {
  const page = positionOf("export default async function ReadyTokenPage");
  const readyThread = positionOf("async function DiverReadinessPage(");

  it("declines the fast path wherever a terminal card could apply", () => {
    const fastPath = SOURCE.slice(page, readyThread);
    for (const guard of [
      "!found.bookingCancelled",
      "!found.departureCancelled",
      "!theBoatIsHome(found.trip)",
    ]) {
      expect(fastPath).toContain(guard);
    }
  });
});

/**
 * **No terminal card nests inside the booked shell** (#2429). Under the booked
 * header the stream may only render what sits under it; a terminal card (it
 * paints its own `<main>`) would stack a second main beneath "You've got a
 * seat". Every such return must go through `alone(...)`, or the cancelled
 * branch's explicit exit, both of which leave for the plain URL when
 * `underBookedHeader` is set.
 */
describe("a terminal card under the booked header", () => {
  const body = SOURCE.slice(positionOf("async function DiverReadinessPage("));
  const beforeThread = body.slice(0, body.indexOf("const notice = noticeFromParam("));

  it("leaves for the plain /ready URL instead of rendering its own main", () => {
    expect(beforeThread).toContain("const alone = terminalCardIn(underBookedHeader, token)");
    const helper = component("terminal-card.ts");
    expect(helper).toContain("redirect(readinessLinkPath(token))");
    expect(helper).toContain("underBookedHeader ? leave() : card");
  });

  it("returns none of the terminal cards bare", () => {
    for (const card of [
      "<UnavailableReadyLink",
      "<HeldAfterDiveCard",
      "<RecapWaitingCard",
      "<NoShowCard",
      "<DiverIntlProvider",
    ]) {
      const bare = beforeThread.split(`return ${card}`).length - 1;
      expect(bare, card).toBe(0);
    }
    // The cancelled notice is only reached after the explicit exit.
    expect(beforeThread).toContain("return alone(null) ?? cancelledNoticeForReady(");
    expect(beforeThread).not.toContain("return cancelledNoticeForReady(");
    // And the after-dive state is wrapped.
    expect(beforeThread).toContain("return alone(\n      <DiverIntlProvider");
  });
});

/**
 * **"Anything changed?"** — ADR 20260904-reef-all-the-way-down, D15 with D19
 * folded in, and Budget rule 5 for the provenance chip.
 *
 * The panel's own behaviour is pinned in `_components/ChangedFacts.test.tsx`
 * and the step's switch in `src/lib/thread-steps.test.ts`. What only the route
 * can say is *where it sits*, *which actions its doors are bound to*, and what
 * it deliberately did not bring with it.
 */
describe("anything changed", () => {
  it("binds each door to its own token-scoped action", () => {
    for (const action of [
      "confirmCarriedFactsFromReady.bind(null, token)",
      "saveTanksFromReady.bind(null, token)",
      "saveEmergencyContactFromReady.bind(null, token)",
    ]) {
      expect(SOURCE).toContain(action);
    }
  });

  it("keeps the sensitive record out of the confirm-at-a-glance panel", () => {
    // The crew note is the diver's own words — it stays inside Day-of details
    // (#1179's privacy call). A door here bound to it would be restating it in
    // a panel built for skimming.
    const panel = SOURCE.slice(positionOf("<ChangedFacts"), positionOf('case "dayof"'));
    expect(panel).not.toContain("saveDiveRecencyFromReady");
    expect(panel).not.toContain("saveNoteFromReady");
  });
});

/**
 * **The thread's third state** — ADR 20260827-the-divers-thread, decision 4
 * (slice 7d). The behavioural rules are pinned where they can be rendered
 * (`_components/AfterState.test.tsx`) and where the switch itself lives
 * (`src/lib/thread-steps.test.ts`); what only the route can say is *where the
 * branch sits* and *which token the recap actions are handed*.
 */
describe("after the dive", () => {
  it("decides the state before it composes any of the prep page", () => {
    // Everything below the branch — the party's claim panel, the trip read the
    // packing list needs, the payment receipt — is about a day that has not
    // happened yet. Composing it and then throwing it away would be several
    // queries and one long file's worth of reasoning spent on a diver who is
    // already home.
    const after = positionOf("<AfterState");
    expect(after).toBeGreaterThan(-1);
    expect(after).toBeLessThan(positionOf("<ThreadStatus"));
  });

  it("asks the crew's own roll call before it says anybody dived", () => {
    // The switch was the clock alone until a review caught it (2026-08-28): a
    // diver who never boarded — overslept, or held at the desk on a medical
    // hold — opened the durable link already in their inbox an hour after the
    // boat was back and got "Welcome back", a printable dive record for the
    // day, and an invitation to tip the crew who dived without them.
    // `roll_call_events` is the only direct evidence DiveDay holds about who
    // got on the boat, and the page consults it before composing the afterglow.
    // The reads live beside the page (`_components/after-dive-reads.ts`), and
    // the page asks them before it composes the afterglow.
    expect(positionOf("await readAfterTheDive(db, {")).toBeGreaterThan(-1);
    expect(positionOf("await readAfterTheDive(db, {")).toBeLessThan(positionOf("<AfterState"));
    const rollCall = AFTER_DIVE_READS.indexOf("departureRollCallForBooking(db,");
    expect(rollCall).toBeGreaterThan(-1);
    expect(rollCall).toBeLessThan(AFTER_DIVE_READS.indexOf("isAfterTheDive({ endsAt, boarded })"));
    // Only once the boat is scheduled home: an ordinary night-before page load
    // never pays for the query.
    expect(AFTER_DIVE_READS).toContain("const boatIsHome = theBoatIsHome({ endsAt });");
    expect(AFTER_DIVE_READS).toMatch(/boatIsHome\s*\?\s*await departureRollCallForBooking\(/);
  });

  it("answers a canceled departure on the branch a canceled departure reaches", () => {
    // A blow-out cancels the *trip* and deliberately leaves every booking
    // active (src/db/blowouts.ts), so `detail.cancelled` is false for every
    // diver a cancellation stranded — and this page read only that. Before the
    // boat was due back it handed them a packing list; an hour after it, the
    // afterglow.
    //
    // **This assertion used to be a source *position*, and that is precisely
    // how the fix for it shipped broken.** It proved the branch was written
    // above the afterglow; it could not prove the branch was reachable, and it
    // was not: `verifyBookingCapability` fails closed on a cancelled trip
    // (`src/db/booking-capabilities.ts`), so a page that read
    // `data.departureCancelled` only *after* that call had already returned
    // told every stranded diver their link had expired. The e2e spec was the
    // one thing in the repository that could catch it.
    //
    // So the rule is where the answer sits relative to the gate, not relative
    // to the afterglow: it is inside the `!capability` block, which is the only
    // place a cancelled departure's token ever arrives.
    //
    // The block's body is `readyDeadLink` (`_components/dead-link.tsx`), called
    // from inside it and from nowhere else, so the departure check is read
    // there and the call is pinned inside the block.
    const DEAD_LINK = component("dead-link.tsx");
    const gate = positionOf("const capability = await verifyBookingCapability");
    const deadEnd = positionOf("if (!capability) {");
    const deadLink = positionOf("return readyDeadLink(");
    const liveShop = positionOf("const shopContact = {");
    for (const marker of [gate, deadEnd, deadLink, liveShop]) {
      expect(marker).toBeGreaterThan(-1);
    }
    expect(countOf("readyDeadLink(")).toBe(1);
    expect(deadEnd).toBeGreaterThan(gate);
    expect(deadLink).toBeGreaterThan(deadEnd);
    expect(deadLink).toBeLessThan(liveShop);
    expect(SOURCE.slice(deadEnd, deadLink)).not.toContain("}");
    expect(countOf("data?.departureCancelled")).toBe(0);
    expect(DEAD_LINK).toContain("data?.departureCancelled");
    // And it resolves the token the relaxed way, since the strict one is the
    // thing that refused it.
    expect(DEAD_LINK).toContain(
      'const stranded = await resolveRevokedBookingCapability(db, { token, purpose: "readiness" });',
    );
  });

  it("binds the recap actions to a recap token, never to this page's own", () => {
    // `/ready`'s token is a bearer capability that can cancel the booking and
    // move its refund; the recap actions verify a *recap* token, and the two
    // are domain-separated on purpose (src/lib/recap-links.ts). Widening
    // either side would hand a review form the power to release a seat.
    expect(SOURCE).toContain("readyAfterStateProps({");
    expect(AFTER_STATE_ACTIONS).toContain("actions: afterStateActions(token, input.bookingId)");
    expect(AFTER_STATE_ACTIONS).toContain("signRecapToken(bookingId)");
    for (const action of ["submitReviewAction", "uploadRecapPhotoAction", "startTipAction"]) {
      expect(AFTER_STATE_ACTIONS).not.toContain(`${action}.bind(null, token)`);
    }
  });

  it("uploads a recap photo through this page's own token, the one door that may share it", () => {
    // Security review of layer r5-4, F3: the forwardable recap link never
    // publishes to the boat; the readiness link's upload verifies its token.
    expect(AFTER_STATE_ACTIONS).toContain(
      "uploadPhoto: uploadRecapPhotoFromReadyAction.bind(null, token)",
    );
    expect(AFTER_STATE_ACTIONS).not.toContain("uploadRecapPhotoAction");
  });
});

/**
 * **Every "action" blocker on the sign step has something to tap** — ADR
 * 20260907-guardian-co-signature.
 *
 * `BLOCKER_CATEGORY` (src/lib/readiness-summary.ts) files a code as `"action"`
 * to say the reader can fix it *here*; the sign step then renders a button
 * only for codes it names. `guardian_signature_missing` was filed as "action"
 * and left out of that list, so a parent read "grab a fresh link and sign it
 * together" above no control at all — and the link they hold is their only way
 * in. Found by a security review of #1455; pinned here because nothing else
 * ties the two lists together.
 */
describe("the sign step's actions", () => {
  // The step's controls live in their own component since course forms joined
  // the release there (ADR 20261008-course-forms); the page hands it the step.
  const SIGN_STEP = component("SignStepActions.tsx");

  it("offers a control for every waiver blocker it calls the reader's to fix", () => {
    expect(SOURCE).toMatch(/<SignStepActions\s+token=\{token\}\s+item=\{step\.item\}/);
    for (const code of ["waiver_pending", "waiver_expired", "guardian_signature_missing"]) {
      expect(SIGN_STEP).toContain(`code === "${code}"`);
    }
  });

  it("offers the course forms' door when a form is owed", () => {
    expect(SIGN_STEP).toContain('blocker.code === "course_form_unsigned"');
    expect(SIGN_STEP).toContain("href={`/ready/${token}/forms`}");
  });

  it("asks what is owed whatever the boarding switch says (issue #2266)", () => {
    expect(SOURCE).toContain("courseFormsOwed={courseFormsOwed}");
    expect(SOURCE).toContain("getCourseFormsForBooking(db, shop.id, bookingId)");
  });
});

/**
 * **A held seat is greeted as booked** (issue #2125). The matched person's
 * name would tell the booker whose record their email reached. Readiness may
 * retry only the explicit shop-scoped opt-in receipt; it never creates global
 * remembered identity from the greeting.
 */
describe("a held seat's greeting", () => {
  it("greets the booked-as name without automatically saving identity", () => {
    // The booked card greets `getBookedCard`'s name, which applies the held
    // rule itself (src/db/ready.test.ts holds it to the full loader's).
    expect(MASTHEAD).toContain("greetingName={card.greetingName}");
    expect(MASTHEAD).toContain("firstNameOf(greetingName,");
    expect(SOURCE).not.toContain("RememberBooker");
    expect(SOURCE).not.toContain("saveReturningDiver");
    expect(BOOKED_SHELL).not.toContain("RememberBooker");
    expect(BOOKED_SHELL).not.toContain("saveReturningDiver");
    expect(READY_LAYOUT).toContain("<RetryReturningDiverMemory />");
    expect(countOf("detail.person.fullName")).toBe(0);
  });
});

/**
 * **After the dive, a held seat is not called a no-show** (security review
 * of issue #2125). The recap reads nothing for a held seat, and the null it
 * returns used to fall through to "marked as a no-show": a false fact about
 * somebody who may have dived. The held seat gets its own neutral card,
 * decided before the recap is read.
 */
describe("a held seat after the dive", () => {
  it("answers with its own card before the recap is read", () => {
    const held = positionOf("if (data.identityHeld) return alone(<HeldAfterDiveCard");
    expect(held).toBeGreaterThan(-1);
    expect(held).toBeLessThan(positionOf("await afterDive.recap()"));
    // The recap starts early beside the roll call (code review 2026-10-13,
    // item 29), but never for a held seat.
    const AFTER_DIVE_READS = component("after-dive-reads.ts");
    expect(AFTER_DIVE_READS).toContain(
      "const speculate = boatIsHome && !input.identityHeld && isAfterTheDive({ endsAt });",
    );
    expect(AFTER_DIVE_READS).toContain(
      "const recapRead = speculate ? getRecapPageState(db, bookingId) : null;",
    );
    expect(positionOf("<NoShowCard")).toBeGreaterThan(held);
  });
});

/**
 * **A released seat before the day is over** (layer 3 review, dde-1 F2 and
 * dde-2 #1). A diver the desk turned away at 07:00 used to hold a page that
 * still walked them through the checklist and the Pay step to the boat. The
 * page says the shop released the seat and to talk to the desk, before any of
 * the prep page is composed, and after the after-dive branch, which owns the
 * finished day.
 */
describe("a seat the desk released", () => {
  it("answers with its own card before the prep page, after the finished day", () => {
    const released = positionOf("if (data.seatReleased) return releasedSeat(");
    expect(released).toBeGreaterThan(positionOf("if (afterDive.afterTheDive)"));
    expect(released).toBeLessThan(positionOf("<ThreadStatus"));
  });

  /**
   * Layer 3 re-review (dde-3 #7): a party's lead turned away at the desk still
   * holds the links their party claims seats with. The card keeps the panel.
   */
  it("keeps the lead's party claim panel on the released card", () => {
    expect(SOURCE).toContain(
      "if (data.seatReleased) return releasedSeat(db, shop.id, bookingId, locale, shopContact, t);",
    );
    expect(component("AfterDiveDoors.tsx")).toMatch(
      /issuePartySeatClaims\(db, \{ shopId, leadBookingId: bookingId \}\)[\s\S]*?<ReleasedSeatCard[\s\S]*?<PartyClaimPanel/,
    );
  });
});

/** UX review 2026-10-11, item 13: "Add a seat" lives with the group's seats, and only when allowed. */
describe("adding a seat from the diver's page", () => {
  it("hands the party section the action only when the booking may lead a seat", () => {
    // The party section is one of the sections under the spine (ThreadSections).
    expect(SECTIONS).toMatch(
      /<PartySection[^>]*addSeatAction=\{data\.canAddSeat \? addSeatFromReady\.bind\(null, token\) : null\}/,
    );
    expect(threadCountOf("<AddSeat")).toBe(0);
  });
});
