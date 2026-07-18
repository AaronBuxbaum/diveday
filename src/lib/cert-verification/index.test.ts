import { describe, expect, it, vi } from "vitest";
import { certVerificationProviderFromEnvironment, verifyCard } from "./index";

const request = { agency: "padi", level: "open_water", identifier: "PADI-123" };

function providerWith(env: Record<string, string | undefined>, fetchImpl: unknown) {
  return certVerificationProviderFromEnvironment(env, fetchImpl as typeof fetch);
}

describe("certification verification seam", () => {
  it("is unavailable when the gateway is not configured", async () => {
    const provider = providerWith({}, vi.fn());
    expect(await verifyCard(request, provider)).toEqual({ status: "unavailable" });
  });

  it("returns a verified result with the agency reference", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "verified", reference: "AG-987" }),
    });
    const provider = providerWith(
      { CERT_VERIFICATION_URL: "https://verify.example/check", CERT_VERIFICATION_API_KEY: "k" },
      fetchImpl,
    );
    expect(await verifyCard(request, provider)).toEqual({
      status: "verified",
      reference: "AG-987",
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://verify.example/check");
    expect(init.headers.Authorization).toBe("Bearer k");
  });

  it("passes through not_found and mismatch", async () => {
    for (const status of ["not_found", "mismatch"] as const) {
      const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status }) });
      const provider = providerWith(
        { CERT_VERIFICATION_URL: "https://verify.example/check", CERT_VERIFICATION_API_KEY: "k" },
        fetchImpl,
      );
      expect(await verifyCard(request, provider)).toEqual({ status });
    }
  });

  it("fails closed to unavailable on a non-ok response, bad body, or network error", async () => {
    const config = {
      CERT_VERIFICATION_URL: "https://verify.example/check",
      CERT_VERIFICATION_API_KEY: "k",
    };
    const notOk = providerWith(
      config,
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );
    expect(await verifyCard(request, notOk)).toEqual({ status: "unavailable" });

    const badBody = providerWith(
      config,
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "who-knows" }) }),
    );
    expect(await verifyCard(request, badBody)).toEqual({ status: "unavailable" });

    const threw = providerWith(config, vi.fn().mockRejectedValue(new Error("network")));
    expect(await verifyCard(request, threw)).toEqual({ status: "unavailable" });
  });
});
