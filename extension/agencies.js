// The lookup pages this extension fills in, one per agency. The addresses are
// the ones the DiveDay app links to (src/lib/agency-verification.ts), and
// src/lib/cert-check-extension.test.ts fails if they drift. `fields` lists
// what the form is filled with, in the order the agency's form asks for it.
// `dateFormat` is how a typed (not date-picker) birth-date box wants it.
// `origins`, on a lookup behind the shop's own sign-in, lists every host the
// lookup may be sent between and still be the signed-in site (background.js).

// PADI's own pages send pros to pro.padi.com (its sign-in page, its 2024
// member brochure, its member FAQ); pros.padi.com also answers. Either may
// send the tab to the other, so both are PADI's Pros' Site.
const PADI_ORIGINS = ["https://pro.padi.com", "https://pros.padi.com"];

globalThis.DiveDayCertCheck = Object.assign(globalThis.DiveDayCertCheck || {}, {
  AGENCIES: {
    ssi: {
      url: "https://my.divessi.com/online_diver_check",
      fields: ["name", "birthDate"],
      dateFormat: "YYYY-MM-DD",
    },
    naui: {
      url: "https://www.naui.org/services/verify-diver-certification/",
      fields: ["name", "birthDate"],
      dateFormat: "MM/DD/YYYY",
    },
    sdi: {
      url: "https://www.tdisdi.com/cert-search/",
      fields: ["birthDate", "name"],
      dateFormat: "YYYY-MM-DD",
    },
    gue: {
      url: "https://www.gue.com/verifycard",
      fields: ["number"],
      dateFormat: "YYYY-MM-DD",
    },
    cmas: {
      url: "https://portal.cmas.org/certifications",
      // The code when there is one; otherwise names and birth date.
      fields: ["number", "name", "birthDate"],
      dateFormat: "YYYY-MM-DD",
      either: true,
    },
    // DiveChek, on the PADI Pros' Site, behind the shop's own PADI sign-in:
    // the staffer's browser is already signed in, DiveDay never is. `signIn`
    // holds the filler and the service worker tighter (fill.js, background.js):
    // search boxes only, never a sign-in or account page, and only this
    // diver's lines come back. The address and the form are a best guess that
    // has not been tried against the live site (issue #2259).
    padi: {
      url: "https://pro.padi.com/divechek",
      origins: PADI_ORIGINS,
      fields: ["name", "birthDate"],
      dateFormat: "MM/DD/YYYY",
      signIn: true,
    },
  },
  // Where a course student's eLearning progress is read, by agency. PADI shows
  // it only to a professional signed in to the PADI Pros' Site, so this opens
  // the page in the staffer's own browser, where they already are; DiveDay
  // never holds that sign-in. The address and the search box are a best guess
  // that has not been tried against the live site (issue #2259): a page that
  // does not read as a result writes nothing.
  ELEARNING: {
    padi: {
      url: "https://pro.padi.com/",
      origins: PADI_ORIGINS,
      fields: ["email"],
      dateFormat: "YYYY-MM-DD",
      signIn: true,
    },
  },
});
