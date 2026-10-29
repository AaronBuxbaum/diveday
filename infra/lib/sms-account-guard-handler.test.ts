import { describe, expect, it } from "vitest";
import {
  allowedFor,
  applySmsAccountGuard,
  countryRuleUpdates,
  UPDATE_BATCH_SIZE,
} from "./sms-account-guard-handler";

const props = { MonthlySpendLimitUsd: "50", AllowedSmsCountries: ["US"] };

function recorder(rules: Record<string, { ProtectStatus: string }>) {
  const calls: [string, Record<string, unknown>][] = [];
  const send = async (command: string, input: Record<string, unknown>) => {
    calls.push([command, input]);
    if (command === "CreateProtectConfiguration") return { ProtectConfigurationId: "protect-abc" };
    if (command === "GetProtectConfigurationCountryRuleSet") return { CountryRuleSet: rules };
    return {};
  };
  return { calls, send };
}

describe("countryRuleUpdates", () => {
  it("allows only the named countries and blocks the rest", () => {
    const [updates] = countryRuleUpdates(
      {
        US: { ProtectStatus: "BLOCK" },
        FR: { ProtectStatus: "ALLOW" },
        CA: { ProtectStatus: "ALLOW" },
      },
      ["US"],
    );
    expect(updates).toEqual({
      CA: { ProtectStatus: "BLOCK" },
      FR: { ProtectStatus: "BLOCK" },
      US: { ProtectStatus: "ALLOW" },
    });
  });

  it("sends nothing when AWS already has the wanted rules", () => {
    expect(
      countryRuleUpdates({ US: { ProtectStatus: "ALLOW" }, FR: { ProtectStatus: "BLOCK" } }, [
        "US",
      ]),
    ).toEqual([]);
  });

  it("blocks a country AWS adds later by listing it as a change", () => {
    const [updates] = countryRuleUpdates({ US: { ProtectStatus: "ALLOW" }, ZZ: {} }, ["US"]);
    expect(updates).toEqual({ ZZ: { ProtectStatus: "BLOCK" } });
  });

  it("splits long lists into batches", () => {
    const rules = Object.fromEntries(
      Array.from({ length: UPDATE_BATCH_SIZE + 1 }, (_, i) => [
        `C${i}`,
        { ProtectStatus: "ALLOW" },
      ]),
    );
    const batches = countryRuleUpdates(rules, []);
    expect(batches.map((batch) => Object.keys(batch).length)).toEqual([UPDATE_BATCH_SIZE, 1]);
  });
});

describe("allowedFor", () => {
  it("allows the listed countries for SMS and none for MMS or voice", () => {
    expect(allowedFor("SMS", ["US"])).toEqual(["US"]);
    expect(allowedFor("MMS", ["US"])).toEqual([]);
    expect(allowedFor("VOICE", ["US"])).toEqual([]);
  });
});

describe("applySmsAccountGuard", () => {
  it("sets the limit, builds the rules and makes the configuration the account default last", async () => {
    const { calls, send } = recorder({
      US: { ProtectStatus: "BLOCK" },
      FR: { ProtectStatus: "ALLOW" },
    });
    const result = await applySmsAccountGuard(
      { RequestType: "Create", ResourceProperties: props },
      send,
    );

    expect(result.PhysicalResourceId).toBe("protect-abc");
    expect(calls[0]).toEqual(["SetTextMessageSpendLimitOverride", { MonthlyLimit: 50 }]);
    expect(calls.at(-1)).toEqual([
      "SetAccountDefaultProtectConfiguration",
      { ProtectConfigurationId: "protect-abc" },
    ]);
    const smsUpdate = calls.find(
      ([command, input]) =>
        command === "UpdateProtectConfigurationCountryRuleSet" && input.NumberCapability === "SMS",
    );
    expect(smsUpdate?.[1].CountryRuleSetUpdates).toEqual({
      FR: { ProtectStatus: "BLOCK" },
      US: { ProtectStatus: "ALLOW" },
    });
  });

  it("reuses the configuration on update instead of creating another", async () => {
    const { calls, send } = recorder({ US: { ProtectStatus: "ALLOW" } });
    await applySmsAccountGuard(
      { RequestType: "Update", PhysicalResourceId: "protect-abc", ResourceProperties: props },
      send,
    );
    expect(calls.map(([command]) => command)).not.toContain("CreateProtectConfiguration");
  });

  it("deletes a configuration it just created when the rules cannot be written", async () => {
    const calls: string[] = [];
    const send = async (command: string) => {
      calls.push(command);
      if (command === "CreateProtectConfiguration")
        return { ProtectConfigurationId: "protect-new" };
      if (command === "GetProtectConfigurationCountryRuleSet") throw new Error("denied");
      return {};
    };
    await expect(
      applySmsAccountGuard({ RequestType: "Create", ResourceProperties: props }, send),
    ).rejects.toThrow("denied");
    expect(calls).toContain("DeleteProtectConfiguration");
    expect(calls).not.toContain("SetAccountDefaultProtectConfiguration");
  });

  it("leaves the spend limit alone on delete and removes the configuration", async () => {
    const { calls, send } = recorder({});
    await applySmsAccountGuard(
      { RequestType: "Delete", PhysicalResourceId: "protect-abc", ResourceProperties: props },
      send,
    );
    expect(calls.map(([command]) => command)).toEqual([
      "DeleteAccountDefaultProtectConfiguration",
      "DeleteProtectConfiguration",
    ]);
  });
});
