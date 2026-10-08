import { describe, expect, it } from "vitest";
import {
  courseWords,
  ELEARNING_EVIDENCE_MAX_LENGTH,
  elearningCheckQuery,
  judgeElearningPage,
} from "./elearning-check";

const lena = {
  firstName: "Lena",
  lastName: "Ortiz",
  email: "lena.ortiz@example.com",
  courseTitle: "PADI Open Water Diver",
} as const;

function judge(pageText: string, overrides: Partial<Record<keyof typeof lena, string>> = {}) {
  return judgeElearningPage({ ...lena, ...overrides, pageText });
}

describe("elearningCheckQuery", () => {
  const base = {
    agency: "padi",
    fullName: "Lena María Ortiz",
    email: "Lena.Ortiz@Example.com ",
    courseTitle: "PADI Open Water Diver",
  };

  it("searches PADI by the student's email, with the first and last words of the name", () => {
    expect(elearningCheckQuery(base)).toEqual({
      agency: "padi",
      firstName: "Lena",
      lastName: "Ortiz",
      email: "lena.ortiz@example.com",
      courseTitle: "PADI Open Water Diver",
    });
  });

  it("checks nothing for an agency other than PADI", () => {
    for (const agency of ["ssi", "naui", "sdi", "other"]) {
      expect(elearningCheckQuery({ ...base, agency })).toBeNull();
    }
  });

  it("needs an email, which is what PADI files eLearning under", () => {
    expect(elearningCheckQuery({ ...base, email: null })).toBeNull();
    expect(elearningCheckQuery({ ...base, email: "not-an-address" })).toBeNull();
  });

  it("needs a two-word name and a course title that names a course", () => {
    expect(elearningCheckQuery({ ...base, fullName: "Lena" })).toBeNull();
    expect(elearningCheckQuery({ ...base, courseTitle: "PADI Course" })).toBeNull();
  });
});

describe("courseWords", () => {
  it("drops the agency and words every eLearning product shares", () => {
    expect(courseWords("PADI Open Water Diver Course")).toEqual(["open", "water", "diver"]);
    expect(courseWords("Advanced Open Water (eLearning)")).toEqual(["advanced", "open", "water"]);
  });
});

