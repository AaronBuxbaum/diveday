// @vitest-environment jsdom
import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The extension's form filler (`extension/fill.js`), on stand-in forms. The
 * agencies publish nothing about their forms, so the filler finds each box by
 * what it says about itself. These pin the two promises that matter: it fills
 * what it can name, and when a box the lookup needs is missing it submits
 * nothing.
 */
/** The extension's scripts are classic scripts, not modules: loading one sets its globals. */
async function loadExtensionScript(file: string): Promise<void> {
  await import(/* @vite-ignore */ new URL(`../../extension/${file}`, import.meta.url).href);
}
await loadExtensionScript("protocol.js");
await loadExtensionScript("fill.js");
await loadExtensionScript("agencies.js");
const extension = (
  globalThis as unknown as {
    DiveDayCertCheck: {
      fillAgencyForm: (
        query: unknown,
        spec: unknown,
        signInPath?: string,
      ) => { ok: true } | { ok: false; missing: string[] };
      fillSsiManualForm: (query: unknown, sample?: boolean) => boolean;
      pageAsksToSignIn: (signInPath?: string) => boolean;
      AGENCIES: Record<string, unknown>;
      ELEARNING: Record<string, unknown>;
      SIGN_IN_PATH: string;
    };
  }
).DiveDayCertCheck;
const { AGENCIES, ELEARNING, SIGN_IN_PATH } = extension;
/** The filler as the service worker calls it, with the sign-in rule from protocol.js. */
const fillAgencyForm = (query: unknown, spec: unknown) =>
  extension.fillAgencyForm(query, spec, SIGN_IN_PATH);

const lena = {
  firstName: "Lena",
  lastName: "Ortiz",
  birthDate: "1990-04-12",
  cardNumber: "123456",
};

function submitted() {
  const form = document.querySelector("form");
  if (!form) throw new Error("no form");
  const spy = vi.fn((event: Event) => event.preventDefault());
  form.addEventListener("submit", spy);
  return spy;
}

