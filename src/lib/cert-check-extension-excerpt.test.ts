// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DIVECHEK_RECORD, judgeAgencyPage, RECORD_LINES } from "./agency-check";
import { judgeElearningPage } from "./elearning-check";

/**
 * What the extension hands back from a page behind the shop's own sign-in
 * (`excerptAround`, `excerptAroundName` in `extension/fill.js`): only the
 * student's or diver's own lines, never another person's. And the sample
 * page "Try the checks" fills (`extension/sample.js`).
 */
async function loadExtensionScript(file: string): Promise<void> {
  await import(/* @vite-ignore */ new URL(`../../extension/${file}`, import.meta.url).href);
}
await loadExtensionScript("protocol.js");
await loadExtensionScript("fill.js");
await loadExtensionScript("agencies.js");
await loadExtensionScript("shape.js");
const {
  excerptAround,
  excerptAroundName,
  DIVECHEK_RECORD: extensionReading,
} = (
  globalThis as unknown as {
    DiveDayCertCheck: {
      DIVECHEK_RECORD: unknown;
      excerptAround: (text: string, email: string, firstName: string, lastName: string) => string;
      excerptAroundName: (text: string, firstName: string, lastName: string) => string;
    };
  }
).DiveDayCertCheck;

beforeEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("excerptAround", () => {
  /** Every address in a text, lowercased. */
  const addresses = (text: string) =>
    [...text.matchAll(/[^\s@]+@[^\s@]+\.[^\s@]+/g)].map((match) => match[0].toLowerCase());

  it("hands back only the lines near the student's email", () => {
    const page = [
      ...Array.from({ length: 20 }, (_, index) => `Other ${index}\tother${index}@example.com`),
      "Lena Ortiz\tLena@Example.com\tOpen Water Diver Online\tComplete",
      ...Array.from({ length: 20 }, (_, index) => `Later ${index}\tlater${index}@example.com`),
    ].join("\n");
    const excerpt = excerptAround(page, "lena@example.com", "Lena", "Ortiz");
    expect(excerpt).toBe("Lena Ortiz\tLena@Example.com\tOpen Water Diver Online\tComplete");
  });

  /** Security review (MEDIUM): a Pros' Site list is other students' names and emails. */
  it("never hands back another student's address or the lines around it", () => {
    const page = [
      "Students",
      "Sam Reyes",
      "sam@example.com",
      "Open Water Diver Online",
      "In progress",
      "Lena Ortiz",
      "lena@example.com",
      "Open Water Diver Online",
      "Complete",
      "Mia Chen",
      "mia@example.com",
      "Advanced Open Water Diver Online",
    ].join("\n");
    const excerpt = excerptAround(page, "lena@example.com", "Lena", "Ortiz");
    expect(excerpt.split("\n")).toEqual([
      "Lena Ortiz",
      "lena@example.com",
      "Open Water Diver Online",
      "Complete",
    ]);
    expect(addresses(excerpt)).toEqual(["lena@example.com"]);
    expect(excerpt).not.toContain("Mia Chen");
    expect(excerpt).not.toContain("Sam Reyes");
  });

  it("drops a line carrying another address beside the student's", () => {
    const page = ["Lena Ortiz lena@example.com", "Family: mum@example.com", "Complete"].join("\n");
    const excerpt = excerptAround(page, "lena@example.com", "Lena", "Ortiz");
    expect(addresses(excerpt)).toEqual(["lena@example.com"]);
  });

  /** Domain review R7 (adversarial) 1: an address in brackets or before a comma is still the student's. */
  it("reads the student's address in brackets, angle brackets or before punctuation", () => {
    for (const written of [
      "(lena@example.com)",
      "<lena@example.com>",
      "lena@example.com,",
      "lena@example.com.",
      "Email: lena@example.com;",
    ]) {
      const page = [
        "Students",
        `Lena Ortiz ${written}`,
        "Open Water Diver Online",
        "Complete",
      ].join("\n");
      const excerpt = excerptAround(page, "lena@example.com", "Lena", "Ortiz");
      expect(excerpt.split("\n"), written).toEqual([
        `Lena Ortiz ${written}`,
        "Open Water Diver Online",
        "Complete",
      ]);
    }
    const other = ["Lena Ortiz (lena@example.com)", "Family (mia@example.com)", "Complete"];
    expect(excerptAround(other.join("\n"), "lena@example.com", "Lena", "Ortiz")).not.toContain(
      "mia@",
    );
  });

  /** Domain review R7 (adversarial) 2: a status alone above the next student's row is still hers. */
  it("keeps the student's status when the next student's row starts under it", () => {
    const page = [
      "Lena Ortiz lena@example.com",
      "Open Water Diver Online",
      "Complete",
      "Mia Chen mia@example.com",
      "Advanced Open Water Diver Online",
      "In progress",
    ].join("\n");
    const excerpt = excerptAround(page, "lena@example.com", "Lena", "Ortiz");
    expect(excerpt.split("\n")).toEqual([
      "Lena Ortiz lena@example.com",
      "Open Water Diver Online",
      "Complete",
    ]);
  });

  /** Domain review R7 (adversarial) 2, nit: the next student's name line ends the walk down. */
  it("stops under the student's lines at a line that is neither a course, a status nor a date", () => {
    const page = [
      "Lena Ortiz",
      "lena@example.com",
      "Open Water Diver Online",
      "Complete",
      "Mia Chen",
      "Advanced Open Water Diver Online",
      "In progress",
      "mia@example.com",
    ].join("\n");
    const excerpt = excerptAround(page, "lena@example.com", "Lena", "Ortiz");
    expect(excerpt.split("\n")).toEqual([
      "Lena Ortiz",
      "lena@example.com",
      "Open Water Diver Online",
      "Complete",
    ]);
  });

  /** Security review R7 2: the record is read from the name line, as the server reads it. */
  it("reads no further under the student's address than the server reads under the name", () => {
    const page = [
      "Lena Ortiz",
      "Open Water Diver Online",
      "In progress",
      "Enrolled 1 Jan 2026",
      "lena@example.com",
      "Mia Chen",
      "Open Water Diver Online",
      "Complete",
      "Enrolled 2 Jan 2026",
      "mia@example.com",
    ].join("\n");
    const excerpt = excerptAround(page, "lena@example.com", "Lena", "Ortiz");
    expect(excerpt).not.toContain("Mia Chen");
    expect(excerpt).not.toContain("Complete");
    expect(
      judgeElearningPage({
        firstName: "Lena",
        lastName: "Ortiz",
        email: "lena@example.com",
        courseTitle: "Open Water Diver",
        pageText: excerpt,
      }).verdict,
    ).toBe("not_complete");
  });

  it("hands back only why, at most ten lines, from a page that never names the email", () => {
    const page = [
      "Search results",
      "Sam Reyes sam@example.com Open Water Diver Online Complete",
      "No results found",
      "No results found for mia@example.com",
      ...Array(100).fill("Mia Chen mia@example.com"),
      ...Array(20).fill("No results"),
    ].join("\n");
    const excerpt = excerptAround(page, "lena@example.com", "Lena", "Ortiz");
    expect(excerpt).toContain("No results found");
    expect(excerpt).not.toContain("Sam Reyes");
    expect(addresses(excerpt)).toEqual([]);
    expect(excerpt.split("\n").length).toBeLessThanOrEqual(10);
  });
});

