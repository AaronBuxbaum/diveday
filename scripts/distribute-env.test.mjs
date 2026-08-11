import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories = [];

function temporaryPath(name) {
  const directory = mkdtempSync(join(tmpdir(), "diveday-env-"));
  temporaryDirectories.push(directory);
  return join(directory, name);
}

function distribute(target, outputPath, source) {
  execFileSync("node", ["scripts/distribute-env.mjs", target, outputPath], {
    cwd: process.cwd(),
    input: source,
  });
  return readFileSync(outputPath, "utf8");
}

function deployAndSync(directory, document) {
  const cdk = join(directory, "node_modules", ".bin", "cdk");
  mkdirSync(join(directory, "node_modules", ".bin"), { recursive: true });
  writeFileSync(cdk, "#!/bin/sh\nexit 0\n");
  chmodSync(cdk, 0o755);

  const bin = join(directory, "bin");
  mkdirSync(bin);
  const aws = join(bin, "aws");
  writeFileSync(
    aws,
    '#!/bin/sh\nprintf \'%s\' "$DIVEDAY_TEST_SECRET"\nprintf \'%s:%s\' "$AWS_PROFILE" "$AWS_DEFAULT_REGION" > aws-profile-used\n',
  );
  chmodSync(aws, 0o755);

  execFileSync("node", [join(process.cwd(), "scripts", "infra-deploy.mjs")], {
    cwd: directory,
    env: {
      ...process.env,
      AWS_ACCESS_KEY_ID: "deployer-id",
      AWS_SECRET_ACCESS_KEY: "deployer-secret",
      DIVEDAY_TEST_SECRET: document,
      PATH: `${bin}:${process.env.PATH}`,
    },
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true });
});

const source = [
  "AUTH_SECRET=",
  "SECRET_ENCRYPTION_KEY=",
  "CRON_SECRET=",
  "APP_SECRET_SEED=stable-root-material",
  "APP_HOST=https://dive.day",
  "REG_SUIT_AWS_ACCESS_KEY_ID=reg-suit-id",
  "REG_SUIT_AWS_SECRET_ACCESS_KEY=reg-suit-secret",
  "",
].join("\n");

