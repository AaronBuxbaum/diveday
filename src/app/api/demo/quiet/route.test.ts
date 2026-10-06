import { describe, expect, it } from "vitest";
import { DEV_ONBOARD_SETUP_KEY } from "@/lib/onboard-setup-key";
import { isQuietDemoDevice, QUIET_DEMO_COOKIE } from "@/lib/quiet-demo-device";
import { GET } from "./route";

function open(query: string) {
  return GET(new Request(`http://localhost:3000/api/demo/quiet${query}`));
}

describe("GET /api/demo/quiet", () => {
  it("marks the browser and lands on the homepage for the setup key", async () => {
    const response = await open(`?setup=${DEV_ONBOARD_SETUP_KEY}`);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
    const cookie = response.cookies.get(QUIET_DEMO_COOKIE);
    expect(isQuietDemoDevice(cookie?.value)).toBe(true);
    expect(cookie?.value).not.toContain(DEV_ONBOARD_SETUP_KEY);
    expect(cookie?.httpOnly).toBe(true);
  });

  it("is a bare 404 without the key, and marks nothing", async () => {
    for (const query of ["", "?setup=", "?setup=guess"]) {
      const response = await open(query);
      expect(response.status).toBe(404);
      expect(response.cookies.get(QUIET_DEMO_COOKIE)).toBeUndefined();
    }
  });
});
