// biome-ignore-all lint/suspicious/noTemplateCurlyInString: every string here is a
// source-code fixture, and the `${…}` in it is the interpolation the rule under test
// must decline to read a literal code out of. Making them real template literals would
// substitute the very thing being asserted about.

import { describe, expect, it } from "vitest";

import {
  findNoticeCodes,
  findNoticeCodeViolations,
  findNoticeMapKeys,
  noticeSinks,
} from "./check-notice-codes.mjs";

/**
 * The rule is only worth having if it sees all three shapes a notice code is
 * written in and none of the several near-misses that share their spelling.
 * Both halves have already been wrong once: the `noticeUrl(…)` scan shipped as
 * dead code (it tested `regex.matchAll`, which is not a method, so the branch
 * evaluated to `[]` and the shape was never checked at all), and the raw
 * `notice=` scan first flagged JSX props and prose placeholders.
 */

const codes = (source) => findNoticeCodes(source).map((found) => found.code);
const refused = (source) => findNoticeCodeViolations(source).map((found) => found.code);

describe("the raw query string", () => {
  it("reads a code written out in a template literal", () => {
    expect(codes("redirect(`${back}?notice=not-ready&bid=1`)")).toEqual(["not-ready"]);
  });

  it("refuses snake_case", () => {
    expect(refused("redirect(`${back}?notice=not_ready`)")).toEqual(["not_ready"]);
    expect(refused("redirect(`${settings}?notice=rental_prices_saved&saved=x`)")).toEqual([
      "rental_prices_saved",
    ]);
  });

  it("refuses a code that shouts", () => {
    expect(refused("?notice=NotAuthorized")).toEqual(["NotAuthorized"]);
  });

  it("skips an interpolated value — `noticeCode` normalises those at the one door", () => {
    expect(codes("redirect(`${back}?notice=${outcome.reason}`)")).toEqual([]);
    expect(codes("`${back}?notice=${saved ? 'a' : 'b'}`")).toEqual([]);
  });

  it("skips the prose and JSX that share the spelling", () => {
    // Each of these is real text from the tree.
    expect(codes("<NoticeBanner notice={pageNotice} />")).toEqual([]);
    expect(codes(" * redirecting back with `?notice=<code>&saved=<section>`")).toEqual([]);
    expect(codes(" * so `?notice=shown|hidden` is enough").slice(0, 1)).toEqual(["shown"]);
    expect(codes('"never walks the prototype for ?notice=%s"')).toEqual([]);
    expect(codes(" * The `?notice=` -> banner plumbing every page repeats")).toEqual([]);
  });
});

describe("the noticeUrl argument", () => {
  it("reads the code past a nested call in the first argument", () => {
    expect(codes('redirect(noticeUrl(shopPath(slug, "orders"), "not-authorized"))')).toEqual([
      "not-authorized",
    ]);
  });

  it("refuses snake_case there too — the shape everything migrated onto", () => {
    expect(
      refused('redirect(noticeUrl(settings, "packing_invalid", { saved: "packing" }))'),
    ).toEqual(["packing_invalid"]);
  });

  it("reads past a template literal first argument carrying its own comma-free query", () => {
    expect(
      codes('revalidateAndRedirect(back, noticeUrl(`${back}${anchor}`, "last-minute-sent"))'),
    ).toEqual(["last-minute-sent"]);
  });

  it("skips a computed code, which is a runtime value like any other", () => {
    expect(codes("revalidateAndRedirect(path, noticeUrl(path, notice))")).toEqual([]);
    expect(codes("noticeUrl(path, outcome.reason)")).toEqual([]);
  });

  /**
   * **Both branches of a conditional are codes.** This used to answer nothing
   * here, on the reading that a ternary is "a runtime value like any other" —
   * but the value is computed and the *codes* are right there in the source,
   * and `src/app/shop/**` writes a dozen of them (`noticeUrl(path, deleted ?
   * "shift-deleted" : "invalid", at)`). Every one was unchecked (issue #1768).
   */
  it("reads both branches of a conditional in the notice position", () => {
    expect(codes('noticeUrl(back, saved ? "conditions" : "invalid")')).toEqual([
      "conditions",
      "invalid",
    ]);
    expect(refused('noticeUrl(back, saved ? "conditions" : "not_saved")')).toEqual(["not_saved"]);
  });

  it("leaves a domain reason being compared in that conditional alone", () => {
    // The condition tests `src/db`'s own snake_case vocabulary, which never
    // reaches a URL: `outcome.reason === "not_checked_in" ? "not-bookable" :
    // outcome.reason`. Reading it as a code would refuse eight correct call
    // sites, and a guard that cries wolf gets routed around.
    expect(
      codes('noticeUrl(back, outcome.reason === "not_checked_in" ? "x" : outcome.reason)'),
    ).toEqual(["x"]);
    expect(codes('noticeUrl(home, stored.status === "not_configured" ? "a" : "b")')).toEqual([
      "a",
      "b",
    ]);
  });

  it("leaves a literal one call deeper alone", () => {
    // At that depth the literal belongs to the inner call's vocabulary.
    expect(codes('noticeUrl(path, codeFor(outcome, "raw_thing"))')).toEqual([]);
  });

  it("does not fall over on a call with only one argument", () => {
    expect(codes("noticeUrl(path)")).toEqual([]);
  });

  it("reports the line the call starts on", () => {
    const source = ["const a = 1;", "const b = 2;", 'redirect(noticeUrl(p, "bad_code"));'].join(
      "\n",
    );
    expect(findNoticeCodeViolations(source)).toEqual([
      { code: "bad_code", line: 3, shape: 'noticeUrl(…, "bad_code")' },
    ]);
  });
});

