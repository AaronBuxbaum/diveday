// The lookup pages this extension fills in, one per agency. The addresses are
// the ones the DiveDay app links to (src/lib/agency-verification.ts), and
// src/lib/cert-check-extension.test.ts fails if they drift. `fields` lists
// what the form is filled with, in the order the agency's form asks for it.
// `dateFormat` is how a typed (not date-picker) birth-date box wants it.
globalThis.DiveDayCertCheck = Object.assign(globalThis.DiveDayCertCheck || {}, {
  AGENCIES: {
    ssi: {
      url: "https://my.divessi.com/online_diver_check",
      fields: ["name", "number"],
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
  },
});
