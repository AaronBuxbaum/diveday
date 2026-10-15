// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  agencyCheckReportContext,
  PAGE_SHAPE_MAX_BYTES,
  PAGE_SHAPE_WORDS,
  type PageShape,
  pageShapeLogContext,
  parsePageShape,
} from "./page-shape";

/**
 * **The page-shape report** a failed check hands back (`extension/shape.js`).
 * It leaves the staffer's browser, reaches DiveDay's server and its logs, so
 * these hold the one promise that matters: structure only. No box's value, no
 * name, no date and no number on the page ever reaches the report, whatever
 * the page puts where.
 */
async function loadExtensionScript(file: string): Promise<void> {
  await import(/* @vite-ignore */ new URL(`../../extension/${file}`, import.meta.url).href);
}
await loadExtensionScript("protocol.js");
await loadExtensionScript("shape.js");
const extension = (
  globalThis as unknown as {
    DiveDayCertCheck: {
      describePageShape: (vocabulary: string[], scrub: string[]) => unknown;
      PAGE_SHAPE_WORDS: string[];
    };
  }
).DiveDayCertCheck;

const ADA = ["Ada", "Lovelace"];

function shapeOf(html: string, path = "/", title = "", scrub = ADA) {
  window.history.replaceState({}, "", path);
  document.title = title;
  document.body.innerHTML = html;
  return extension.describePageShape(extension.PAGE_SHAPE_WORDS, scrub) as PageShape;
}

/** Every word the report carries, as one lowercase string. */
function reportText(shape: unknown): string {
  return JSON.stringify(shape).toLowerCase();
}

/** Every word in the report is a form word, "_", or a key or enum of the report itself. */
function wordsOf(shape: PageShape): string[] {
  return [
    shape.path,
    shape.title,
    ...shape.headings,
    ...shape.buttons,
    ...shape.boxes.map((box) => box.words),
  ]
    .join(" ")
    .split(/[\s/]+/)
    .filter(Boolean);
}

afterEach(() => {
  document.body.innerHTML = "";
  document.title = "";
});

describe("the extension's copy of the report's words", () => {
  it("is the app's", () => {
    expect(extension.PAGE_SHAPE_WORDS).toEqual([...PAGE_SHAPE_WORDS]);
  });

  it("holds no digit, no month and no word that is not lowercase letters", () => {
    const months =
      /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/;
    for (const word of PAGE_SHAPE_WORDS) {
      expect(word).toMatch(/^[a-z]+$/);
      expect(word, word).not.toMatch(months);
    }
  });
});

