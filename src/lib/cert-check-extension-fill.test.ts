// @vitest-environment jsdom
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
await loadExtensionScript("fill.js");
await loadExtensionScript("agencies.js");
const { fillAgencyForm, excerptAround, excerptAroundName, AGENCIES } = (
  globalThis as unknown as {
    DiveDayCertCheck: {
      fillAgencyForm: (
        query: unknown,
        spec: unknown,
      ) => { ok: true } | { ok: false; missing: string[] };
      excerptAround: (text: string, email: string) => string;
      excerptAroundName: (text: string, firstName: string, lastName: string) => string;
      AGENCIES: Record<string, unknown>;
    };
  }
).DiveDayCertCheck;

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
  });

  it("never types into a hidden box", () => {
    document.body.innerHTML = `
      <form><input type="hidden" name="card_number"><button>Verify</button></form>`;
    expect(fillAgencyForm(lena, { fields: ["number"], dateFormat: "YYYY-MM-DD" })).toEqual({
      ok: false,
      missing: ["number"],
    });
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

describe("excerptAround", () => {
  it("hands back only the lines near the student's email", () => {
    const page = [
      ...Array.from({ length: 20 }, (_, index) => `Other ${index}\tother${index}@example.com`),
      "Lena Ortiz\tLena@Example.com\tOpen Water Diver Online\tComplete",
      ...Array.from({ length: 20 }, (_, index) => `Later ${index}\tlater${index}@example.com`),
    ].join("\n");
    const excerpt = excerptAround(page, "lena@example.com");
    expect(excerpt).toContain("Lena Ortiz");
    expect(excerpt).not.toContain("other0@example.com");
    expect(excerpt).not.toContain("later19@example.com");
  });

  it("keeps the top of a page that never names the email, to say why", () => {
    const page = ["Search results", "No results found", ...Array(100).fill("row")].join("\n");
    const excerpt = excerptAround(page, "lena@example.com");
    expect(excerpt).toContain("No results found");
    expect(excerpt.split("\n")).toHaveLength(40);
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

describe("excerptAroundName", () => {
  it("hands back only this diver's lines, and how many divers were found", () => {
    const page = [
      "PADI Pros’ Site",
      "Welcome back, Coral Coast Divers",
      "Recent students: Sam Reyes, Mia Chen",
      "DiveChek",
      "1 diver found",
      ...Array.from({ length: 10 }, (_, index) => `menu ${index}`),
      "Lena Ortiz",
      "Date of Birth: 12 Apr 1990",
      "Open Water Diver 15 Jun 2015",
      ...Array.from({ length: 10 }, (_, index) => `footer ${index}`),
    ].join("\n");
    const excerpt = excerptAroundName(page, "Léna", "ORTIZ");
    expect(excerpt).toContain("1 diver found");
    expect(excerpt).toContain("Date of Birth: 12 Apr 1990");
    expect(excerpt).toContain("Open Water Diver");
    expect(excerpt).not.toContain("Sam Reyes");
    expect(excerpt).not.toContain("Coral Coast Divers");
    expect(excerpt).not.toContain("footer 9");
  });

  it("keeps every record naming the diver, so the server can see there are several", () => {
    const page = ["Lena Ortiz", "12 Apr 1990", ...Array(20).fill("x"), "Lena Ortiz", "3 Sep 1987"];
    expect(excerptAroundName(page.join("\n"), "Lena", "Ortiz")).toContain("3 Sep 1987");
  });

  it("never takes a longer name for the diver's", () => {
    const page = ["Welcome", ...Array(50).fill("row"), "Lenara Ortizzi", "Open Water Diver"];
    expect(excerptAroundName(page.join("\n"), "Lena", "Ortiz")).not.toContain("Lenara");
  });

  it("keeps the top of a page that never names the diver, to say why", () => {
    const page = ["Sign in", "Email", "Password", ...Array(100).fill("row")].join("\n");
    const excerpt = excerptAroundName(page, "Lena", "Ortiz");
    expect(excerpt).toContain("Sign in");
    expect(excerpt.split("\n")).toHaveLength(40);
  });
});
