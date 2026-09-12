// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PAPER_WAIVER_IDLE } from "@/lib/paper-waiver-form";
import { staffSession } from "@/test/staff-session";

/**
 * **Every door on the counter takes a session first, and something notices if
 * one stops** (`security-reviewer` pass on issue #1696).
 *
 * The gate itself was never in doubt: all six exported actions open with
 * `requireStaffSession()`, the write is scoped by `session.user.shopId`, and the
 * slug only ever reaches `shopPath`'s escaping. What was missing is anything
 * that would *fail* if a gate were deleted. The folder's own tests mock
 * `@/lib/session` wholesale — which is right for what they test, and means a
 * gateless action passes them — the check-in folder had no authz roster, and no
 * repository guard enumerates server actions' session calls. So the reviewer's
 * finding was about the test suite, not the code: on the evidence, deleting the
 * line left everything green.
 *
 * Two nets, because each catches what the other cannot:
 *
 * 1. **The roster**, read off the source the way
 *    `../trips/[id]/actions.authz.test.ts` reads its own: every `export async
 *    function` is sliced from its signature to the closing brace at column
 *    zero, and filed by the gate its *body* carries. Read from the file rather
 *    than from the module's exports, for that file's reason — a `const` arrow
 *    export would slip past the module's shape, and the point is that nothing
 *    new lands here without an answer.
 * 2. **The behaviour**, below it: with the session refused, every action has to
 *    refuse too, and none of them may reach the database. That is the half a
 *    text scan cannot see, and it is what makes a deleted gate loud rather than
 *    merely unrecorded.
 *
 * There is no role list to check here. The counter's actions are the day's work
 * — arrivals, a seat given back, a release signed on paper, an identity
 * attested — and `src/lib/authz.ts` is explicit that those stay open to every
 * live staff role; `requireStaffSession` re-reads the account on every call, so
 * "live" is a fact and not a 30-day-old claim (issue #701).
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const {
  checkInAction,
  confirmIdentityFromCheckIn,
  markNoShowAction,
  markWaiverInPersonFromCheckIn,
  undoCheckInAction,
  undoNoShowAction,
} = await import("./actions");

const SHOP_SLUG = "reef-life";
const FOCUS_TRIP_ID = "33333333-3333-4333-8333-333333333333";
/** A *well-formed* id on purpose: a malformed one is refused before the
 * database is reached, which would hide a missing gate rather than expose it. */
const BOOKING_ID = "55555555-5555-4555-8555-555555555555";

