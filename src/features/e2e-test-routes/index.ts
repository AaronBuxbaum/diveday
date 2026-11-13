/** e2e-test-routes public contract. Internals are imported only within this module. */

export {
  clearManifestReadCount,
  getManifestReadCount,
  recordManifestRead,
  resetManifestReadCount,
} from "./manifest-read-counter";

export {
  armNavigationGate,
  clearNavigationGates,
  releaseNavigationGate,
  waitForNavigationGate,
} from "./navigation-gate";
export type { DemoTenant } from "./rules";
export {
  e2eTestRouteAuthorized,
  holdNonDemoFixture,
  requireDemoTenant,
  takeNonDemoFixture,
  testRouteRefused,
} from "./rules";
