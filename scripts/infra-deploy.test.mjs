import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The one thing this wrapper decides before it touches AWS: which stacks a
 * deploy is for, and whether a `--parameters` value can safely be aimed at all
 * of them.
 *
 * It matters because the failure it prevents is half-done rather than clean.
 * `--parameters KEY=VALUE` with no `STACK:` qualifier is applied to every stack
 * in the deploy, and CloudFormation rejects a parameter a template does not
 * declare -- so an unqualified `CredentialSerial` rotates all eight access keys
 * in `diveday-infra` and then fails `diveday-email`, leaving the operator with
 * a non-zero exit and no way to tell from it whether the rotation happened.
 */

const directories = [];

/**
 * A PATH holding an `aws` that fails immediately, so the guard's *pass* case
 * stops at the login check a few lines later instead of reaching for real
 * credentials or opening a browser.
 */
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "diveday-deploy-"));
  directories.push(directory);
  const bin = join(directory, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "aws"), "#!/bin/sh\nexit 1\n");
  chmodSync(join(bin, "aws"), 0o755);
  return { PATH: `${bin}:${process.env.PATH}` };
}

function deploy(...arguments_) {
  return spawnSync(
    process.execPath,
    [join(process.cwd(), "scripts", "infra-deploy.mjs"), ...arguments_, "--ci-unattended"],
    { cwd: process.cwd(), env: { ...process.env, ...fixture() }, encoding: "utf8" },
  );
}

const REFUSAL = "Refusing to deploy: --parameters with no stack named";

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe("infra:deploy parameter guard", () => {
  // Both spellings, because yargs takes both and an operator reaching for the
  // equals form is not making a different request.
  it.each([
    ["separated", ["--parameters", "CredentialSerial=2"]],
    ["equals", ["--parameters=CredentialSerial=2"]],
  ])("refuses an unqualified parameter in its %s form", (_form, arguments_) => {
    const result = deploy(...arguments_);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(REFUSAL);
    // The message has to name the stack that declares it, or the operator's
    // next attempt is the same command with a different guess.
    expect(result.stderr).toContain("pnpm infra:deploy DiveDay --parameters");
  });

  it.each([
    ["a stack-qualified parameter", ["--parameters", "DiveDay:CredentialSerial=2"]],
    ["a stack-qualified parameter in its equals form", ["--parameters=DiveDay:CredentialSerial=2"]],
    ["a named stack", ["DiveDay", "--parameters", "CredentialSerial=2"]],
  ])("lets %s through", (_shape, arguments_) => {
    const result = deploy(...arguments_);
    expect(result.stderr).not.toContain(REFUSAL);
    // It got past the guard and stopped at the AWS login instead, which is the
    // fixture's doing rather than the guard's.
    expect(result.status).not.toBe(2);
  });
});
