import { describe, expect, it } from "vitest";
import {
  AGENCY_CHECKS,
  type CheckableAgency,
  foldText,
  judgeAgencyPage,
  LEVEL_WORDING,
} from "./agency-check";

/**
 * **The judge, fuzzed against the promises the ADR makes** (round 3, idea 6;
 * ADR 20261008-cert-check-extension). A seeded generator builds results pages
 * from a small grammar: the diver's own record in several shapes, namesakes
 * (same name, another birth date and number), other divers, a count line,
 * menus that name levels, and neutral noise. Every case checks:
 *
 * - **No match without this diver's record**: the name, the birth date or
 *   number the lookup was typed with (on DiveChek the birth date, and the card
 *   number when the card has one), the claimed level in the agency's words,
 *   and no limiting word.
 * - **No match from a page with a second diver by this name** on DiveChek.
 * - **The evidence holds no other diver's name** and no namesake's birth date
 *   or number. Other divers include candidates who share only the diver's
 *   first or last name, sometimes with the birth date searched by, sometimes
 *   their name alone (a "did you mean" list), and some laid out over labeled
 *   lines: two such records must never pair into this diver's name.
 * - **The diver's clean record does match**, so the generator is not vacuous.
 * - **Deterministic, and blind to unrelated rows**: the verdict is the same
 *   when the blocks are shuffled and when noise is appended after them.
 * - **The extension's DiveChek excerpt judges as the whole page does**
 *   (`excerptAroundName` in `extension/fill.js`).
 *
 * On a public lookup the diver's record is followed by neutral lines and the
 * agency's own furniture ("Request Certification"), which ends it: a public
 * record otherwise ends only at a line naming the diver again, so a
 * neighbour's row inside its `RECORD_LINES` window is read as theirs. The ADR
 * accepts that because a public lookup lists only divers by the name searched,
 * and the evidence keeps only a record's own kinds of words. DiveChek's rule,
 * which ends the record at another diver's line, is fuzzed with neighbours
 * anywhere. A failure prints its seed.
 */

await import(/* @vite-ignore */ new URL("../../extension/fill.js", import.meta.url).href);
const { excerptAroundName } = (
  globalThis as unknown as {
    DiveDayCertCheck: {
      excerptAroundName: (text: string, firstName: string, lastName: string) => string;
    };
  }
).DiveDayCertCheck;

const CASES_PER_AGENCY = 1000;
const TODAY = "2026-10-15";
type Level = Parameters<typeof judgeAgencyPage>[0]["level"];

/** xorshift32: a few lines, no dependency, the same pages for the same seed. */
function random(seed: number) {
  let state = seed >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 2 ** 32;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(items: readonly T[]): T => items[int(items.length)] as T;
  const chance = (p: number) => next() < p;
  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = int(i + 1);
      [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
    }
    return copy;
  };
  return { int, pick, chance, shuffle };
}
type Random = ReturnType<typeof random>;

/** The diver checked: no word of theirs is any other diver's, a level's or the chrome's. */
const DIVERS = [
  { first: "Lena", middle: "María", last: "Ortiz" },
  { first: "Zoë", middle: "Anne", last: "Müller" },
  { first: "Tomás", middle: "Luis", last: "Okafor" },
  { first: "Priya", middle: "Devi", last: "Nair" },
] as const;
const OTHERS = [
  ["Mark", "Lee"],
  ["Hana", "Sato"],
  ["Owen", "Price"],
  ["Ruth", "Bello"],
  ["Ivan", "Petrov"],
] as const;

/** Page furniture from each agency's live form page (2026-10-15), levels named in menus included. */
const HEADER: Record<CheckableAgency, readonly string[]> = {
  ssi: ["Online Diver Check", "Open Water Diver", "Advanced Adventurer", "Stress & Rescue"],
  naui: [
    "Verify Certification",
    "Verify NAUI training online instantly.",
    "Entry-Level",
    "Supervised Diver",
    "Scuba Diver",
    "Advanced Scuba Diver",
    "First Name",
    "Last Name",
    "Date of Birth",
  ],
  sdi: [
    "Certification Search",
    "Dry Suit Diver",
    "Advanced Adventure",
    "Date of Birth (YYYY-MM-DD)",
    "First Name",
    "Last Name",
    "Search",
  ],
  gue: ["Verify Certification", 'Enter the number on the card following the "#"', "#:"],
  cmas: [
    "Certification Search",
    "This search confirms if a certification is registered online, but a missing result does not mean the certification is invalid.",
    "Given Name",
    "Family Name",
    "Birthdate",
    "Manual Search",
  ],
  padi: ["PADI Pros’ Site", "Online Services", "DiveChek", "Run Report"],
};
const NOISE = [
  "Contact Us",
  "Privacy Policy",
  "Request Certification",
  "Back to search",
  "Replacement Card Request Form",
  "Accept",
] as const;
const LIMITED = [
  (level: string) => `${level} (Referral)`,
  (level: string) => `${level} - student`,
  (level: string) => `${level} eLearning`,
  (level: string) => `${level}: pending`,
] as const;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Every way {@link writeDate} may print a date. */
function everyWriting(iso: string, agency: CheckableAgency): string[] {
  const [year, month, day] = iso.split("-") as [string, string, string];
  const monthName = MONTHS[Number(month) - 1] as string;
  return [
    iso,
    AGENCY_CHECKS[agency].dates === "mdy" ? `${month}/${day}/${year}` : `${day}.${month}.${year}`,
    `${Number(day)} ${monthName.slice(0, 3)} ${year}`,
    `${monthName} ${Number(day)}, ${year}`,
  ];
}

