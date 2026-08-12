import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { selectDeployProfile } from "./aws-profile.mjs";

const directories = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe("selectDeployProfile", () => {
  it("keeps the active AWS login profile until the generated deployer profile exists", () => {
    const environment = { AWS_PROFILE: "diveday-admin" };
    expect(selectDeployProfile(environment).AWS_PROFILE).toBe("diveday-admin");
  });

  it("uses the generated deployer profile after the wizard installs it", () => {
    const home = mkdtempSync(join(tmpdir(), "diveday-aws-profile-"));
    directories.push(home);
    mkdirSync(join(home, ".aws"));
    writeFileSync(join(home, ".aws", "credentials"), "[diveday-deployer]\n");

    const environment = { AWS_PROFILE_HOME: join(home, ".aws") };
    expect(selectDeployProfile(environment).AWS_PROFILE).toBe("diveday-deployer");
  });

  it("targets diveday-admin even before aws login has created the profile", () => {
    // An empty *AWS home*, not an empty environment. `{}` leaves
    // `hasGeneratedDeployerProfile` falling back to the real `~/.aws/credentials`
    // — so this case asserted "no deployer profile exists" while reading the
    // machine it happened to run on. It passed on CI, which has no `~/.aws`, and
    // failed on the desk of anyone who had actually run the wizard: exactly
    // backwards, since having run it is the normal state for the person
    // maintaining this script.
    const home = mkdtempSync(join(tmpdir(), "diveday-aws-profile-"));
    directories.push(home);
    mkdirSync(join(home, ".aws"));

    const environment = { AWS_PROFILE_HOME: join(home, ".aws") };
    expect(selectDeployProfile(environment).AWS_PROFILE).toBe("diveday-admin");
  });

  it("does not override a raw first-deploy credential pair", () => {
    const environment = { AWS_ACCESS_KEY_ID: "id", AWS_SECRET_ACCESS_KEY: "secret" };
    expect(selectDeployProfile(environment)).toEqual(environment);
  });
});
