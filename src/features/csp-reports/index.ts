/** csp-reports public contract. Internals are imported only within this module. */
export type { CspViolation } from "./rules";
export { blockedOrigin, parseCspReports, reportRoute, sourceOrigin } from "./rules";