describe("the reader side", () => {
  /**
   * The regression that added this shape. The 2026-08-15 migration renamed the
   * key in the walk-in page's `NOTICE_KEYS` and left the comparison two lines
   * below it, so the counter's "which card is missing" sentence silently fell
   * back to the generic one. Nothing was red; a security review found it.
   */
  it("refuses a comparison left behind by a rename", () => {
    expect(refused('notice === "walkin_trip_prerequisite"')).toEqual(["walkin_trip_prerequisite"]);
  });

  it("reads the comparison whatever the variable is called", () => {
    expect(codes('const x = notice === "saved" ? 1 : 2;')).toEqual(["saved"]);
    expect(codes('query.notice !== "shift-deleted"')).toEqual(["shift-deleted"]);
    expect(codes('builderNotice === "series-error"')).toEqual(["series-error"]);
  });

  it("leaves comparisons that are not about a notice alone", () => {
    // Every one of these is a real enum comparison in the tree.
    expect(codes('outcome.reason === "not_ready"')).toEqual([]);
    expect(codes('diver.messageStatus === "no_email"')).toEqual([]);
    expect(codes('account?.status !== "active"')).toEqual([]);
  });
});

describe("the URL-object spelling", () => {
  it("reads a code set through searchParams", () => {
    expect(codes('settingsUrl.searchParams.set("notice", "not-authorized");')).toEqual([
      "not-authorized",
    ]);
  });

  it("refuses snake_case there — the Stripe Connect callbacks' own shape", () => {
    expect(refused(`url.searchParams.set('notice', 'not_authorized')`)).toEqual(["not_authorized"]);
  });

  it("ignores a different param set the same way", () => {
    expect(codes('url.searchParams.set("saved", "packing_list");')).toEqual([]);
  });
});

/**
 * **A page-local helper that forwards to `noticeUrl` is a notice sink.**
 *
 * `done(path, notice)` in the WhatsApp settings actions, `done(path, notice,
 * reason?)` in the export actions and `backTo(base, notice, form?, card?)` on
 * the diver record carry about 60 literals between them, and the guard saw none
 * of them: shape 2 reads a literal passed *directly* to `noticeUrl`, and these
 * pass a variable. A snake_case code sat on the WhatsApp page and worked,
 * because `noticeCode` lower-cases and replaces underscores on the way through
 * — one code with two spellings in the tree, which is the fork this rule exists
 * to prevent, one indirection to the left (issue #1768).
 *
 * The rule is syntactic by design: no dataflow, and anything it cannot read it
 * declines to judge, because a false refusal is worse than a miss.
 */
describe("a page-local helper that forwards to noticeUrl", () => {
  const whatsAppShape = [
    "function done(path: string, notice: Notice | WhatsAppConnectRefusal): never {",
    "  revalidateAndRedirect(path, noticeUrl(path, notice));",
    "}",
  ].join("\n");

  it("checks a literal passed through it, at the forwarded position", () => {
    const source = `${whatsAppShape}\ndone(path, "signup_failed_exchange");`;
    expect(refused(source)).toEqual(["signup_failed_exchange"]);
    expect(findNoticeCodeViolations(source)[0]).toMatchObject({
      line: 4,
      shape: 'done(…, "signup_failed_exchange") → noticeUrl',
    });
  });

  it("reads the arrow-function spelling of the same helper", () => {
    const source = [
      "const done = (path: string, notice: Notice) => {",
      "  revalidateAndRedirect(path, noticeUrl(path, notice));",
      "};",
      'done(path, "test_failed");',
    ].join("\n");
    expect(refused(source)).toEqual(["test_failed"]);
  });

  it("reads a conditional passed through it", () => {
    const source = `${whatsAppShape}\ndone(path, saved ? "captured" : "invalid");`;
    expect(codes(source)).toEqual(["captured", "invalid"]);
  });

  /**
   * **The trap.** `backTo(base, "invalid", "notes")`'s third argument is a
   * *form* name, and its fourth a card; neither is a notice code. A rule that
   * judged every literal passed to a recognised sink would start refusing the
   * first form somebody named `time_of_day`. Only the forwarded parameter's own
   * position is checked.
   */
  it("judges only the forwarded argument, not the helper's other literals", () => {
    const source = [
      "function backTo(base: string, notice: string, form?: string, card?: string) {",
      "  return noticeUrl(`${base}${anchor}`, notice, { form, card });",
      "}",
      'backTo(base, "note-added", "notes", "gear_and_sizes");',
    ].join("\n");
    expect(codes(source)).toEqual(["note-added"]);
    expect(refused(source)).toEqual([]);
  });

  it("says nothing about a helper whose signature it cannot read plainly", () => {
    // A destructured parameter makes positions a guess, and a guessed position
    // is a false refusal waiting to happen — so the helper goes unseen instead.
    const source = [
      "function done({ path, notice }: Args): never {",
      "  revalidateAndRedirect(path, noticeUrl(path, notice));",
      "}",
      'done(path, "signup_failed");',
    ].join("\n");
    expect(codes(source)).toEqual([]);
  });

  it("does not turn an unrelated function into a sink", () => {
    // `noticeUrl`'s own second argument here is a local, not a parameter of the
    // function above it, so nothing becomes a sink and nothing is judged.
    const source = [
      "function saveThing(path: string, formData: FormData) {",
      "  const notice = resolve(formData);",
      "  revalidateAndRedirect(path, noticeUrl(path, notice));",
      "}",
      'saveThing(path, "not_a_notice");',
    ].join("\n");
    expect(codes(source)).toEqual([]);
  });

  it("exposes the sinks it found, so the rule is inspectable", () => {
    expect([...noticeSinks(whatsAppShape)]).toEqual([["done", 1]]);
  });
});