function hasWords(line: string, phrase: string): boolean {
  return ` ${foldText(line)} `.includes(` ${foldText(phrase)} `);
}

function randomDate(r: Random, unlike?: string): string {
  for (;;) {
    const iso = `${1960 + r.int(49)}-${String(1 + r.int(12)).padStart(2, "0")}-${String(1 + r.int(28)).padStart(2, "0")}`;
    if (iso !== unlike) return iso;
  }
}

/** A date as an agency might print it, numeric ones in its own order. */
function writeDate(iso: string, order: "mdy" | "dmy", r: Random): string {
  const [year, month, day] = iso.split("-") as [string, string, string];
  const monthName = MONTHS[Number(month) - 1] as string;
  return r.pick([
    iso,
    order === "mdy" ? `${month}/${day}/${year}` : `${day}.${month}.${year}`,
    `${Number(day)} ${monthName.slice(0, 3)} ${year}`,
    `${monthName} ${Number(day)}, ${year}`,
  ]);
}

function randomNumber(agency: CheckableAgency, r: Random, unlike?: string): string {
  for (;;) {
    const digits = () => String(100000 + r.int(900000));
    const number =
      agency === "padi"
        ? `${digits().slice(0, 4)}AB${digits().slice(0, 4)}`
        : `${agency.toUpperCase()}-${digits()}`;
    if (number !== unlike) return number;
  }
}

/** A name as a page might print it: as typed, in capitals, or without its accents. */
function writeName(name: string, r: Random): string {
  return r.pick([name, name.toUpperCase(), name.normalize("NFD").replace(/\p{M}/gu, "")]);
}

type Shape = "lines" | "inline" | "reversed" | "middle" | "split";
const SHAPES: readonly Shape[] = ["lines", "inline", "reversed", "middle", "split"];
/** Labels for a name over two lines, given part then family part. */
const SPLIT_LABELS = [
  ["First name", "Last name"],
  ["Given Name", "Family Name"],
  ["Forename", "Surname"],
  ["Nombre", "Apellidos"],
] as const;

/**
 * One diver's block of lines. On DiveChek the birth date sits on the name line
 * or the line under it and the card number on the level's line; on a public
 * lookup each sits on its own line.
 */
function block(input: {
  agency: CheckableAgency;
  r: Random;
  first: string;
  middle: string;
  last: string;
  shape: Shape;
  birthDate: string | null;
  number: string | null;
  levelLine: string;
  /** A candidate list's row: the name lines and nothing else. */
  nameOnly?: boolean;
}): string[] {
  const { agency, r, shape } = input;
  const first = writeName(input.first, r);
  const last = writeName(input.last, r);
  const { dates } = AGENCY_CHECKS[agency];
  const date = input.birthDate ? writeDate(input.birthDate, dates, r) : null;
  const [givenLabel, familyLabel] = r.pick(SPLIT_LABELS);
  const splitLines = [`${givenLabel}: ${first}`, `${familyLabel}: ${last}`];
  const nameLines =
    shape === "split"
      ? r.chance(0.5)
        ? splitLines
        : splitLines.reverse()
      : shape === "reversed"
        ? [`${last}, ${first}`]
        : shape === "middle"
          ? [`${first} ${writeName(input.middle, r)} ${last}`]
          : [`${first} ${last}`];
  const lines = [...nameLines];
  if (input.nameOnly) return lines;
  if (date && shape === "inline") lines[0] = `${lines[0]} ${date}`;
  else if (date) lines.push(`Date of Birth: ${date}`);
  // A record laid out under labels dates its card: the level's line carries a
  // year, which is how the judge tells it from the search form echoed back.
  const levelLine =
    shape === "split" ? `${input.levelLine} (${2010 + r.int(15)})` : input.levelLine;
  if (agency === "padi") {
    lines.push(input.number ? `${levelLine} ${input.number}` : levelLine);
  } else {
    if (input.number) lines.push(`Card ${input.number}`);
    lines.push(levelLine);
  }
  return lines;
}