function value(selector: string) {
  return (document.querySelector(selector) as HTMLInputElement | HTMLSelectElement).value;
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("fillAgencyForm", () => {
  it("waits for the staffer to accept SSI's terms before filling the revealed form", async () => {
    document.body.innerHTML = `<form><input id="terms" type="checkbox">
      <div id="details" style="display:none"><label for="first">First Name</label><input id="first">
      <label for="last">Last Name</label><input id="last"><label for="dob">Birthday</label><input id="dob" type="date">
      <button type="submit">Submit Search</button></div></form>`;
    const onSubmit = submitted();
    const terms = document.querySelector("#terms") as HTMLInputElement;
    const details = document.querySelector("#details") as HTMLElement;
    terms.addEventListener("change", () => {
      details.style.display = terms.checked ? "block" : "none";
    });
    expect(extension.fillSsiManualForm(lena, true)).toBe(true);
    expect(terms.checked).toBe(false);
    expect(value("#first")).toBe("");
    terms.click();
    await waitFor(() => expect(value("#dob")).toBe("1990-04-12"));
    expect(value("#first")).toBe("Lena");
    expect(value("#last")).toBe("Ortiz");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not fill any field when a visible existing name conflicts", async () => {
    document.body.innerHTML = `<form><div id="details" style="display:none">
      <label>First Name<input id="first"></label><label>Last Name<input id="last"></label>
      <label>Birthday<input id="dob" type="date"></label></div></form>`;
    expect(extension.fillSsiManualForm(lena, true)).toBe(true);
    (document.querySelector("#first") as HTMLInputElement).value = "Elena";
    (document.querySelector("#details") as HTMLElement).style.display = "block";
    await Promise.resolve();
    expect(value("#first")).toBe("Elena");
    expect(value("#last")).toBe("");
    expect(value("#dob")).toBe("");
  });

  it("stops waiting when staff edit a field before the rest appear", async () => {
    document.body.innerHTML = `<form>
      <label>First Name<input id="first"></label><label>Last Name<input id="last"></label>
      <div id="date" style="display:none"><label>Birthday<input id="dob" type="date"></label></div></form>`;
    expect(extension.fillSsiManualForm(lena, true)).toBe(true);
    expect(value("#first")).toBe("");
    const first = document.querySelector("#first") as HTMLInputElement;
    first.value = "Elena";
    first.dispatchEvent(new Event("input", { bubbles: true }));
    (document.querySelector("#date") as HTMLElement).style.display = "block";
    await Promise.resolve();
    expect(value("#first")).toBe("Elena");
    expect(value("#last")).toBe("");
    expect(value("#dob")).toBe("");
  });

  it("does not mix names with an SSI Master ID already in the form", () => {
    document.body.innerHTML = `<form><label>First Name<input id="first"></label><label>Last Name<input id="last"></label>
      <input id="verify-mid" type="number" value="123456"><label>Birthday<input id="dob" type="date"></label></form>`;
    expect(extension.fillSsiManualForm(lena, true)).toBe(true);
    expect(value("#first")).toBe("");
    expect(value("#last")).toBe("");
    expect(value("#dob")).toBe("");
  });

  it("stops waiting after two minutes without filling later changes", async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `<form><div id="details" style="display:none">
        <label>First Name<input id="first"></label><label>Last Name<input id="last"></label></div></form>`;
      expect(extension.fillSsiManualForm(lena, true)).toBe(true);
      vi.advanceTimersByTime(120_000);
      (document.querySelector("#details") as HTMLElement).style.display = "block";
      await Promise.resolve();
      expect(value("#first")).toBe("");
      expect(value("#last")).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });
  it("fills SSI's name and known birthday without accepting terms or submitting", () => {
    document.body.innerHTML = `
      <form><input type="checkbox" id="terms">
        <label for="first">First Name</label><input id="first">
        <label for="last">Last Name</label><input id="last">
        <label for="birthday">Birthday</label><input id="birthday" type="date">
        <button type="submit">Submit Search</button></form>`;
    const onSubmit = submitted();
    expect(extension.fillSsiManualForm(lena, true)).toBe(true);
    expect(value("#first")).toBe("Lena");
    expect(value("#last")).toBe("Ortiz");
    expect(value("#birthday")).toBe("1990-04-12");
    expect((document.querySelector("#terms") as HTMLInputElement).checked).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("leaves SSI untouched when an expected field is ambiguous", () => {
    document.body.innerHTML = `<form><label>First Name<input></label><label>First Name<input></label>
      <label>Last Name<input></label><label>Birthday<input type="date"></label><button>Search</button></form>`;
    expect(extension.fillSsiManualForm(lena, true)).toBe(true);
    expect(Array.from(document.querySelectorAll("input")).every((box) => box.value === "")).toBe(
      true,
    );
  });

  it("never fills a page outside SSI's lookup, even if its form looks right", () => {
    document.body.innerHTML = `<form><label>First Name<input id="first"></label><label>Last Name<input id="last"></label><button>Search</button></form>`;
    expect(extension.fillSsiManualForm(lena)).toBe(false);
    expect(value("#first")).toBe("");
    expect(value("#last")).toBe("");
  });

  it("fills names when no birthday is known", () => {
    document.body.innerHTML = `<form><label>First Name<input id="first"></label><label>Last Name<input id="last"></label><button>Search</button></form>`;
    expect(extension.fillSsiManualForm({ ...lena, birthDate: null }, true)).toBe(true);
    expect(value("#first")).toBe("Lena");
    expect(value("#last")).toBe("Ortiz");
  });
  it("fills first name, last name and a typed birth date in the agency's format, then submits", () => {
    document.body.innerHTML = `
      <form>
        <label for="f">First Name</label><input id="f" name="fname">
        <label for="l">Last Name</label><input id="l" name="lname">
        <label for="d">Date of Birth</label><input id="d" name="dob">
        <button type="submit">Search</button>
      </form>`;
    const onSubmit = submitted();

    expect(
      fillAgencyForm(lena, { fields: ["name", "birthDate"], dateFormat: "MM/DD/YYYY" }),
    ).toEqual({ ok: true });

    expect(value("#f")).toBe("Lena");
    expect(value("#l")).toBe("Ortiz");
    expect(value("#d")).toBe("04/12/1990");
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  /** Domain review R7 (adversarial) 6: only a captcha on the lookup's own form stops it. */
  it("types nothing into a lookup whose own form asks whether the staffer is human", () => {
    document.body.innerHTML = `
      <form>
        <input name="first_name"><input name="last_name"><input name="dob">
        <div class="g-recaptcha"><iframe src="https://www.google.com/recaptcha/api2/anchor?k=1"></iframe></div>
        <button type="submit">Search</button>
      </form>`;
    const onSubmit = submitted();
    expect(
      fillAgencyForm(lena, { fields: ["name", "birthDate"], dateFormat: "MM/DD/YYYY" }),
    ).toEqual({ ok: false, missing: ["captcha"] });
    expect(value('[name="first_name"]')).toBe("");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("fills a lookup when the captcha is on another form, or draws no box, or is only a badge", () => {
    for (const elsewhere of [
      `<form><input type="email" name="newsletter"><div class="g-recaptcha"><iframe src="https://www.google.com/recaptcha/api2/anchor?k=1"></iframe></div><button>Subscribe</button></form>`,
      `<div class="cf-turnstile"></div>`,
      `<div class="g-recaptcha"><div class="grecaptcha-badge"><iframe src="https://www.google.com/recaptcha/api2/anchor?k=1&size=invisible"></iframe></div></div>`,
    ]) {
      document.body.innerHTML = `
        <form id="lookup">
          <input name="first_name"><input name="last_name"><input name="dob">
          ${elsewhere.includes("newsletter") ? "" : elsewhere}
          <button type="submit">Search</button>
        </form>
        ${elsewhere.includes("newsletter") ? elsewhere : ""}`;
      const form = document.getElementById("lookup") as HTMLFormElement;
      const onSubmit = vi.fn((event: Event) => event.preventDefault());
      form.addEventListener("submit", onSubmit);
      expect(
        fillAgencyForm(lena, { fields: ["name", "birthDate"], dateFormat: "MM/DD/YYYY" }),
        elsewhere,
      ).toEqual({ ok: true });
      expect(onSubmit, elsewhere).toHaveBeenCalledOnce();
    }
  });

  /** Domain review R7 (adversarial) 7: a page with no box yet is not a changed page. */
  it("says there is no form yet when the page has no box to type into", () => {
    document.body.innerHTML = `<h1>Just a moment…</h1><p>Checking your browser.</p>`;
    expect(
      fillAgencyForm(lena, { fields: ["name", "birthDate"], dateFormat: "MM/DD/YYYY" }),
    ).toEqual({ ok: false, missing: ["form"] });
  });

  it("uses a date picker's own format", () => {
    document.body.innerHTML = `
      <form>
        <input type="date" aria-label="Birthdate">
        <input placeholder="Given name"><input placeholder="Family name">
        <button>Manual Search</button>
      </form>`;
    submitted();
    fillAgencyForm(lena, { fields: ["birthDate", "name"], dateFormat: "MM/DD/YYYY" });
    expect(value('input[type="date"]')).toBe("1990-04-12");
  });

  it("fills month, day and year boxes when the birth date is split", () => {
    document.body.innerHTML = `
      <form>
        <input name="first_name"><input name="last_name">
        <select name="birth_month"><option value="">Month</option><option value="4">April</option></select>
        <select name="birth_day"><option value="12">12</option></select>
        <select name="birth_year"><option value="1990">1990</option></select>
        <input type="submit" value="Verify">
      </form>`;
    submitted();
    expect(
      fillAgencyForm(lena, { fields: ["name", "birthDate"], dateFormat: "YYYY-MM-DD" }),
    ).toEqual({ ok: true });
    expect(value('[name="birth_month"]')).toBe("4");
    expect(value('[name="birth_day"]')).toBe("12");
    expect(value('[name="birth_year"]')).toBe("1990");
  });

  it("types the whole name into a single name box", () => {
    document.body.innerHTML = `
      <form><input name="name"><input name="card_number"><button>Check</button></form>`;
    submitted();
    fillAgencyForm(lena, { fields: ["name", "number"], dateFormat: "YYYY-MM-DD" });
    expect(value('[name="name"]')).toBe("Lena Ortiz");
    expect(value('[name="card_number"]')).toBe("123456");
  });

  it("submits nothing when a box the lookup needs is not there", () => {
    document.body.innerHTML = `
      <form><input name="first_name"><input name="last_name"><button>Search</button></form>`;
    const onSubmit = submitted();
    expect(
      fillAgencyForm(lena, { fields: ["name", "birthDate"], dateFormat: "YYYY-MM-DD" }),
    ).toEqual({ ok: false, missing: ["birthDate"] });
    expect(onSubmit).not.toHaveBeenCalled();
    // Nothing is typed until everything the lookup needs is found.
    for (const box of document.querySelectorAll("input")) expect(box.value).toBe("");
  });

  it("never types into a hidden box", () => {
    document.body.innerHTML = `
      <form><input type="hidden" name="card_number"><button>Verify</button></form>`;
    // No box a person could type into: a form not drawn yet, never a changed one.
    expect(fillAgencyForm(lena, { fields: ["number"], dateFormat: "YYYY-MM-DD" })).toEqual({
      ok: false,
      missing: ["form"],
    });
    expect(value('[name="card_number"]')).toBe("");
    document.body.innerHTML = `
      <form><input type="hidden" name="card_number"><input name="q"><button>Verify</button></form>`;
    expect(fillAgencyForm(lena, { fields: ["number"], dateFormat: "YYYY-MM-DD" })).toEqual({
      ok: false,
      missing: ["number"],
    });
    expect(value('[name="card_number"]')).toBe("");
  });

  it("searches CMAS by code when there is one, and by name and birth date when not", () => {
    const cmas = {
      fields: ["number", "name", "birthDate"],
      dateFormat: "YYYY-MM-DD",
      either: true,
    };
    document.body.innerHTML = `
      <form><input aria-label="CMAS Code"><button>Search by code</button></form>`;
    submitted();
    expect(fillAgencyForm(lena, cmas)).toEqual({ ok: true });
    expect(value("input")).toBe("123456");

    document.body.innerHTML = `
      <form>
        <input aria-label="Given Name"><input aria-label="Family Name">
        <input type="date" aria-label="Birthdate"><button>Manual Search</button>
      </form>`;
    submitted();
    expect(fillAgencyForm({ ...lena, cardNumber: null }, cmas)).toEqual({ ok: true });
    expect(value('[aria-label="Family Name"]')).toBe("Ortiz");
  });

  /** CMAS's portal: one page, "Search by code" above "Manual Search" (read 2026-10-15). */
  const cmasPortal = (wrap: (inner: string) => string) => `
    ${wrap(`<input aria-label="CMAS Code"><button id="by-code">Search by code</button>`)}
    ${wrap(`<input aria-label="Given Name"><input aria-label="Family Name">
      <input aria-label="Birthdate"><button id="manual">Manual Search</button>`)}`;
  const cmasSpec = AGENCIES.cmas;
  const pressed = () => {
    const clicks: string[] = [];
    for (const id of ["by-code", "manual"]) {
      document.getElementById(id)?.addEventListener("click", (event) => {
        event.preventDefault();
        clicks.push(id);
      });
    }
    return clicks;
  };

  it.each([
    ["one form for both searches", (inner: string) => inner, true],
    ["no form at all", (inner: string) => `<div>${inner}</div>`, false],
  ])("presses CMAS's Search by code for a card number, on %s", (_, wrap, oneForm) => {
    document.body.innerHTML = oneForm ? `<form>${cmasPortal(wrap)}</form>` : cmasPortal(wrap);
    const clicks = pressed();
    expect(fillAgencyForm(lena, cmasSpec)).toEqual({ ok: true });
    expect(value('[aria-label="CMAS Code"]')).toBe("123456");
    expect(clicks).toEqual(["by-code"]);
  });

  it.each([
    ["one form for both searches", (inner: string) => inner, true],
    ["no form at all", (inner: string) => `<div>${inner}</div>`, false],
  ])("presses CMAS's Manual Search for a name and birth date, on %s", (_, wrap, oneForm) => {
    document.body.innerHTML = oneForm ? `<form>${cmasPortal(wrap)}</form>` : cmasPortal(wrap);
    const clicks = pressed();
    expect(fillAgencyForm({ ...lena, cardNumber: null }, cmasSpec)).toEqual({ ok: true });
    expect(value('[aria-label="Family Name"]')).toBe("Ortiz");
    expect(value('[aria-label="Birthdate"]')).toBe("1990-04-12");
    expect(clicks).toEqual(["manual"]);
  });

  /** Security review R4-3: a button inside a hidden block is not on the page. */
  it("never presses a button hidden by the block around it, on CMAS's manual search", () => {
    document.body.innerHTML = `
      <input aria-label="CMAS Code"><button id="by-code">Search by code</button>
      <input aria-label="Given Name"><input aria-label="Family Name">
      <input aria-label="Birthdate">
      <div style="display:none"><button id="delete">Delete</button></div>
      <button id="manual">Manual Search</button>`;
    const clicks = pressed();
    const deleted = vi.fn();
    document.getElementById("delete")?.addEventListener("click", deleted);
    expect(fillAgencyForm({ ...lena, cardNumber: null }, cmasSpec)).toEqual({ ok: true });
    expect(deleted).not.toHaveBeenCalled();
    expect(clicks).toEqual(["manual"]);
  });

  /** Domain review R4 (adversarial) nit: a date picker's toggle is not CMAS's search. */
  it("never presses a date picker's toggle between CMAS's birth date and its Manual Search", () => {
    document.body.innerHTML = `
      <input aria-label="CMAS Code"><button id="by-code">Search by code</button>
      <input aria-label="Given Name"><input aria-label="Family Name">
      <input aria-label="Birthdate"><button type="button" id="calendar">Open calendar</button>
      <button id="manual">Manual Search</button>`;
    const clicks = pressed();
    const calendar = vi.fn();
    document.getElementById("calendar")?.addEventListener("click", calendar);
    expect(fillAgencyForm({ ...lena, cardNumber: null }, cmasSpec)).toEqual({ ok: true });
    expect(calendar).not.toHaveBeenCalled();
    expect(clicks).toEqual(["manual"]);
  });

  /** Domain review R4 (adversarial) 4: the first button in a public form is not always its submit. */
  it("presses a public form's Verify, never the date picker's toggle before it", () => {
    document.body.innerHTML = `
      <form>
        <label for="f">First Name</label><input id="f">
        <label for="l">Last Name</label><input id="l">
        <label for="d">Date of Birth</label><input id="d">
        <button type="button" id="calendar">Pick a date</button>
        <button type="reset" id="clear">Clear</button>
        <button id="verify">Verify</button>
      </form>`;
    const onSubmit = submitted();
    const calendar = vi.fn();
    const verify = vi.fn();
    const clear = vi.fn();
    document.getElementById("calendar")?.addEventListener("click", calendar);
    document.getElementById("verify")?.addEventListener("click", verify);
    document.getElementById("clear")?.addEventListener("click", clear);
    expect(
      fillAgencyForm(lena, { fields: ["name", "birthDate"], dateFormat: "MM/DD/YYYY" }),
    ).toEqual({ ok: true });
    expect(calendar).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(verify).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("types the student's email into PADI's search, and only the email", () => {
    document.body.innerHTML = `
      <form><input type="email" aria-label="Student email"><button>Search</button></form>`;
    const onSubmit = submitted();
    expect(
      fillAgencyForm(
        { ...lena, email: "lena@example.com" },
        { fields: ["email"], dateFormat: "YYYY-MM-DD" },
      ),
    ).toEqual({ ok: true });
    expect(value("input")).toBe("lena@example.com");
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("types a student's email into a search box only, never an invite or a newsletter box", () => {
    document.body.innerHTML = `
      <form><input type="email" aria-label="Email"><button>Invite student</button></form>
      <form><input type="email" aria-label="Email"><button>Subscribe</button></form>`;
    const onSubmit = submitted();
    expect(
      fillAgencyForm(
        { ...lena, email: "lena@example.com" },
        { fields: ["email"], dateFormat: "YYYY-MM-DD" },
      ),
    ).toEqual({ ok: false, missing: ["email"] });
    expect(value('input[type="email"]')).toBe("");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("never fills a sign-in page, so a diver's details never go into a sign-in form", () => {
    document.body.innerHTML = `
      <form>
        <input type="email" aria-label="Email"><input type="password" aria-label="Password">
        <button>Sign in</button>
      </form>`;
    const onSubmit = submitted();
    expect(
      fillAgencyForm(
        { ...lena, email: "lena@example.com" },
        { fields: ["email"], dateFormat: "YYYY-MM-DD" },
      ),
    ).toEqual({ ok: false, missing: ["signedIn"] });
    expect(value('input[type="email"]')).toBe("");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

/**
 * **PADI DiveChek**, on the PADI Pros' Site, in the staffer's own signed-in
 * browser. The form is a best guess (#2259); what these pin is the safety the
 * signed-in page gets: search boxes only, never a sign-in or account page,
 * and no button pressed but the search's own.
 */
describe("fillAgencyForm on PADI DiveChek", () => {
  const divechek = AGENCIES.padi;
  // The tab is on DiveChek's own address unless a test says otherwise.
  beforeEach(() => window.history.replaceState(null, "", "/divechek"));

  /** Security review R4-1a: one Verify does not make a form's every box a search. */
  it("types nothing into a form with a box the lookup does not fill, whatever its one button says", () => {
    document.body.innerHTML = `
      <form>
        <label for="f">First Name</label><input id="f">
        <label for="l">Last Name</label><input id="l">
        <label for="d">Date of Birth</label><input id="d">
        <label for="p">Phone</label><input id="p">
        <button id="go">Verify</button>
      </form>`;
    const onSubmit = submitted();
    const go = vi.fn();
    document.getElementById("go")?.addEventListener("click", go);
    const filled = fillAgencyForm(lena, divechek);
    expect(filled.ok).toBe(false);
    expect((filled as { missing: string[] }).missing.length).toBeGreaterThan(0);
    for (const box of document.querySelectorAll("input")) expect(box.value).toBe("");
    expect(go).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  /** Security review R4-1 (path): a search form on another Pros' Site page is not DiveChek. */
  it("types nothing on another page of the Pros' Site, even one with a search form", () => {
    window.history.replaceState(null, "", "/me/dashboard");
    document.body.innerHTML = `
      <form>
        <input aria-label="First Name"><input aria-label="Last Name">
        <input aria-label="Date of Birth"><button>Search</button>
      </form>`;
    const onSubmit = submitted();
    const filled = fillAgencyForm(lena, divechek);
    expect(filled.ok).toBe(false);
    for (const box of document.querySelectorAll("input")) expect(box.value).toBe("");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("reads DiveChek's address with a trailing slash as DiveChek", () => {
    window.history.replaceState(null, "", "/divechek/");
    document.body.innerHTML = `
      <form>
        <input aria-label="First Name"><input aria-label="Last Name">
        <input aria-label="Date of Birth"><button>Search</button>
      </form>`;
    submitted();
    expect(fillAgencyForm(lena, divechek)).toEqual({ ok: true });
  });

  /** Domain review R4 (adversarial) 3: a reset that says "search" is not the search. */
  it("presses Run Report, never a Clear search reset beside it", () => {
    document.body.innerHTML = `
      <form>
        <input aria-label="First Name"><input aria-label="Last Name">
        <input aria-label="Date of Birth">
        <button type="reset" id="clear">Clear search</button><button id="run">Run Report</button>
      </form>`;
    const onSubmit = submitted();
    const clear = vi.fn();
    const run = vi.fn();
    document.getElementById("clear")?.addEventListener("click", clear);
    document.getElementById("run")?.addEventListener("click", run);
    expect(fillAgencyForm(lena, divechek)).toEqual({ ok: true });
    expect(clear).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("types the diver's name and birth date into DiveChek's search, and presses its Search", () => {
    document.body.innerHTML = `
      <form>
        <label for="f">First Name</label><input id="f">
        <label for="l">Last Name</label><input id="l">
        <label for="d">Date of Birth</label><input id="d">
        <button>Search</button>
      </form>`;
    const onSubmit = submitted();
    expect(fillAgencyForm(lena, divechek)).toEqual({ ok: true });
    expect(value("#f")).toBe("Lena");
    expect(value("#l")).toBe("Ortiz");
    expect(value("#d")).toBe("04/12/1990");
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("presses DiveChek's own Run Report button", () => {
    document.body.innerHTML = `
      <form>
        <label for="f">First Name</label><input id="f">
        <label for="l">Last Name</label><input id="l">
        <label for="d">Date of Birth</label><input id="d">
        <button type="reset">Clear</button><button id="run">Run Report</button>
      </form>`;
    const onSubmit = submitted();
    const run = vi.fn();
    document.getElementById("run")?.addEventListener("click", run);
    expect(fillAgencyForm(lena, divechek)).toEqual({ ok: true });
    expect(run).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("never reads a Report button that does not run one as a search", () => {
    document.body.innerHTML = `
      <form>
        <label for="f">First Name</label><input id="f">
        <label for="l">Last Name</label><input id="l">
        <label for="d">Date of Birth</label><input id="d">
        <button>Report a problem</button>
      </form>`;
    const onSubmit = submitted();
    expect(fillAgencyForm(lena, divechek)).toEqual({
      ok: false,
      missing: ["name", "birthDate"],
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("types nothing on a page that asks for a password, and says the staffer is signed out", () => {
    document.body.innerHTML = `
      <form>
        <input aria-label="First Name"><input aria-label="Last Name">
        <input aria-label="Date of Birth"><input type="password" aria-label="Password">
        <button>Search</button>
      </form>`;
    const onSubmit = submitted();
    expect(fillAgencyForm(lena, divechek)).toEqual({ ok: false, missing: ["signedIn"] });
    for (const box of document.querySelectorAll("input")) expect(box.value).toBe("");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(["/login", "/account/details", "/sign-up", "/auth/callback", "/my-profile"])(
    "types nothing at %s, whatever the page's boxes say",
    (path) => {
      window.history.replaceState(null, "", path);
      document.body.innerHTML = `
        <form>
          <input aria-label="First Name"><input aria-label="Last Name">
          <input aria-label="Date of Birth"><button>Search</button>
        </form>`;
      const onSubmit = submitted();
      expect(fillAgencyForm(lena, divechek)).toEqual({ ok: false, missing: ["signedIn"] });
      for (const box of document.querySelectorAll("input")) expect(box.value).toBe("");
      expect(onSubmit).not.toHaveBeenCalled();
    },
  );

  it("never types a diver into a box that does not search, such as the shop's own profile", () => {
    document.body.innerHTML = `
      <form>
        <input aria-label="First Name"><input aria-label="Last Name">
        <input aria-label="Date of Birth"><button>Save changes</button>
      </form>`;
    const onSubmit = submitted();
    expect(fillAgencyForm(lena, divechek)).toEqual({
      ok: false,
      missing: ["name", "birthDate"],
    });
    for (const box of document.querySelectorAll("input")) expect(box.value).toBe("");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("presses only the search's own button, never another of the signed-in page's", () => {
    document.body.innerHTML = `
      <button id="other">Submit certification</button>
      <div role="search">
        <input aria-label="First Name"><input aria-label="Last Name">
        <input aria-label="Date of Birth"><button id="search">Go</button>
      </div>`;
    const other = vi.fn();
    const search = vi.fn();
    document.getElementById("other")?.addEventListener("click", other);
    document.getElementById("search")?.addEventListener("click", search);
    expect(fillAgencyForm(lena, divechek)).toEqual({ ok: true });
    expect(search).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();
  });

  /** Security review S2: a page-wide form's Search button does not make its profile boxes a search. */
  it("types nothing into a page-wide form with a Save beside its Search", () => {
    document.body.innerHTML = `
      <form>
        <input aria-label="Search the site"><button>Search</button>
        <label for="f">First Name</label><input id="f">
        <label for="l">Last Name</label><input id="l">
        <label for="d">Date of Birth</label><input id="d">
        <label for="p">Phone</label><input id="p">
        <button>Save changes</button>
      </form>`;
    const onSubmit = submitted();
    expect(fillAgencyForm(lena, divechek)).toEqual({ ok: false, missing: ["name", "birthDate"] });
    for (const box of document.querySelectorAll("input")) expect(box.value).toBe("");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("fills a small form whose every box is the lookup's, beside a second button", () => {
    document.body.innerHTML = `
      <form>
        <input aria-label="First Name"><input aria-label="Last Name">
        <input aria-label="Date of Birth">
        <button type="reset">Clear</button><button id="go">Search</button>
      </form>`;
    submitted();
    const go = vi.fn();
    document.getElementById("go")?.addEventListener("click", go);
    expect(fillAgencyForm(lena, divechek)).toEqual({ ok: true });
    expect(go).toHaveBeenCalledOnce();
  });

  it("never reads Research as search", () => {
    document.body.innerHTML = `
      <form>
        <input aria-label="First Name"><input aria-label="Last Name">
        <input aria-label="Date of Birth"><button>Research</button>
      </form>`;
    const onSubmit = submitted();
    expect(fillAgencyForm(lena, divechek)).toEqual({ ok: false, missing: ["name", "birthDate"] });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  /** Domain review D9: DiveChek's button may say Check, Chek or Verify. */
  it.each(["Check", "Chek", "Verify", "Run DiveChek"])(
    "presses the search's own %s button",
    (words) => {
      document.body.innerHTML = `
      <form>
        <input aria-label="First Name"><input aria-label="Last Name">
        <input aria-label="Date of Birth"><button id="go">${words}</button>
      </form>`;
      submitted();
      const go = vi.fn();
      document.getElementById("go")?.addEventListener("click", go);
      expect(fillAgencyForm(lena, divechek)).toEqual({ ok: true });
      expect(go).toHaveBeenCalledOnce();
    },
  );

  /** Security review S3: a search with no button of its own is never submitted some other way. */
  it("never submits a form whose search has no button of its own", () => {
    document.body.innerHTML = `
      <form>
        <input type="search" aria-label="First Name"><input type="search" aria-label="Last Name">
        <input type="search" aria-label="Date of Birth"><button>Go</button>
      </form>`;
    const onSubmit = submitted();
    expect(fillAgencyForm(lena, divechek)).toEqual({ ok: false, missing: ["submit"] });
    for (const box of document.querySelectorAll("input")) expect(box.value).toBe("");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  /** Security review S5: a sign-in that asks for the email first, the password on the next step. */
  it("reads an email box that does not search as a sign-in", () => {
    document.body.innerHTML = `
      <form><input type="email" aria-label="Email"><button>Continue</button></form>
      <form>
        <input aria-label="First Name"><input aria-label="Last Name">
        <input aria-label="Date of Birth"><button>Search</button>
      </form>`;
    expect(fillAgencyForm(lena, divechek)).toEqual({ ok: false, missing: ["signedIn"] });
    for (const box of document.querySelectorAll("input")) expect(box.value).toBe("");
  });

  it("types nothing on a signed-in page without the sign-in address rule", () => {
    document.body.innerHTML = `
      <form>
        <input aria-label="First Name"><input aria-label="Last Name">
        <input aria-label="Date of Birth"><button>Search</button>
      </form>`;
    expect(extension.fillAgencyForm(lena, divechek)).toEqual({
      ok: false,
      missing: ["signedIn"],
    });
  });

  it("presses nothing when the search has no button of its own to press", () => {
    document.body.innerHTML = `
      <button id="other">Submit</button>
      <div role="search">
        <input aria-label="First Name"><input aria-label="Last Name">
        <input aria-label="Date of Birth">
      </div>`;
    const other = vi.fn();
    document.getElementById("other")?.addEventListener("click", other);
    expect(fillAgencyForm(lena, divechek)).toEqual({ ok: false, missing: ["submit"] });
    expect(other).not.toHaveBeenCalled();
  });
});

/** The eLearning lookup on the Pros' Site, held to the same signed-in rules. */
describe("fillAgencyForm on PADI eLearning", () => {
  /** Security review R4-1b: a report's "Email a copy to" box is not a search for the student. */
  it("never types the student's email into a box that sends a report a copy", () => {
    document.body.innerHTML = `
      <form>
        <label>Email a copy to <input type="email"></label>
        <button id="run">Run Report</button>
      </form>`;
    const onSubmit = submitted();
    const run = vi.fn();
    document.getElementById("run")?.addEventListener("click", run);
    const filled = fillAgencyForm({ ...lena, email: "lena@example.com" }, ELEARNING.padi);
    expect(filled.ok).toBe(false);
    expect(value("input")).toBe("");
    expect(run).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("types the student's email into the student search", () => {
    document.body.innerHTML = `
      <form>
        <label>Student email <input type="email"></label>
        <button>Search</button>
      </form>`;
    const onSubmit = submitted();
    expect(fillAgencyForm({ ...lena, email: "lena@example.com" }, ELEARNING.padi)).toEqual({
      ok: true,
    });
    expect(value("input")).toBe("lena@example.com");
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

describe("pageAsksToSignIn", () => {
  const { pageAsksToSignIn } = extension;

  it("reads a password box on the page as a sign-in", () => {
    document.body.innerHTML = `<form><input type="password" aria-label="Password"></form>`;
    expect(pageAsksToSignIn(SIGN_IN_PATH)).toBe(true);
  });

  it("reads a sign-in address as a sign-in", () => {
    window.history.replaceState(null, "", "/sign-in");
    document.body.innerHTML = "<p>Welcome back</p>";
    expect(pageAsksToSignIn(SIGN_IN_PATH)).toBe(true);
  });

  it("reads a result page, or a password box hidden around it, as no sign-in", () => {
    window.history.replaceState(null, "", "/divechek");
    document.body.innerHTML = `<p>Lena Ortiz</p>
      <div style="display:none"><input type="password"></div>`;
    expect(pageAsksToSignIn(SIGN_IN_PATH)).toBe(false);
  });

  it("reads a page with no sign-in address rule as a sign-in", () => {
    document.body.innerHTML = "<p>Lena Ortiz</p>";
    expect(pageAsksToSignIn()).toBe(true);
  });
});
