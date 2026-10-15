// The wire format between the DiveDay app and this extension. The app's copy
// is src/lib/cert-check-extension.ts; src/lib/cert-check-extension.test.ts
// fails if the two drift.
globalThis.DiveDayCertCheck = Object.assign(globalThis.DiveDayCertCheck || {}, {
  VERSION: "1.3.0",
  MARKER_ATTRIBUTE: "data-diveday-cert-check",
  READY_EVENT: "diveday-cert-check-ready",
  PAGE_SOURCE: "diveday-page",
  EXTENSION_SOURCE: "diveday-cert-check",
  REQUEST_TYPE: "agency-check",
  ELEARNING_REQUEST_TYPE: "elearning-check",
  RESULT_TYPE: "agency-check-result",
  PAGE_TEXT_MAX_LENGTH: 50000,
  // An address that signs in, signs up or manages an account, never a lookup:
  // the one rule the service worker and the form filler both read (the filler
  // is handed it, since an injected function sees nothing outside itself).
  SIGN_IN_PATH: "log-?in|sign-?in|sign-?up|register|account|auth|profile",
});
