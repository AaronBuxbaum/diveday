import { describe, expect, it } from "vitest";
import { CAPABILITY_ROUTE_PREFIXES } from "@/lib/capability-urls";
import { robotsRules } from "./robots";

describe("robots and the capability routes", () => {
  it("disallows every path whose first segment is a bearer capability", () => {
    const disallowed = robotsRules("https://dive.day").disallow;
    for (const prefix of CAPABILITY_ROUTE_PREFIXES) {
      expect(disallowed, `/${prefix}/ is a token route`).toContain(`/${prefix}/`);
    }
  });
});