describe("describePageShape", () => {
  it("names a lookup form by its labels, types and button, so a renamed box shows", () => {
    const shape = shapeOf(
      `<h1>DiveChek</h1>
      <form>
        <label>First Name <input name="first_name"></label>
        <label>Last Name <input name="last_name"></label>
        <label>Date of Birth <input name="dob" placeholder="MM/DD/YYYY"></label>
        <button type="submit">Run Report</button>
      </form>`,
      "/divechek",
      "DiveChek | PADI Pros",
    );
    expect(shape).toEqual({
      path: "/divechek",
      title: "dive chek padi pros",
      headings: ["dive chek"],
      boxes: [
        { tag: "input", type: "text", words: "first name first name" },
        { tag: "input", type: "text", words: "last name last name" },
        { tag: "input", type: "text", words: "dob mm dd yyyy date of birth" },
      ],
      buttons: ["run report"],
      forms: 1,
      frames: 0,
      password: false,
      captcha: false,
    });
    expect(parsePageShape(shape)).toEqual(shape);
  });

  it("says a box it cannot name is there, without its words", () => {
    const shape = shapeOf(
      `<form><label>Taucher <input name="feld"></label><button>Absenden</button></form>`,
    );
    expect(shape.boxes).toEqual([{ tag: "input", type: "text", words: "_" }]);
    expect(shape.buttons).toEqual(["_"]);
  });

  /**
   * The adversarial page: a results page after a search by GET, with the
   * diver's name in the address, the title and a heading, a neighbour's row,
   * every box filled in, and names, dates, numbers and an email in every
   * attribute the report reads.
   */
  it("never carries a value, a name, a date, a number or an email, wherever the page puts them", () => {
    const shape = shapeOf(
      `<h1>Results for Ada Lovelace</h1>
      <h2>Grace Hopper</h2>
      <h3>Born 12 April 1990 · #1506AB1234</h3>
      <form>
        <label>First name <input name="first" value="Ada"></label>
        <label>Last name (e.g. Hopper) <input name="last" placeholder="Hopper 1985" value="Lovelace"></label>
        <label>Date of birth <input name="dob_1990_04_12" placeholder="04/12/1990" value="04/12/1990"></label>
        <input aria-label="ada.lovelace@example.com" type="email" value="ada@example.com">
        <input type="hidden" name="secret" value="Grace">
        <select name="month"><option selected>April</option></select>
        <textarea name="notes">Ada Lovelace, born 1990</textarea>
        <label><input type="checkbox" name="pick-grace-hopper"> Select Grace Hopper</label>
        <button type="submit">Search Ada</button>
        <input type="submit" value="View Grace Hopper #12345">
      </form>
      <table><tr><td>Grace Hopper</td><td>03/02/1985</td><td>Open Water Diver</td><td>1506CD9876</td></tr></table>
      <p>Ada Lovelace, Open Water Diver, 04/12/1990</p>
      <ul><li>Ada Lovelace</li></ul>`,
      "/divechek/ada-lovelace/1990-04-12/Grace_Hopper",
      "Ada Lovelace (1990) — DiveChek",
    );
    const text = reportText(shape);
    for (const leak of [
      "ada",
      "lovelace",
      "grace",
      "hopper",
      "april",
      "example",
      "@",
      "1990",
      "1506",
      "12345",
      "notes",
      "secret",
    ]) {
      expect(text, leak).not.toContain(leak);
    }
    // No digit anywhere but the report's own counts.
    const { forms, frames, ...words } = shape;
    expect(JSON.stringify(words)).not.toMatch(/\d/);
    expect(forms).toBe(1);
    expect(frames).toBe(0);
    for (const word of wordsOf(shape)) {
      expect(word === "_" || PAGE_SHAPE_WORDS.includes(word), word).toBe(true);
    }
    // And it still says what the form asked for.
    expect(shape.boxes.map((box) => box.words)).toContain("first first name");
    // A segment of digits alone is empty: there is nothing of it to keep.
    expect(shape.path).toBe("/divechek/_//_");
  });

  it("never keeps the diver's own name, even when it is one of the form's words", () => {
    const shape = shapeOf(
      `<h1>Water Day</h1><form><label>Day <input name="day"></label><button>Search</button></form>`,
      "/water/day",
      "Water",
      ["Water", "Day"],
    );
    expect(reportText(shape)).not.toMatch(/water|"day|day"/);
    expect(shape.boxes).toEqual([{ tag: "input", type: "text", words: "_" }]);
    expect(shape.path).toBe("/_/_");
  });

  it("carries no word of a page made of names and numbers, however long", () => {
    // A seeded mix of names, dates, numbers and noise in every place the report reads.
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    const names = ["Ada", "Lovelace", "Grace", "Hopper", "Ana", "Pérez", "Zoë", "Ødegård", "李"];
    const piece = () => {
      const pick = next() % 3;
      if (pick === 0) return names[next() % names.length];
      if (pick === 1) return String(next() % 100000);
      return `${(next() % 12) + 1}/${(next() % 28) + 1}/19${next() % 100}`;
    };
    const phrase = () => Array.from({ length: 4 }, piece).join(" ");
    const html = Array.from(
      { length: 40 },
      () =>
        `<h2>${phrase()}</h2><label>${phrase()} <input name="${phrase()}" placeholder="${phrase()}" value="${phrase()}"></label><button>${phrase()}</button>`,
    ).join("");
    const shape = shapeOf(`<form>${html}</form>`, `/${phrase()}`, phrase());
    for (const word of wordsOf(shape)) expect(word).toBe("_");
    expect(JSON.stringify(shape).length).toBeLessThanOrEqual(PAGE_SHAPE_MAX_BYTES);
    expect(parsePageShape(shape)).not.toBeNull();
  });

  it("sees reCAPTCHA's box, hCaptcha and Turnstile, and not reCAPTCHA's invisible badge", () => {
    expect(shapeOf(`<form><div class="g-recaptcha"></div></form>`).captcha).toBe(true);
    expect(shapeOf(`<div class="h-captcha"></div>`).captcha).toBe(true);
    expect(shapeOf(`<div class="cf-turnstile"></div>`).captcha).toBe(true);
    expect(
      shapeOf(
        `<div class="grecaptcha-badge"><iframe src="https://www.google.com/recaptcha/api2/anchor?size=invisible"></iframe></div>`,
      ).captcha,
    ).toBe(false);
    expect(shapeOf(`<div class="g-recaptcha" data-size="invisible"></div>`).captcha).toBe(false);
    expect(shapeOf(`<div class="g-recaptcha" style="display:none"></div>`).captcha).toBe(false);
  });

  it("says a password box is there, and reads no hidden one", () => {
    expect(shapeOf(`<input type="password" name="pw">`).password).toBe(true);
    expect(shapeOf(`<div hidden><input type="password"></div>`).password).toBe(false);
  });
});

