import { afterEach, describe, expect, it, vi } from "vitest";
import { requireCronSecret } from "./cron-auth";

const SECRET = "cron-secret-for-tests";

function request(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("https://dive.day/api/cron/reminders", { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requireCronSecret", () => {
  it("fails closed with 503 not_configured when no secret is set, whatever is presented", async () => {
    for (const secret of [undefined, ""]) {
      for (const presented of [undefined, "Bearer ", "Bearer undefined", `Bearer ${SECRET}`]) {
        const refusal = requireCronSecret(request(presented), secret);

        expect(refusal?.status).toBe(503);
        expect(await refusal?.json()).toEqual({ error: "not_configured" });
      }
    }
  });

  it("reads CRON_SECRET from the environment by default", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(requireCronSecret(request(`Bearer ${SECRET}`))?.status).toBe(503);

    vi.stubEnv("CRON_SECRET", SECRET);
    expect(requireCronSecret(request(`Bearer ${SECRET}`))).toBeNull();
  });

  it("refuses a missing authorization header with a bodiless 401", async () => {
    const refusal = requireCronSecret(request(), SECRET);

    expect(refusal?.status).toBe(401);
    expect(await refusal?.text()).toBe("");
  });

  it("refuses a wrong secret of the same length", () => {
    const wrong = SECRET.replace(/.$/, "X");
    expect(wrong).toHaveLength(SECRET.length);

    expect(requireCronSecret(request(`Bearer ${wrong}`), SECRET)?.status).toBe(401);
  });

  it("refuses a presented value of a different length without throwing", () => {
    // timingSafeEqual throws on unequal-length buffers; the digests keep the
    // lengths equal, so a short or long guess is a 401 and never a 500.
    for (const presented of ["Bearer", `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, 3)}`, "x"]) {
      expect(requireCronSecret(request(presented), SECRET)?.status).toBe(401);
    }
  });

  it("refuses the right secret without the Bearer scheme", () => {
    expect(requireCronSecret(request(SECRET), SECRET)?.status).toBe(401);
  });

  it("lets the right bearer token through", () => {
    expect(requireCronSecret(request(`Bearer ${SECRET}`), SECRET)).toBeNull();
  });
});
