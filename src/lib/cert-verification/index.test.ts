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

  it("selects each configured agency gateway before the shared gateway", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "verified" }),
    });
    const provider = providerWith(
      {
        PADI_CERT_VERIFICATION_URL: "https://padi.example/check",
        PADI_CERT_VERIFICATION_API_KEY: "padi-key",
        SSI_CERT_VERIFICATION_URL: "https://ssi.example/check",
        SSI_CERT_VERIFICATION_API_KEY: "ssi-key",
        CERT_VERIFICATION_URL: "https://shared.example/check",
        CERT_VERIFICATION_API_KEY: "shared-key",
      },
      fetchImpl,
    );

    await expect(verifyCard(request, provider)).resolves.toEqual({ status: "verified" });
    await expect(
      verifyCard({ ...request, agency: "ssi", identifier: "SSI-456" }, provider),
    ).resolves.toEqual({ status: "verified" });

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://padi.example/check",
      "https://ssi.example/check",
    ]);
    expect(fetchImpl.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual([
      "Bearer padi-key",
      "Bearer ssi-key",
    ]);
  });

  it("does not use another agency's credential when no shared gateway is configured", async () => {
    const fetchImpl = vi.fn();
    const provider = providerWith(
      {
        SSI_CERT_VERIFICATION_URL: "https://ssi.example/check",
        SSI_CERT_VERIFICATION_API_KEY: "ssi-key",
      },
      fetchImpl,
    );

    await expect(verifyCard(request, provider)).resolves.toEqual({ status: "unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
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
