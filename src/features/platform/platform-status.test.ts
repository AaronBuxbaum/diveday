import { describe, expect, it } from "vitest";
import {
  overallPlatformStatus,
  PLATFORM_COMPONENTS,
  type PlatformComponent,
} from "./platform-status";

const up = (id: PlatformComponent["id"]): PlatformComponent => ({ id, state: "up" });
const down = (id: PlatformComponent["id"]): PlatformComponent => ({ id, state: "down" });

describe("overallPlatformStatus", () => {
  it("is ok only when every component answered", () => {
    expect(overallPlatformStatus([up("serving"), up("database")])).toBe("ok");
  });

  it("is degraded when the app is serving but a dependency is not", () => {
    // The case the page exists for: the deployment is fine, the database is
    // gone, and a status page reporting a flat "up" would be a lie a shop
    // cannot argue with.
    expect(overallPlatformStatus([up("serving"), down("database")])).toBe("degraded");
  });

  it("is down when nothing answered", () => {
    expect(overallPlatformStatus([down("serving"), down("database")])).toBe("down");
  });

  it("treats an empty report as down rather than as a clean bill", () => {
    // Nothing checked is never evidence of health — the same posture as the
    // cost-guardrail probes and the uptime alarm's breaching-on-missing-data.
    expect(overallPlatformStatus([])).toBe("down");
  });

  it("reports on the app and its database, in that order", () => {
    expect(PLATFORM_COMPONENTS).toEqual(["serving", "database"]);
  });
});
