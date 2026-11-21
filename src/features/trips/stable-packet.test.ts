import { describe, expect, it } from "vitest";
import { stablePacket } from "./stable-packet";

const identity = (tripVersion: string, boatVersion = "1", shopVersion = "1") => ({
  title: "Reef",
  tripVersion,
  boatVersion,
  shopVersion,
});

describe("stable packet composition", () => {
  it("returns all sections only after matching identity observations", async () => {
    const result = await stablePacket(
      async () => identity("1"),
      async () => ["dives", "manifest", "prep"],
    );
    expect(result).toEqual({ status: "stable", packet: ["dives", "manifest", "prep"] });
  });

  it.each(["tripVersion", "boatVersion", "shopVersion"] as const)(
    "discards an ABA %s change and rereads every section",
    async (field) => {
      let version = "1";
      let compositions = 0;
      const result = await stablePacket(
        async () => ({ ...identity("1"), [field]: version }),
        async () => {
          compositions++;
          if (compositions === 1) version = "2";
          return `all sections attempt ${compositions}`;
        },
      );
      expect(compositions).toBe(2);
      expect(result).toEqual({ status: "stable", packet: "all sections attempt 2" });
    },
  );

  it("never returns stale or partial sections when both attempts race", async () => {
    let version = 1;
    const result = await stablePacket(
      async () => identity(String(version)),
      async () => {
        version++;
        return "conflicting roster";
      },
    );
    expect(version).toBe(3);
    expect(result).toEqual({ status: "changed" });
  });

  it("keeps a vanished departure explicit after composition began", async () => {
    let present = true;
    const result = await stablePacket(
      async () => (present ? identity("1") : null),
      async () => {
        present = false;
        return "stale roster";
      },
    );
    expect(result).toEqual({ status: "changed" });
  });

  it("retries a reader failure caused by an identity edit without silently dropping the departure", async () => {
    let version = 1;
    const result = await stablePacket(
      async () => identity(String(version)),
      async () => {
        if (version === 1) {
          version++;
          throw new Error("route disappeared mid-read");
        }
        return "fresh complete packet";
      },
    );
    expect(result).toEqual({ status: "stable", packet: "fresh complete packet" });
  });

  it("rethrows the original composition error when identity has not changed", async () => {
    const error = new Error("real reader failure");
    let attempts = 0;
    await expect(
      stablePacket(
        async () => identity("1"),
        async () => {
          attempts++;
          throw error;
        },
      ),
    ).rejects.toBe(error);
    expect(attempts).toBe(1);
  });

  it("retains the absent-before-reading contract", async () => {
    const result = await stablePacket(
      async () => null,
      async () => {
        throw new Error("must not compose");
      },
    );
    expect(result).toEqual({ status: "missing" });
  });
});