describe("excerptAroundName", () => {
  it("reads a DiveChek record with the server's own words", () => {
    expect(extensionReading).toEqual(JSON.parse(JSON.stringify(DIVECHEK_RECORD)));
  });

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

  it("hands back no more lines under a name than the server reads as one record", () => {
    const page = [
      "Lena Ortiz",
      "Date of Birth: 12 Apr 1990",
      "Open Water Diver 15 Jun 2015",
      "Rescue Diver 2016",
      "Deep Diver 2017",
      "Night Diver 2018",
    ].join("\n");
    expect(excerptAroundName(page, "Lena", "Ortiz").split("\n")).toEqual(
      page.split("\n").slice(0, RECORD_LINES + 1),
    );
  });

  /** Domain review R9 (operational) 1: the record ends where the server ends it. */
  it("never hands back a neighbour's lines inside the four-line window", () => {
    const page = [
      "DiveChek",
      "Lena Ortiz",
      "Date of Birth: 12 Apr 1990",
      "Open Water Diver 15 Jun 2015 1506AB1234",
      "Mark Lee",
      "Date of Birth: 1 Feb 1980",
      "Advanced Open Water Diver 1 Jan 2016",
    ].join("\n");
    const excerpt = excerptAroundName(page, "Lena", "Ortiz");
    expect(excerpt.split("\n")).toEqual([
      "Lena Ortiz",
      "Date of Birth: 12 Apr 1990",
      "Open Water Diver 15 Jun 2015 1506AB1234",
    ]);
    const neighbour = page
      .replace("Mark Lee", "Mark Lee 1 Feb 1980")
      .replace("Date of Birth: 1 Feb 1980\n", "");
    expect(excerptAroundName(neighbour, "Lena", "Ortiz")).not.toContain("Mark Lee");
  });

  /** Domain review R9, nit: an address on a line saying why never comes back. */
  it("hands back only the words saying why from a line carrying an address", () => {
    const page = ["DiveChek", "No results for mark.lee@example.com", "Help: help@example.com"];
    const excerpt = excerptAroundName(page.join("\n"), "Lena", "Ortiz");
    expect(excerpt).not.toContain("@");
    expect(excerpt).not.toContain("mark");
  });

  it("keeps a name split over two labelled lines, either order, so a second diver laid out that way still shows", () => {
    const page = [
      "PADI Pros’ Site",
      "Welcome back, Coral Coast Divers",
      "First name: Lena",
      "Last name: Ortiz",
      "Date of Birth: 12 Apr 1990",
      "Open Water Diver",
      "Apellidos: Ortiz",
      "Nombre: Léna",
      "Date of Birth: 3 Sep 1987",
      "Advanced Open Water Diver",
      "Card 1",
      "Card 2",
      "Footer",
      "Recent students: Sam Reyes",
    ].join("\n");
    const excerpt = excerptAroundName(page, "Lena", "Ortiz");
    expect(excerpt.split("\n")).toEqual([
      "First name: Lena",
      "Last name: Ortiz",
      "Date of Birth: 12 Apr 1990",
      "Open Water Diver",
      "Apellidos: Ortiz",
      "Nombre: Léna",
      "Date of Birth: 3 Sep 1987",
      "Advanced Open Water Diver",
      "Card 1",
      "Card 2",
    ]);
    expect(excerpt).not.toContain("Coral Coast Divers");
    expect(excerpt).not.toContain("Sam Reyes");
  });

  /** Domain review R7 (adversarial) 3: a labelled line belongs to one pair, top to bottom. */
  it("never pairs one record's last name with the next record's first name", () => {
    const page = [
      "First name: Mark",
      "Last name: Ortiz",
      "First name: Lena",
      "Last name: Chen",
      "Date of Birth: 3 Sep 1987",
      "Open Water Diver",
    ].join("\n");
    expect(excerptAroundName(page, "Lena", "Ortiz")).toBe("");
  });

  it("never reads a first name and someone else's last name, or lines apart, as the diver's", () => {
    const apart = ["First name: Lena", "Date of Birth: 12 Apr 1990", "Last name: Ortiz"].join("\n");
    expect(excerptAroundName(apart, "Lena", "Ortiz")).toBe("");
    const other = ["First name: Lena", "Last name: Ortiz Smith"].join("\n");
    expect(excerptAroundName(other, "Lena", "Ortiz")).toBe("");
  });

  it("reads a 'Last, First' name line as the diver's", () => {
    const page = ["Menu", "Ortiz, Lena", "12 Apr 1990", "Open Water Diver"].join("\n");
    expect(excerptAroundName(page, "Lena", "Ortiz")).toBe(
      "Ortiz, Lena\n12 Apr 1990\nOpen Water Diver",
    );
  });

  /** Security review R7, nit: a short count line may still name the shop. */
  it("keeps only the count's words from a short line around it", () => {
    const page = ["Coral Coast: 2 divers found", "Lena Ortiz"].join("\n");
    const excerpt = excerptAroundName(page, "Lena", "Ortiz");
    expect(excerpt.split("\n")).toEqual(["2 divers found", "Lena Ortiz"]);
  });

  it("keeps only the count's words from a long line around it", () => {
    const page = [
      `Welcome back, Coral Coast Divers. Your recent students include Sam Reyes. 2 divers found`,
      "Lena Ortiz",
    ].join("\n");
    const excerpt = excerptAroundName(page, "Lena", "Ortiz");
    expect(excerpt).toContain("2 divers found");
    expect(excerpt).not.toContain("Sam Reyes");
  });

  it("keeps every record naming the diver, so the server can see there are several", () => {
    const page = ["Lena Ortiz", "12 Apr 1990", ...Array(20).fill("x"), "Lena Ortiz", "3 Sep 1987"];
    expect(excerptAroundName(page.join("\n"), "Lena", "Ortiz")).toContain("3 Sep 1987");
  });

  it("never takes a longer name for the diver's", () => {
    const page = ["Welcome", ...Array(50).fill("row"), "Lenara Ortizzi", "Open Water Diver"];
    expect(excerptAroundName(page.join("\n"), "Lena", "Ortiz")).not.toContain("Lenara");
  });

  /**
   * The judge reads a split name with middle names or particles, and refuses
   * a pair with a stray labelled line beside it: the excerpt judges as the
   * whole page does on both.
   */
  it.each([
    [
      "a namesake whose split name carries a middle name",
      [
        "DiveChek",
        "Lena Ortiz",
        "Date of Birth: 12 Apr 1990",
        "Open Water Diver 15 Jun 2015 1506AB1234",
        "First name: Lena Maria",
        "Last name: Ortiz",
        "Date of Birth: 3 Sep 1987",
        "Open Water Diver 1 Jan 2012 1201CD5678",
      ],
    ],
    [
      "a namesake whose split last name carries a particle",
      [
        "DiveChek",
        "Lena Ortiz",
        "Date of Birth: 12 Apr 1990",
        "Open Water Diver 15 Jun 2015 1506AB1234",
        "Nombre: Lena",
        "Apellidos: de la Ortiz",
        "Date of Birth: 3 Sep 1987",
        "Open Water Diver 1 Jan 2012 1201CD5678",
      ],
    ],
    [
      "the diver's pair under a stray labelled line",
      [
        "DiveChek",
        "First name: Mark",
        "First name: Lena",
        "Last name: Ortiz",
        "Date of Birth: 12 Apr 1990",
        "Open Water Diver 15 Jun 2015 1506AB1234",
      ],
    ],
    [
      "the diver's pair over a stray labelled line",
      [
        "DiveChek",
        "First name: Lena",
        "Last name: Ortiz",
        "Last name: Chen",
        "Date of Birth: 12 Apr 1990",
        "Open Water Diver 15 Jun 2015 1506AB1234",
      ],
    ],
    [
      "a namesake whose labelled lines stand a blank line apart",
      [
        "DiveChek",
        "Lena Ortiz",
        "Date of Birth: 12 Apr 1990",
        "Open Water Diver 15 Jun 2015 1506AB1234",
        "",
        "First name: Lena",
        "   ",
        "Last name: Ortiz",
        "Date of Birth: 3 Sep 1987",
        "Open Water Diver 1 Jan 2012 1201CD5678",
      ],
    ],
    [
      "a count line with two counts on it",
      [
        "DiveChek",
        "1 diver selected, 3 divers found",
        "Lena Ortiz",
        "Date of Birth: 12 Apr 1990",
        "Open Water Diver 15 Jun 2015 1506AB1234",
      ],
    ],
    [
      "a count inside a sentence after another count",
      [
        "DiveChek",
        "Showing 1 diver per page, 2 divers found",
        "Lena Ortiz",
        "Date of Birth: 12 Apr 1990",
        "Open Water Diver 15 Jun 2015 1506AB1234",
      ],
    ],
    [
      "a no-results line carrying an address under the record",
      [
        "DiveChek",
        "Lena Ortiz",
        "Date of Birth: 12 Apr 1990",
        "Open Water Diver 15 Jun 2015 1506AB1234",
        "No results for lena@example.com",
      ],
    ],
    [
      "a namesake under another diver's pair cut at the record's end",
      [
        "DiveChek",
        "Lena Ortiz",
        "Date of Birth: 12 Apr 1990",
        "Open Water Diver 15 Jun 2015 1506AB1234",
        "Advanced Open Water Diver 1 Jan 2016",
        "First name: Mark",
        "Last name: Chen",
        "Date of Birth: 1 Feb 1980",
        "First name: Lena",
        "Last name: Ortiz",
        "Date of Birth: 3 Sep 1987",
        "Open Water Diver 1 Jan 2012 1201CD5678",
      ],
    ],
  ])("judges as the whole page does: %s", (_, lines) => {
    const page = lines.join("\n");
    const judge = (pageText: string) =>
      judgeAgencyPage({
        agency: "padi",
        level: "open_water",
        firstName: "Lena",
        lastName: "Ortiz",
        birthDate: "1990-04-12",
        cardNumber: null,
        today: "2026-10-15",
        pageText,
      });
    expect(judge(page).verdict).not.toBe("match");
    expect(judge(excerptAroundName(page, "Lena", "Ortiz"))).toEqual(judge(page));
  });

  it("marks lines that were not neighbors on the page, so no record runs across them", () => {
    const page = ["Lena Ortiz", "1", "2", "3", "4", "5", "6", "Lena Ortiz", "7", "", "8"];
    expect(excerptAroundName(page.join("\n"), "Lena", "Ortiz").split("\n")).toEqual([
      "Lena Ortiz",
      "1",
      "2",
      "3",
      "4",
      "…",
      "Lena Ortiz",
      "7",
      "8",
    ]);
  });

  /** Security review S4: a page without the diver hands back only why, each word once. */
  it("keeps only the words that say why, from a page that never names the diver", () => {
    const page = [
      "Welcome back, Coral Coast Divers",
      "Recent students: Sam Reyes, Mia Chen",
      "Sign in",
      "Email",
      "Password",
      ...Array(100).fill("Mark Lee"),
    ].join("\n");
    expect(excerptAroundName(page, "Lena", "Ortiz")).toBe("sign in\npassword");
    const none = ["DiveChek", "Sam Reyes", "No results found", "Mia Chen"].join("\n");
    expect(excerptAroundName(none, "Lena", "Ortiz")).toBe("no results");
    const many = Array(30).fill("Password").join("\n");
    expect(excerptAroundName(many, "Lena", "Ortiz")).toBe("password");
  });
});

