import type { AgencyCheckVerdict, judgeAgencyPage } from "@/lib/agency-check";

/**
 * **Public lookup pages as the extension would read them** (round 3, idea 7),
 * for `src/lib/agency-check.fixtures.test.ts`.
 *
 * Each agency's page furniture (navigation, headings, form labels, notes,
 * footer) is the live page's own text, read on 2026-10-15 from NAUI's
 * verify-diver-certification, SDI's cert-search, CMAS's certifications portal
 * and GUE's verifycard. Their results are drawn by script after a search, so
 * no result block has been seen: each one here is a stand-in in a plausible
 * shape, placed where the page's main content sits. NAUI's "No record was
 * found." is the page's own wording; the others' no-result lines are guesses.
 * SSI and PADI are not here: neither page is reachable without a person
 * (robots.txt, and PADI's member sign-in).
 *
 * The diver is made up: Lena María Ortiz, born 12 April 1990.
 */
export type AgencyPageFixture = {
  name: string;
  query: Omit<Parameters<typeof judgeAgencyPage>[0], "pageText" | "today">;
  pageText: string;
  expected: AgencyCheckVerdict["verdict"];
};

const lena = { firstName: "Lena", lastName: "Ortiz", birthDate: "1990-04-12" } as const;

const NAUI_TOP = [
  "Locate Dive Center",
  "Consumer Protection",
  "Contact Us",
  "FAQs",
  "Shop",
  "Sign Up/Log In",
  "Learn",
  "Continuing Education",
  "Entry-Level",
  "Apnea",
  "Recognition",
  "Specialty",
  "Technical Diver",
  "Leadership",
  "First Aid",
  "Public Safety Diving",
  "Scientific Diving",
  "Supervised Diver",
  "Support Course",
  "Manufacturer Specified Specialty",
  "Services",
  "Verify Diver Certification",
  "Verify Dive Professional",
  "Locate Dive Centers",
  "Locate Dive Professionals",
  "Home • Services • Verify Diver Certification",
  "Verify Certification",
  "Verify NAUI training online instantly.",
  "Please visit our Verify Dive Professional service to view leadership certifications.",
  "First Name",
  "Last Name",
  "Date of Birth",
];
const NAUI_BOTTOM = [
  "Replacement Card Request Form",
  "NAUI Worldwide",
  "Our Heritage",
  "About NAUI",
  "Awards",
  "Events",
  "Careers",
];
const naui = (...result: string[]) => [...NAUI_TOP, ...result, ...NAUI_BOTTOM].join("\n");

const SDI_TOP = [
  "Home",
  "Contact",
  "eLearning",
  "Log in or Register",
  "Courses",
  "SDI Diver Courses",
  "Learn to Scuba Dive",
  "Dry Suit Diver",
  "Advanced Adventure",
  "View All Scuba Diver Courses",
  "TDI Tech Courses",
  "Technical Diver",
  "Rebreather Diver",
  "TDI Nitrox Diver",
  "Certification Cards",
  "Verify a Professional",
  "Certification Search",
  "Need to verify you are certified or order a replacement card? Please follow the steps below.",
  "1 Please provide us with some basic information.",
  "Required fields marked with *",
  "Date of Birth (YYYY-MM-DD)",
  "First Name",
  "Last Name",
  "Search",
];
const SDI_BOTTOM = [
  "? Don't see your certification?",
  "If your certification was in 2009 or previous it might not show up in this online search. Please contact us at Headquarters or submit a request below so that we can expand our search and locate your records.",
  "Request Certification",
];
const sdi = (...result: string[]) => [...SDI_TOP, ...result, ...SDI_BOTTOM].join("\n");

const CMAS_TOP = [
  "Certification Search",
  "Use the form below to find certification information quickly.",
  "Important Information",
  "CMAS plastic cards attest to the certification, without the need for additional online verification.",
  // The page's sentence before this one is left out: it spells "centralised".
  "It is the duty of each National Federation to load their members information onto the CMAS portal.",
  "This search confirms if a certification is registered online, but a missing result does not mean the certification is invalid.",
  "Search by CMAS Code",
  "CMAS Code",
  "Scan QR Code",
  "Search by code",
  "Search by personal details",
  "Given Name",
  "Family Name",
  "Birthdate",
  "Manual Search",
];
const CMAS_BOTTOM = [
  "Cookie Notice",
  "We use essential cookies to ensure the proper functioning of our website, including session management and security features. No tracking or analytics cookies are used.",
  "Learn More",
  "Accept",
];
const cmas = (...result: string[]) => [...CMAS_TOP, ...result, ...CMAS_BOTTOM].join("\n");