type Case = {
  seed: number;
  agency: CheckableAgency;
  query: Parameters<typeof judgeAgencyPage>[0];
  blocks: { kind: "target" | "namesake" | "other"; lines: string[] }[];
  header: string[];
  footer: string[];
  target: {
    present: boolean;
    shape: Shape;
    withBirthDate: boolean;
    identified: boolean;
    levelHolds: boolean;
    limited: boolean;
  };
  namesakes: { birthDate: string; number: string }[];
  otherNames: string[];
};

function generate(agency: CheckableAgency, seed: number): Case {
  const r = random(seed);
  const diver = r.pick(DIVERS);
  const { needs } = AGENCY_CHECKS[agency];
  const wording = LEVEL_WORDING[agency];
  const levels = Object.keys(wording) as Level[];
  const level = r.pick(levels);
  const birthDate = randomDate(r);
  const number = randomNumber(agency, r);
  // What the shop holds: a PADI card may have no number on file.
  const cardNumber = agency === "padi" && r.chance(0.4) ? null : number;

  const levelLine = (from: Random) => from.pick(wording[from.pick(levels)] ?? []);

  // The diver's own record: what it carries, and whether that should certify.
  const shape = r.pick(SHAPES);
  const withBirthDate = r.chance(0.8);
  const withNumber = r.chance(0.8);
  const plainLevel = levelLine(r);
  const limited = r.chance(0.15);
  const targetLevel = limited ? r.pick(LIMITED)(plainLevel) : plainLevel;
  const levelHolds = (wording[level] ?? []).some((phrase) => hasWords(plainLevel, phrase));
  const identified =
    agency === "padi"
      ? withBirthDate && (cardNumber === null || withNumber)
      : needs === "card_number"
        ? withNumber
        : needs === "birth_date"
          ? withBirthDate
          : withBirthDate || withNumber;
  const present = r.chance(0.85);

  const blocks: Case["blocks"] = [];
  if (present) {
    blocks.push({
      kind: "target",
      lines: block({
        agency,
        r,
        ...diver,
        shape,
        birthDate: withBirthDate ? birthDate : null,
        number: withNumber ? number : null,
        levelLine: targetLevel,
      }),
    });
  }
  const namesakes: Case["namesakes"] = [];
  for (let i = r.chance(0.3) ? 1 + r.int(2) : 0; i > 0; i -= 1) {
    const namesake = {
      birthDate: randomDate(r, birthDate),
      number: randomNumber(agency, r, number),
    };
    namesakes.push(namesake);
    const namesakeShape = r.pick(SHAPES);
    blocks.push({
      kind: "namesake",
      lines: block({
        agency,
        r,
        ...diver,
        shape: namesakeShape,
        ...namesake,
        levelLine: levelLine(r),
      }),
    });
  }
  const otherNames: string[] = [];
  for (let i = r.int(4); i > 0; i -= 1) {
    const [otherFirst, otherLast] = r.pick(OTHERS);
    // A candidate sharing the diver's first or last name, but never both.
    const partial = r.chance(0.6) ? r.pick(["first", "last"] as const) : null;
    const first = partial === "first" ? diver.first : otherFirst;
    const last = partial === "last" ? diver.last : otherLast;
    if (partial !== "first") otherNames.push(first);
    if (partial !== "last") otherNames.push(last);
    // A neighbour's name and level on one line is the ADR's known gap, so
    // only a split candidate carries the birth date searched by.
    const shape = r.pick(["lines", "inline", "split", "split"] as const);
    blocks.push({
      kind: "other",
      lines: block({
        agency,
        r,
        first,
        middle: "",
        last,
        shape,
        birthDate: shape === "split" ? birthDate : randomDate(r, birthDate),
        number: randomNumber(agency, r, number),
        levelLine: levelLine(r),
        nameOnly: r.chance(0.3),
      }),
    });
  }

  const header = [...HEADER[agency]];
  if (agency === "padi" && r.chance(0.4)) {
    const named = blocks.filter((b) => b.kind !== "other").length;
    if (named > 0) header.push(named === 1 ? "1 diver found" : `${named} divers found`);
  }
  if (!present && namesakes.length === 0 && r.chance(0.5)) header.push("No record was found.");
  const footer = r.shuffle(NOISE).slice(0, 2);

  return {
    seed,
    agency,
    query: {
      agency,
      level,
      firstName: diver.first,
      lastName: diver.last,
      birthDate,
      cardNumber,
      today: TODAY,
      pageText: "",
    },
    blocks: r.shuffle(blocks),
    header,
    footer,
    target: { present, shape, withBirthDate, identified, levelHolds, limited },
    namesakes,
    otherNames,
  };
}