/**
 * The destination half (issue #1845). `noticeUrl` writes every code kebab, so a
 * map keyed `"import-no_gear_column"` matches nothing and the page renders no
 * banner at all. Both importers shipped exactly that.
 */
describe("a notice map's keys", () => {
  const mapKeys = (source) => findNoticeMapKeys(source).map((found) => found.code);

  const gearImportShape = [
    "const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {",
    '  "import-no_gear_column": { tone: "danger", key: "settings.gearImport.noGearColumn" },',
    '  imported: { tone: "success", key: "settings.gearImport.imported" },',
    "};",
    "export default function Page({ notice }: { notice?: string }) {",
    "  const banner = noticeFromParam(notice, NOTICES);",
    "}",
  ].join("\n");

  it("refuses a snake_case key in a map read through noticeFromParam", () => {
    expect(refused(gearImportShape)).toEqual(["import-no_gear_column"]);
  });

  it("reads every top-level key, quoted or bare, and names its line", () => {
    expect(findNoticeMapKeys(gearImportShape)).toEqual([
      expect.objectContaining({ code: "import-no_gear_column", line: 2 }),
      expect.objectContaining({ code: "imported", line: 3 }),
    ]);
  });

  it("finds a map passed to noticeFromParam whatever its values look like", () => {
    const source = [
      "const RESCUE_NOTICES = {",
      '  sent_again: "ready.rescue.sentAgain",',
      "};",
      "const notice = noticeFromParam(sent, RESCUE_NOTICES);",
    ].join("\n");
    expect(refused(source)).toEqual(["sent_again"]);
  });

  it("finds a notice-typed map by its shape when nothing passes it to noticeFromParam", () => {
    const source = [
      "const DESK_NOTICES = {",
      '  "walkin_saved": { tone: "success", key: "trips.notices.walkinSaved" },',
      "} satisfies Record<string, { tone: NoticeTone; key: StaffMessageKey }>;",
      "const OTHER: Record<string, FormNotice> = {",
      '  crew_saved: { tone: "success", key: "trips.notices.crewSaved", form: "crew" },',
      "};",
    ].join("\n");
    // The `satisfies` form carries its type after the literal, out of the
    // declaration's reach, so only the annotated one is judged by shape.
    expect(refused(source)).toEqual(["crew_saved"]);
  });

  it("leaves a badge map alone, which has the same shape and is keyed by a status", () => {
    const source = [
      "const MESSAGE_BADGE: Record<Status, { tone: BadgeTone; key: StaffMessageKey }> = {",
      '  no_email: { tone: "neutral", key: "blowout.record.messageNoEmail" },',
      "};",
    ].join("\n");
    expect(mapKeys(source)).toEqual([]);
  });

  it("leaves a domain-enum map alone, whatever its keys are spelled", () => {
    const source = [
      "const REASON_LABEL: Record<Reason, StaffMessageKey> = {",
      '  not_checked_in: "today.reasons.notCheckedIn",',
      '  medical_hold: "today.reasons.medicalHold",',
      "};",
    ].join("\n");
    expect(mapKeys(source)).toEqual([]);
  });

  it("skips a spread and a computed key rather than guessing at them", () => {
    const source = [
      "const NOTICES: Record<string, FormNotice> = {",
      "  ...SHARED_NOTICES,",
      '  [dynamicKey]: { tone: "danger", key: "x.y" },',
      '  saved: { tone: "success", key: "x.saved" },',
      "};",
      "noticeFromParam(notice, NOTICES);",
    ].join("\n");
    expect(mapKeys(source)).toEqual(["saved"]);
  });
});