describe("judgeElearningPage", () => {
  it("reads a table row that names the student, the course and Complete", () => {
    const page = [
      "eLearning Students",
      "Name\tEmail\tProduct\tStatus",
      "Lena Ortiz\tlena.ortiz@example.com\tOpen Water Diver Online\tComplete",
    ].join("\n");
    expect(judge(page)).toEqual({
      verdict: "complete",
      evidence: "Lena Ortiz lena.ortiz@example.com Open Water Diver Online Complete",
    });
  });

  it("reads a record laid out over several lines, and 100%", () => {
    const page = [
      "Lena Ortiz",
      "lena.ortiz@example.com",
      "Open Water Diver Online",
      "Progress: 100%",
    ].join("\n");
    expect(judge(page).verdict).toBe("complete");
  });

  it("needs the email too, so a namesake's finished course ticks nothing", () => {
    const page = "Lena Ortiz\tlena.o@other.example\tOpen Water Diver Online\tComplete";
    expect(judge(page).verdict).toBe("unreadable");
  });

  it("needs the name too", () => {
    const page = "Sam Ortiz\tlena.ortiz@example.com\tOpen Water Diver Online\tComplete";
    expect(judge(page).verdict).toBe("unreadable");
  });

  it.each([
    "In Progress",
    "Incomplete",
    "Not Started",
    "Not complete",
    "62%",
    "Expired",
    "Refunded",
  ])("does not tick a course whose status reads %s", (status) => {
    const result = judge(`Lena Ortiz\tlena.ortiz@example.com\tOpen Water Diver Online\t${status}`);
    expect(result.verdict).toBe("not_complete");
  });

  it("does not take a finished higher course for this one", () => {
    const page = [
      "Lena Ortiz\tlena.ortiz@example.com\tAdvanced Open Water Diver Online\tComplete",
      "Lena Ortiz\tlena.ortiz@example.com\tOpen Water Diver Online\tIn Progress",
    ].join("\n");
    expect(judge(page).verdict).toBe("not_complete");
  });

  it("finds this course's row among the student's others", () => {
    const page = [
      "Lena Ortiz",
      "lena.ortiz@example.com",
      "Enriched Air Diver Online\tIn Progress",
      "Open Water Diver Online\tComplete",
    ].join("\n");
    expect(judge(page).verdict).toBe("complete");
  });

  it("never reads the next student's status as this one's", () => {
    const page = [
      "Lena Ortiz\tlena.ortiz@example.com\tOpen Water Diver Online\tIn Progress",
      "Sam Reyes\tsam@example.com\tOpen Water Diver Online\tComplete",
    ].join("\n");
    expect(judge(page).verdict).toBe("not_complete");
  });

  it("never reads a sibling's row on a shared family email as this student's", () => {
    const page = [
      "Lena Ortiz\tlena.ortiz@example.com\tOpen Water Diver Online\tIn Progress",
      "Mia Ortiz\tlena.ortiz@example.com\tOpen Water Diver Online\tComplete",
    ].join("\n");
    expect(judge(page).verdict).toBe("not_complete");
  });

  it("does not borrow the status of the course on the next line", () => {
    const page = [
      "Lena Ortiz",
      "lena.ortiz@example.com",
      "Rescue Diver Online",
      "Emergency First Response Primary & Secondary Care\tComplete",
    ].join("\n");
    expect(judge(page, { courseTitle: "Rescue Diver" }).verdict).toBe("not_complete");
  });

  it.each([
    "3 of 5 sections completed",
    "Knowledge Reviews 4/5 completed",
    "Complete by 12/01/2026",
    "Scuba Diver portion complete",
    "Started",
    "Assigned",
  ])("does not take a partial or a deadline for finished: %s", (status) => {
    const result = judge(`Lena Ortiz\tlena.ortiz@example.com\tOpen Water Diver Online\t${status}`);
    expect(result.verdict).toBe("not_complete");
  });

  it("reads a finished date as a date, not a count of parts", () => {
    const page =
      "Lena Ortiz\tlena.ortiz@example.com\tOpen Water Diver Online\tCompleted 03/15/2026";
    expect(judge(page).verdict).toBe("complete");
  });

  it.each([
    ["Deep Diver", "Tec Deep Diver Online"],
    ["Freediver", "Basic Freediver Online"],
    ["Open Water Diver", "Junior Open Water Diver Online"],
  ])("does not take another course that holds every word of %s", (courseTitle, product) => {
    const page = `Lena Ortiz\tlena.ortiz@example.com\t${product}\tComplete`;
    expect(judge(page, { courseTitle }).verdict).toBe("not_complete");
  });

  it("matches a shop's referral run of a course to PADI's eLearning for it", () => {
    const page = "Lena Ortiz\tlena.ortiz@example.com\tOpen Water Diver Online\tComplete";
    expect(judge(page, { courseTitle: "Open Water Diver Referral" }).verdict).toBe("complete");
  });

  it("reads a crafted overlong line quickly, and only its start", () => {
    const started = performance.now();
    const page = `Lena ${"x ".repeat(25_000)}`;
    expect(judge(page).verdict).toBe("unreadable");
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("reads 'no results' as no record, even beside an echo of the search", () => {
    expect(judge("Search results for lena.ortiz@example.com\nNo results found")).toEqual({
      verdict: "no_record",
    });
  });

  it("calls a sign-in page or anything else unreadable", () => {
    expect(judge("Sign in to the PADI Pros' Site\nEmail\nPassword")).toEqual({
      verdict: "unreadable",
    });
    expect(judge("")).toEqual({ verdict: "unreadable" });
  });

  it("ignores accents, case and how the email is written", () => {
    expect(
      judge("LENA ORTÍZ\tLena.Ortiz@Example.com\tOPEN WATER DIVER ONLINE\tCOMPLETED").verdict,
    ).toBe("complete");
  });

  it("keeps the evidence short", () => {
    const result = judge(
      `Lena Ortiz\tlena.ortiz@example.com\tOpen Water Diver Online ${"x".repeat(400)}\tComplete`,
    );
    expect(result.verdict).toBe("complete");
    if (result.verdict === "complete") {
      expect(result.evidence.length).toBeLessThanOrEqual(ELEARNING_EVIDENCE_MAX_LENGTH);
    }
  });
});