const GUE_TOP = [
  "Site map",
  "Contact",
  "InDepth Magazine",
  "Log in",
  "Create an Account",
  "Diver Training",
  "Why Train with GUE?",
  "How to Become a Diver",
  "GUE Instructors",
  "GUE Standards",
  "Verify Certification",
  'Enter the number on the card following the "#"',
  "#:",
];
const GUE_BOTTOM = [
  "FIND YOUR GUE",
  "Instructor",
  "Course",
  "Dive Center",
  "Project, Dive Trip, Event",
  "GUE Resources",
  "Project Baseline",
  "Quest Magazine",
  "Privacy Policy",
  "© 1998-2023 Global Underwater Explorers",
];
/** GUE's verified card, then a "Verify another card" link, then the footer. */
const gue = (...result: string[]) =>
  [...GUE_TOP, ...result, "Verify another card", "Back to search", ...GUE_BOTTOM].join("\n");

export const AGENCY_PAGE_FIXTURES: readonly AgencyPageFixture[] = [
  // NAUI: first name, last name, birth date; month first.
  {
    name: "NAUI, the diver's record under the menus that name levels",
    query: { agency: "naui", level: "open_water", ...lena, cardNumber: null },
    pageText: naui(
      "Lena Ortiz",
      "Date of Birth: 04/12/1990",
      "Certification: Advanced Scuba Diver",
      "Certification Date: 06/15/2015",
    ),
    expected: "match",
  },
  {
    name: "NAUI, a higher claim than the record shows",
    query: { agency: "naui", level: "rescue", ...lena, cardNumber: null },
    pageText: naui(
      "Lena Ortiz",
      "Date of Birth: 04/12/1990",
      "Certification: Advanced Scuba Diver",
      "Certification Date: 06/15/2015",
    ),
    expected: "level_unconfirmed",
  },
  {
    name: "NAUI, results as a table with the names in separate cells",
    query: { agency: "naui", level: "open_water", ...lena, cardNumber: null },
    pageText: naui(
      "First Name\tLast Name\tDate of Birth\tCertification\tDate",
      "Lena\tOrtiz\t04/12/1990\tScuba Diver\t06/15/2015",
    ),
    expected: "match",
  },
  {
    name: "NAUI, the name split over two labeled lines",
    query: { agency: "naui", level: "open_water", ...lena, cardNumber: null },
    pageText: naui(
      "First Name: Lena",
      "Last Name: Ortiz",
      "Date of Birth: 04/12/1990",
      "Scuba Diver",
    ),
    expected: "match",
  },
  {
    name: "NAUI, its own 'No record was found.'",
    query: { agency: "naui", level: "open_water", ...lena, cardNumber: null },
    pageText: naui(
      "No record was found.",
      "Please review search information and correct if any errors are found.",
    ),
    expected: "no_record",
  },
  {
    name: "NAUI, a namesake born another day",
    query: { agency: "naui", level: "open_water", ...lena, cardNumber: null },
    pageText: naui("Lena Ortiz", "Date of Birth: 07/01/1985", "Certification: Scuba Diver"),
    expected: "namesake",
  },
  {
    name: "NAUI, the birth date transposed",
    query: { agency: "naui", level: "open_water", ...lena, cardNumber: null },
    pageText: naui("Lena Ortiz", "Date of Birth: 12/04/1990", "Certification: Scuba Diver"),
    expected: "namesake",
  },
  {
    name: "NAUI, a junior rating",
    query: { agency: "naui", level: "open_water", ...lena, cardNumber: null },
    pageText: naui("Lena Ortiz", "Date of Birth: 04/12/1990", "Certification: Junior Scuba Diver"),
    expected: "limited_card",
  },
  // SDI: birth date first, YYYY-MM-DD; per-card numbers.
  {
    name: "SDI, one row per card",
    query: { agency: "sdi", level: "open_water", ...lena, cardNumber: "SDI-1001" },
    pageText: sdi(
      "Name\tDate of Birth\tCertification\tIssued\tCard #",
      "Lena Ortiz\t1990-04-12\tOpen Water Scuba Diver\t2015-06-15\tSDI-1001",
    ),
    expected: "match",
  },
  {
    name: "SDI, Advanced Adventure Diver beside the menu's 'Advanced Adventure'",
    query: { agency: "sdi", level: "advanced_open_water", ...lena, cardNumber: null },
    pageText: sdi("Lena Ortiz", "1990-04-12", "Advanced Adventure Diver", "2018-02-02"),
    expected: "match",
  },
  {
    name: "SDI, two divers by the name, the right one second",
    query: { agency: "sdi", level: "open_water", ...lena, cardNumber: null },
    pageText: sdi(
      "2 results",
      "Lena Ortiz",
      "1985-07-01",
      "Advanced Adventure Diver",
      "Lena Ortiz",
      "1990-04-12",
      "Open Water Scuba Diver",
    ),
    expected: "match",
  },
  {
    name: "SDI, only the menu's levels and a no-result line",
    query: { agency: "sdi", level: "open_water", ...lena, cardNumber: null },
    pageText: sdi("No results found."),
    expected: "no_record",
  },
  {
    name: "SDI, the form again with nothing under it",
    query: { agency: "sdi", level: "open_water", ...lena, cardNumber: null },
    pageText: sdi(),
    expected: "unreadable",
  },
  // CMAS: a CMAS code, or given name, family name and birthdate; day first.
  {
    name: "CMAS, the name split over its own labels",
    query: { agency: "cmas", level: "open_water", ...lena, cardNumber: null },
    pageText: cmas(
      "Given Name: Lena María",
      "Family Name: Ortiz",
      "Birthdate: 12.04.1990",
      "One Star Diver",
      "Federation: FEDAS",
    ),
    expected: "match",
  },
  {
    name: "CMAS, found by its code",
    query: {
      agency: "cmas",
      level: "advanced_open_water",
      ...lena,
      birthDate: null,
      cardNumber: "ESP-2B-77123",
    },
    pageText: cmas("Lena Ortiz", "CMAS Code: ESP-2B-77123", "2 Star Diver", "Federation: FEDAS"),
    expected: "match",
  },
  {
    name: "CMAS, a month-first birth date reads as another diver",
    query: { agency: "cmas", level: "open_water", ...lena, cardNumber: null },
    pageText: cmas("Lena Ortiz", "Birthdate: 04.12.1990", "1 Star Diver"),
    expected: "namesake",
  },
  {
    name: "CMAS, a split pair whose family name is a neighbor's",
    query: { agency: "cmas", level: "open_water", ...lena, cardNumber: null },
    pageText: cmas(
      "Given Name: Lena",
      "Family Name: Smith",
      "Birthdate: 12.04.1990",
      "One Star Diver",
    ),
    expected: "unreadable",
  },
  {
    name: "CMAS, nothing found",
    query: { agency: "cmas", level: "open_water", ...lena, cardNumber: null },
    pageText: cmas("No certification found."),
    expected: "no_record",
  },
  // GUE: the number after the "#".
  {
    name: "GUE, the card by its number",
    query: { agency: "gue", level: "open_water", ...lena, birthDate: null, cardNumber: "204411" },
    pageText: gue("Lena Ortiz", "#204411", "Recreational Diver 1", "Issued: 2019-03-02"),
    expected: "match",
  },
  {
    name: "GUE, another diver's number",
    query: { agency: "gue", level: "open_water", ...lena, birthDate: null, cardNumber: "204411" },
    pageText: gue("Lena Ortiz", "#209999", "Recreational Diver 1"),
    expected: "namesake",
  },
  {
    name: "GUE, a professional card names the trainer's title",
    query: { agency: "gue", level: "open_water", ...lena, birthDate: null, cardNumber: "204411" },
    pageText: gue("Lena Ortiz", "#204411", "Recreational Diver 1 Instructor"),
    expected: "limited_card",
  },
  {
    // The footer's "Instructor" link is page furniture, not a trainer's title.
    name: "GUE, the footer straight under a short record",
    query: { agency: "gue", level: "open_water", ...lena, birthDate: null, cardNumber: "204411" },
    pageText: [...GUE_TOP, "Lena Ortiz", "#204411", "Recreational Diver 1", ...GUE_BOTTOM].join(
      "\n",
    ),
    expected: "match",
  },
];