/** "Try the checks": the sample page the extension carries, filled by the real filler. */
describe("the extension's sample lookup", () => {
  async function sampleRun(agency: string) {
    document.body.innerHTML = `<main id="sample"></main>`;
    window.history.replaceState(null, "", `/sample.html#${agency}`);
    const sent: { result: Record<string, unknown> }[] = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        sendMessage: (message: { result: Record<string, unknown> }) => sent.push(message),
      },
    };
    // A classic script, run afresh for each agency as the page would run it.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(`${process.cwd()}/extension/sample.js`, "utf8");
    // Handed the page's own globals, which are this test's, not Node's.
    const { compileFunction } = await import("node:vm");
    compileFunction(source, ["globalThis", "document", "location", "chrome"], {
      filename: "sample.js",
    })(
      globalThis,
      document,
      window.location,
      (globalThis as unknown as { chrome: unknown }).chrome,
    );
    return sent[0]?.result;
  }

  it("fills the SSI sample without accepting terms or submitting", async () => {
    expect(await sampleRun("ssi")).toMatchObject({
      filled: true,
      typed: true,
      submitted: false,
      manual: true,
      missing: [],
    });
  });

  it("fills each automatic agency's sample and presses its search", async () => {
    for (const agency of ["naui", "sdi", "gue"]) {
      expect(await sampleRun(agency), agency).toMatchObject({
        filled: true,
        typed: true,
        submitted: true,
        missing: [],
      });
    }
  });

  /** Domain review R7 (adversarial), nit: both of CMAS's searches, each by its own button. */
  it("tries CMAS by code and by name and birth date, each with its own button", async () => {
    expect(await sampleRun("cmas")).toMatchObject({
      filled: true,
      typed: true,
      submitted: true,
      missing: [],
    });
    const labels = Array.from(document.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(["Search by code", "Manual Search"]);
  });
});
