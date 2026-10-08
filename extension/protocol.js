// The wire format between the DiveDay app and this extension. The app's copy
// is src/lib/cert-check-extension.ts; src/lib/cert-check-extension.test.ts
// fails if the two drift.
globalThis.DiveDayCertCheck = Object.assign(globalThis.DiveDayCertCheck || {}, {
  VERSION: "1.1.0",
  MARKER_ATTRIBUTE: "data-diveday-cert-check",
  READY_EVENT: "diveday-cert-check-ready",
  PAGE_SOURCE: "diveday-page",
  EXTENSION_SOURCE: "diveday-cert-check",
  REQUEST_TYPE: "agency-check",
  ELEARNING_REQUEST_TYPE: "elearning-check",
  RESULT_TYPE: "agency-check-result",
  PAGE_TEXT_MAX_LENGTH: 50000,
});
