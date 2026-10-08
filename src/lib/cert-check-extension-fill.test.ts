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
const { fillAgencyForm } = (
  globalThis as unknown as {
    DiveDayCertCheck: {
      fillAgencyForm: (
        query: unknown,
        spec: unknown,
      ) => { ok: true } | { ok: false; missing: string[] };
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
});
