/** e2e-test-routes public contract. Internals are imported only within this module. */

export type { DemoTenant } from "./rules";
export {
  e2eTestRouteAuthorized,
  holdNonDemoFixture,
  requireDemoTenant,
  takeNonDemoFixture,
  testRouteRefused,
} from "./rules";