/**
 * The page text for an order of blocks. On a public lookup the diver's record
 * is followed by neutral lines past its window (see the file's comment).
 */
function render(c: Case, blocks: Case["blocks"]): string {
  const lines = [...c.header];
  for (const b of blocks) {
    lines.push(...b.lines);
    if (b.kind === "target" && c.agency !== "padi") lines.push(...NOISE.slice(0, 5));
  }
  lines.push(...c.footer);
  return lines.join("\n");
}

function check(c: Case, r: Random): void {
  const page = render(c, c.blocks);
  const judge = (pageText: string) => judgeAgencyPage({ ...c.query, pageText });
  const verdict = judge(page);
  const why = `seed ${c.seed} (${c.agency}, ${c.query.level})\n${page}\n→ ${JSON.stringify(verdict)}`;
  const { target } = c;
  // DiveChek's own count: the birth dates under the diver's name, or a line
  // saying two divers or more.
  const birthDates = new Set([
    ...(target.present && target.withBirthDate ? [c.query.birthDate] : []),
    ...c.namesakes.map((namesake) => namesake.birthDate),
  ]);
  const severalDivers =
    c.agency === "padi" &&
    (birthDates.size >= 2 || c.header.some((line) => /^[2-9] divers found$/.test(line)));

  expect(judge(page), why).toEqual(verdict);

  if (verdict.verdict === "match") {
    expect(target.present && target.identified, `match without this diver's record: ${why}`).toBe(
      true,
    );
    expect(target.levelHolds, `match at another level: ${why}`).toBe(true);
    expect(target.limited, `match on a limited card: ${why}`).toBe(false);
    expect(severalDivers, `match beside a second diver by this name: ${why}`).toBe(false);
    for (const word of c.otherNames) {
      expect(hasWords(verdict.evidence, word), `evidence names ${word}: ${why}`).toBe(false);
    }
    for (const namesake of c.namesakes) {
      expect(verdict.evidence, why).not.toContain(namesake.number);
      for (const written of everyWriting(namesake.birthDate, c.agency)) {
        expect(verdict.evidence, `evidence holds a namesake's birth date: ${why}`).not.toContain(
          written,
        );
      }
    }
  }
  if (severalDivers) expect(verdict.verdict, why).toBe("several_records");
  if (
    target.present &&
    target.identified &&
    target.levelHolds &&
    !target.limited &&
    !severalDivers
  ) {
    expect(verdict.verdict, `the diver's clean record did not match: ${why}`).toBe("match");
  }

  // Unrelated rows moved, and noise appended after everything, change nothing.
  expect(judge(render(c, r.shuffle(c.blocks))), `shuffled: ${why}`).toEqual(verdict);
  const noise = r.shuffle(NOISE).slice(0, 1 + r.int(5));
  expect(judge(`${page}\n${noise.join("\n")}`), `noise appended: ${why}`).toEqual(verdict);

  // The extension hands the server only the lines naming the diver on
  // DiveChek, a name split over labelled lines included: the excerpt must
  // judge as the whole page does.
  if (c.agency === "padi") {
    const excerpt = excerptAroundName(page, c.query.firstName, c.query.lastName);
    expect(judge(excerpt).verdict === "match", `excerpt: ${why}\nexcerpt:\n${excerpt}`).toBe(
      verdict.verdict === "match",
    );
  }
}

describe("judgeAgencyPage, fuzzed", () => {
  it.each(Object.keys(AGENCY_CHECKS) as CheckableAgency[])(
    "keeps every promise on %s pages",
    (agency) => {
      const base = 0x5eed0000 + Object.keys(AGENCY_CHECKS).indexOf(agency) * 100_000;
      let matches = 0;
      for (let i = 0; i < CASES_PER_AGENCY; i += 1) {
        const c = generate(agency, base + i);
        check(c, random(base + i + 1));
        if (judgeAgencyPage({ ...c.query, pageText: render(c, c.blocks) }).verdict === "match") {
          matches += 1;
        }
      }
      // The generator reaches both sides of the gate.
      expect(matches).toBeGreaterThan(CASES_PER_AGENCY / 10);
      expect(matches).toBeLessThan(CASES_PER_AGENCY * 0.9);
    },
  );
});
