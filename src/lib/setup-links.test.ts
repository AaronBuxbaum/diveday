import { describe, expect, it } from "vitest";
import { createAccountToken } from "./account-tokens";
import { redactCapabilityUrl } from "./capability-urls";
import { DAY_MS } from "./clock";
import {
  isSetupLinkTokenShape,
  SETUP_LINK_PARAM,
  SETUP_LINK_TTL_MS,
  setupLinkPath,
} from "./setup-links";

describe("a setup link's token (ADR 20261009-single-use-setup-links)", () => {
  it("has the shape every minted token has, and nothing else does", () => {
    for (let i = 0; i < 20; i += 1) expect(isSetupLinkTokenShape(createAccountToken())).toBe(true);
    const token = createAccountToken();
    for (const candidate of [
      token.slice(1),
      `${token}A`,
      `${token.slice(0, -1)}=`,
      `${token.slice(0, -1)}\n`,
      "",
      undefined,
      null,
      [token],
      new Blob([token]),
    ]) {
      expect(isSetupLinkTokenShape(candidate)).toBe(false);
    }
  });

  // `account.onboard.spentLink.body` tells a visitor a link lasts two weeks.
  it("lasts the two weeks the closed door says it does", () => {
    expect(SETUP_LINK_TTL_MS).toBe(14 * DAY_MS);
  });

  it("never reaches telemetry", () => {
    const token = createAccountToken();
    const redacted = redactCapabilityUrl(`${setupLinkPath(token)}&error=email_taken`);
    expect(redacted).not.toContain(token);
    expect(redacted).toContain("error=email_taken");
    expect(setupLinkPath(token)).toContain(`${SETUP_LINK_PARAM}=`);
  });
});