describe("distribute-env", () => {
  it("derives independent app secrets locally and preserves non-stack choices", () => {
    const path = temporaryPath(".env.local");
    writeFileSync(path, "STRIPE_SECRET_KEY=already-configured\nAPP_HOST=https://custom.example\n");

    const output = distribute("local", path, `${source}STRIPE_SECRET_KEY=\n`);

    expect(output).toContain("STRIPE_SECRET_KEY=already-configured");
    expect(output).toContain("APP_HOST=https://custom.example");
    expect(output).not.toMatch(/^AWS_ACCESS_KEY_ID=/m);
    const auth = output.match(/^AUTH_SECRET=(.+)$/m)?.[1];
    const encryption = output.match(/^SECRET_ENCRYPTION_KEY=(.+)$/m)?.[1];
    const cron = output.match(/^CRON_SECRET=(.+)$/m)?.[1];
    expect(auth).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(encryption).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(cron).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(new Set([auth, encryption, cron])).toHaveLength(3);
  });

  it("makes narrowly scoped Vercel and GitHub target files", () => {
    const vercel = distribute(
      "vercel",
      temporaryPath(".env.vercel"),
      `${source}STRIPE_SECRET_KEY=onepassword-managed\nSTRIPE_WEBHOOK_SECRET=onepassword-webhook\n`,
    );
    const github = distribute("github", temporaryPath(".env.github"), source);

    expect(vercel).toContain("AUTH_SECRET=");
    expect(vercel).toContain("APP_HOST=https://dive.day");
    expect(vercel).not.toContain("APP_SECRET_SEED=");
    expect(vercel).not.toMatch(/^AWS_ACCESS_KEY_ID=/m);
    expect(vercel).not.toContain("REG_SUIT_AWS_ACCESS_KEY_ID");
    expect(vercel).toContain("STRIPE_SECRET_KEY=onepassword-managed");
    expect(vercel).toContain("STRIPE_WEBHOOK_SECRET=onepassword-webhook");

    expect(github).toContain("REG_SUIT_AWS_ACCESS_KEY_ID=reg-suit-id");
    expect(github).not.toContain("AUTH_SECRET=");
    expect(github).not.toMatch(/^AWS_ACCESS_KEY_ID=/m);
  });

  it("writes all target files automatically after a successful deploy", () => {
    const directory = mkdtempSync(join(tmpdir(), "diveday-infra-deploy-"));
    temporaryDirectories.push(directory);
    writeFileSync(`${directory}/.env.local`, "APP_HOST=https://custom.example\n");

    deployAndSync(directory, source);

    const local = readFileSync(`${directory}/.env.local`, "utf8");
    const vercel = readFileSync(`${directory}/.env.vercel`, "utf8");
    const github = readFileSync(`${directory}/.env.github`, "utf8");
    expect(local).toContain("APP_HOST=https://custom.example");
    expect(local).toContain("AUTH_SECRET=");
    expect(vercel).toContain("APP_HOST=https://custom.example");
    expect(vercel).not.toMatch(/^AWS_ACCESS_KEY_ID=/m);
    expect(github).toContain("REG_SUIT_AWS_ACCESS_KEY_ID=reg-suit-id");
    expect(readFileSync(`${directory}/aws-profile-used`, "utf8")).toBe("diveday-admin:us-east-1");
  });

  it("overwrites a minted AWS credential the local file disagrees with", () => {
    // The regression that sent a hand-typed key to production. `stackManaged`
    // named the SNS topic ARNs but not the IAM pairs minted beside them, so a
    // value typed onto this line once outlived every later deploy — and since
    // .env.vercel is rendered from the merged .env.local (infra-deploy.mjs),
    // it was laundered from a local file into Vercel Production, where it read
    // as a 403 from a service whose credential was sitting right there.
    const path = temporaryPath(".env.local");
    writeFileSync(
      path,
      [
        "PLACES_AWS_ACCESS_KEY_ID=typed-in-by-hand",
        "SES_AWS_SECRET_ACCESS_KEY=also-by-hand",
        "SNS_AWS_REGION=us-west-1",
        "",
      ].join("\n"),
    );

    const run = spawnSync("node", ["scripts/distribute-env.mjs", "local", path], {
      cwd: process.cwd(),
      input: [
        source,
        "PLACES_AWS_ACCESS_KEY_ID=minted-by-the-stack",
        "SES_AWS_SECRET_ACCESS_KEY=minted-too",
        "SNS_AWS_REGION=us-east-1",
        "",
      ].join("\n"),
      encoding: "utf8",
    });

    const written = readFileSync(path, "utf8");
    expect(run.status).toBe(0);
    expect(written).toContain("PLACES_AWS_ACCESS_KEY_ID=minted-by-the-stack");
    expect(written).toContain("SES_AWS_SECRET_ACCESS_KEY=minted-too");
    expect(written).toContain("SNS_AWS_REGION=us-east-1");
    // Nothing was kept, so there is nothing to report.
    expect(run.stderr).toBe("");
  });

  it("never blanks a local value the stack does not carry", () => {
    // An older deploy, or a service not wired up yet, leaves the key empty in
    // the secret. Owning a name must not mean erasing what is there.
    const path = temporaryPath(".env.local");
    writeFileSync(path, "PLACES_AWS_ACCESS_KEY_ID=the-only-one-anybody-has\n");

    const run = spawnSync("node", ["scripts/distribute-env.mjs", "local", path], {
      cwd: process.cwd(),
      input: `${source}PLACES_AWS_ACCESS_KEY_ID=\n`,
      encoding: "utf8",
    });

    expect(run.status).toBe(0);
    expect(readFileSync(path, "utf8")).toContain(
      "PLACES_AWS_ACCESS_KEY_ID=the-only-one-anybody-has",
    );
  });

  it("reports a local override of something else the stack also writes", () => {
    // The residue `stackOwns` does not cover: values the stack produces that
    // are not credentials, where a stale local copy is still silent. Choosing
    // your own APP_HOST is legitimate — the line is a receipt, not a refusal.
    const path = temporaryPath(".env.local");
    writeFileSync(path, "APP_HOST=http://localhost:3000\nSTRIPE_SECRET_KEY=local-only\n");

    const run = spawnSync("node", ["scripts/distribute-env.mjs", "local", path], {
      cwd: process.cwd(),
      input: `${source}STRIPE_SECRET_KEY=\n`,
      encoding: "utf8",
    });

    const written = readFileSync(path, "utf8");
    expect(run.status).toBe(0);
    expect(run.stderr).toContain("APP_HOST");
    // A key the stack does not carry at all is kept without comment.
    expect(run.stderr).not.toContain("STRIPE_SECRET_KEY");
    expect(written).toContain("APP_HOST=http://localhost:3000");
    expect(written).toContain("STRIPE_SECRET_KEY=local-only");
  });
});