describe("parsePageShape, on the server", () => {
  const good: PageShape = {
    path: "/divechek",
    title: "divechek",
    headings: [],
    boxes: [{ tag: "input", type: "text", words: "first name" }],
    buttons: ["run report"],
    forms: 1,
    frames: 0,
    password: false,
    captcha: false,
  };

  it("takes a report made of form words", () => {
    expect(parsePageShape(good)).toEqual(good);
  });

  it("refuses a report with any word that is not a form word, whoever sent it", () => {
    expect(parsePageShape({ ...good, title: "ada lovelace" })).toBeNull();
    expect(parsePageShape({ ...good, headings: ["Results"] })).toBeNull();
    expect(parsePageShape({ ...good, buttons: ["search 1990"] })).toBeNull();
    expect(parsePageShape({ ...good, path: "/divechek?first=ada" })).toBeNull();
    expect(
      parsePageShape({ ...good, boxes: [{ tag: "input", type: "text", words: "grace" }] }),
    ).toBeNull();
    expect(
      parsePageShape({ ...good, boxes: [{ tag: "input", type: "ada", words: "first" }] }),
    ).toBeNull();
  });

  it("refuses a field it does not know, and anything too big", () => {
    expect(parsePageShape({ ...good, pageText: "Ada Lovelace" })).toBeNull();
    expect(parsePageShape({ ...good, buttons: Array(13).fill("search") })).toBeNull();
    expect(parsePageShape({ ...good, forms: 1e9 })).toBeNull();
    expect(parsePageShape("not a shape")).toBeNull();
    expect(parsePageShape(null)).toBeNull();
  });

  it("logs one line of form words and counts", () => {
    expect(pageShapeLogContext(good)).toEqual({
      path: "/divechek",
      title: "divechek",
      headings: "",
      boxes: "input:text first name",
      buttons: "run report",
      forms: 1,
      frames: 0,
      password: false,
      captcha: false,
    });
  });
});

describe("agencyCheckReportContext", () => {
  const allowed = { agencies: ["ssi", "padi"], reasons: ["captcha", "page_changed"] };
  const shape = {
    path: "/divechek",
    title: "",
    headings: [],
    boxes: [{ tag: "input", type: "text", words: "first name" }],
    buttons: ["run report"],
    forms: 1,
    frames: 0,
    password: false,
    captcha: false,
  };

  it("logs the agency, the reason, the version and the shape's form words", () => {
    expect(
      agencyCheckReportContext(
        {
          agency: "padi",
          reason: "page_changed",
          version: "1.5.0",
          pageShape: JSON.stringify(shape),
        },
        allowed,
      ),
    ).toEqual({
      agency: "padi",
      reason: "page_changed",
      extension: "1.5.0",
      path: "/divechek",
      title: "",
      headings: "",
      boxes: "input:text first name",
      buttons: "run report",
      forms: 1,
      frames: 0,
      password: false,
      captcha: false,
    });
  });

  it("logs a report with no shape, and a version that is not one as none", () => {
    expect(
      agencyCheckReportContext(
        { agency: "ssi", reason: "captcha", version: "Ada", pageShape: "" },
        allowed,
      ),
    ).toEqual({ agency: "ssi", reason: "captcha", extension: null });
  });

  it("logs nothing for an agency, reason or shape it does not know", () => {
    const post = { agency: "ssi", reason: "captcha", version: "1.5.0", pageShape: "" };
    expect(agencyCheckReportContext({ ...post, agency: "Ada Lovelace" }, allowed)).toBeNull();
    expect(agencyCheckReportContext({ ...post, reason: "signed_out" }, allowed)).toBeNull();
    expect(agencyCheckReportContext({ ...post, pageShape: "{not json" }, allowed)).toBeNull();
    expect(
      agencyCheckReportContext(
        { ...post, pageShape: JSON.stringify({ ...shape, title: "ada lovelace" }) },
        allowed,
      ),
    ).toBeNull();
    expect(
      agencyCheckReportContext(
        { ...post, pageShape: "x".repeat(PAGE_SHAPE_MAX_BYTES + 1) },
        allowed,
      ),
    ).toBeNull();
  });
});
