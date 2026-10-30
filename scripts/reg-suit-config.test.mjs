import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { regSuitConfigArgs } from "./reg-suit-config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OIDC_CONFIG = JSON.parse(readFileSync(path.join(ROOT, "regconfig.oidc.json"), "utf8"));
const LEGACY_CONFIG = JSON.parse(readFileSync(path.join(ROOT, "regconfig.json"), "utf8"));

describe("reg-suit config selection", () => {
  it("keeps the existing regconfig.json as the default for the current inline caller", () => {
    expect(regSuitConfigArgs(undefined)).toEqual([]);
    expect(regSuitConfigArgs("legacy")).toEqual([]);
  });

  it("selects only the repository-owned OIDC config by a fixed mode", () => {
    expect(regSuitConfigArgs("oidc")).toEqual(["--config", "regconfig.oidc.json"]);
    expect(() => regSuitConfigArgs("../../untrusted/regconfig.json")).toThrow(/must be/u);
  });

  it("keeps static AWS credentials and GitHub notification out of the OIDC config", () => {
    expect(OIDC_CONFIG.core).toEqual(LEGACY_CONFIG.core);
    expect(Object.keys(OIDC_CONFIG.plugins).sort()).toEqual([
      "reg-publish-s3-plugin",
      "reg-simple-keygen-plugin",
    ]);
    expect(JSON.stringify(OIDC_CONFIG)).not.toMatch(
      /credentials|accessKeyId|secretAccessKey|reg-notify-github-plugin|clientId/iu,
    );
    expect(OIDC_CONFIG.plugins["reg-publish-s3-plugin"].sdkOptions).toEqual({
      region: "$REG_SUIT_AWS_REGION",
    });
  });
});