describe("who may run each action at the counter", () => {
  /**
   * The only gate on this surface: a live staff session, re-read on every call.
   * A second list would mean a second kind of gate, and there is none — a new
   * one arrives as a new list here, not as an entry on this one.
   */
  const STAFF_SESSION = [
    "checkInAction",
    "undoCheckInAction",
    "markNoShowAction",
    "undoNoShowAction",
    "markWaiverInPersonFromCheckIn",
    "confirmIdentityFromCheckIn",
  ];

  /** Every exported action's source, sliced from its `export` to its closing brace. */
  function actionBodies(): Map<string, string> {
    const source = readFileSync(
      new URL("./actions.ts", import.meta.url).pathname.replace(/%5B/g, "[").replace(/%5D/g, "]"),
      "utf8",
    );
    const bodies = new Map<string, string>();
    for (const match of source.matchAll(/^export async function (\w+)/gm)) {
      const name = match[1];
      if (!name || match.index === undefined) continue;
      // A top-level function's closing brace is the only `}` at column zero
      // after it, because everything nested is indented. Brace-counting from
      // the signature is the obvious alternative and it is wrong here: a return
      // type of `Promise<{ ok: true }>` opens a brace before the body does —
      // which is how three of these six are written.
      const end = source.indexOf("\n}\n", match.index);
      bodies.set(name, source.slice(match.index, end === -1 ? undefined : end));
    }
    return bodies;
  }

  /**
   * Which list an action's body puts it in, read from the source.
   *
   * `requireShopSurface` is named as well as `requireStaffSession`, even though
   * nothing here uses it: it is the *other* staff gate in the app (the roster's
   * actions take it), and an action that switched to it would otherwise read as
   * ungated to a scan looking for one spelling.
   */
  function gateInBody(body: string): string {
    if (/await requireShopSurface\(/.test(body)) return "SHOP_SURFACE";
    if (/await requireStaffSession\(\)/.test(body)) return "STAFF_SESSION";
    return "UNGATED";
  }

  it("files every exported action under the gate its own body carries", () => {
    const recorded = new Map<string, string>(
      STAFF_SESSION.map((name) => [name, "STAFF_SESSION"] as const),
    );
    const bodies = actionBodies();

    expect([...bodies.keys()].filter((name) => !recorded.has(name))).toEqual([]);
    expect([...recorded.keys()].filter((name) => !bodies.has(name))).toEqual([]);

    const actual = Object.fromEntries([...bodies].map(([name, body]) => [name, gateInBody(body)]));
    expect(actual).toEqual(Object.fromEntries(recorded));
  });

  /**
   * **And the gate is taken before the database is opened.** Every one of these
   * spends `session.user.shopId` in the `where` of the write it makes, so a gate
   * that ran *after* the read would be scoping a query by a value it had not yet
   * proved — the shape of the bug this ordering rules out.
   */
  it("takes the session before it reaches the database", () => {
    for (const [name, body] of actionBodies()) {
      const gate = body.indexOf("requireStaffSession()");
      const db = body.indexOf("getDb()");
      expect(gate, name).toBeGreaterThan(-1);
      if (db === -1) continue;
      expect(gate, name).toBeLessThan(db);
    }
  });
});

/**
 * The same six, refused. `requireStaffSession` throws for a caller who is not
 * this shop's live staff — a redirect to sign-in, or `notFound()` for a stale
 * tenant claim (`src/lib/session.ts`) — and an action that swallowed that, or
 * never called it, would read the database anyway.
 */
describe("a refused session at the counter", () => {
  /**
   * One invoker per exported action, because their signatures differ: the
   * paper-waiver door is a `useActionState` reducer and the identity door
   * carries the queue's search. Checked for exhaustiveness against the source
   * in the roster above, so a seventh action cannot arrive without one.
   */
  const INVOKE: Record<string, (form: FormData) => Promise<unknown>> = {
    checkInAction: (form) => checkInAction(SHOP_SLUG, FOCUS_TRIP_ID, form),
    undoCheckInAction: (form) => undoCheckInAction(SHOP_SLUG, FOCUS_TRIP_ID, form),
    markNoShowAction: (form) => markNoShowAction(SHOP_SLUG, FOCUS_TRIP_ID, form),
    undoNoShowAction: (form) => undoNoShowAction(SHOP_SLUG, FOCUS_TRIP_ID, form),
    markWaiverInPersonFromCheckIn: (form) =>
      markWaiverInPersonFromCheckIn(SHOP_SLUG, FOCUS_TRIP_ID, PAPER_WAIVER_IDLE, form),
    confirmIdentityFromCheckIn: (form) =>
      confirmIdentityFromCheckIn(SHOP_SLUG, FOCUS_TRIP_ID, null, form),
  };

  function bookingForm(): FormData {
    const form = new FormData();
    form.set("bookingId", BOOKING_ID);
    // The paper-waiver door needs its attestation; the gate must refuse before
    // anything on the form is read at all.
    form.set("medicalAttested", "on");
    return form;
  }

  it.each(Object.keys(INVOKE))("%s refuses without reading anything", async (name) => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error("a gated action must not reach the database");
    });
    vi.mocked(requireStaffSession).mockRejectedValue(new Error("REDIRECT:/sign-in"));
    const invoke = INVOKE[name];
    if (!invoke) throw new Error(`no invoker for ${name}`);

    await expect(invoke(bookingForm())).rejects.toThrow("REDIRECT:/sign-in");
    expect(getDb).not.toHaveBeenCalled();
  });

  /**
   * The negative control for the case above: with a session granted, the very
   * next thing each of them does is open the database. Without this, an action
   * that had lost its gate *and* its write would pass the refusal case for the
   * wrong reason.
   */
  it.each(Object.keys(INVOKE))("%s does reach the database once signed in", async (name) => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error("reached the database");
    });
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({
        shopId: "11111111-1111-4111-8111-111111111111",
        shopSlug: SHOP_SLUG,
        personId: "22222222-2222-4222-8222-222222222222",
      }),
    );
    const invoke = INVOKE[name];
    if (!invoke) throw new Error(`no invoker for ${name}`);

    await expect(invoke(bookingForm())).rejects.toThrow("reached the database");
  });
});
