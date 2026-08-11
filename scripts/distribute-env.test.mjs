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

  it("says out loud which local values it kept over the stack's", () => {
    // The rule that keeps local choices also pins credentials the stack
    // *mints*: a key typed into .env.local once is never refreshed, every later
    // run silently drops the real one, and the file looks fine afterwards. The
    // failure surfaces days later as a 403 from a service whose credential is
    // sitting right there in the env. Overriding stays allowed; it stops being
    // silent.
    const path = temporaryPath(".env.local");
    writeFileSync(path, "PLACES_AWS_ACCESS_KEY_ID=typed-in-by-hand\n");

    const run = spawnSync("node", ["scripts/distribute-env.mjs", "local", path], {
      cwd: process.cwd(),
      input: `${source}PLACES_AWS_ACCESS_KEY_ID=minted-by-the-stack\n`,
      encoding: "utf8",
    });

    expect(run.status).toBe(0);
    expect(run.stderr).toContain("PLACES_AWS_ACCESS_KEY_ID");
    expect(readFileSync(path, "utf8")).toContain("PLACES_AWS_ACCESS_KEY_ID=typed-in-by-hand");
  });

  it("stays quiet when the local file agrees with the stack, or has nothing to say", () => {
    const path = temporaryPath(".env.local");
    // One value identical to the stack's, one the stack does not carry at all.
    writeFileSync(
      path,
      "PLACES_AWS_ACCESS_KEY_ID=minted-by-the-stack\nSTRIPE_SECRET_KEY=local-only\n",
    );

    const run = spawnSync("node", ["scripts/distribute-env.mjs", "local", path], {
      cwd: process.cwd(),
      input: `${source}PLACES_AWS_ACCESS_KEY_ID=minted-by-the-stack\nSTRIPE_SECRET_KEY=\n`,
      encoding: "utf8",
    });

    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    expect(readFileSync(path, "utf8")).toContain("STRIPE_SECRET_KEY=local-only");
  });
});
