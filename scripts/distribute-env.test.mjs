import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_KEYS, isManual, isStackProduced } from "../config/env-registry.mjs";

const temporaryDirectories = [];

/** A working directory the scripts can treat as a repo root. */
function workspace() {
  const directory = mkdtempSync(join(tmpdir(), "diveday-env-"));
  temporaryDirectories.push(directory);
  return directory;
}

function distribute(target, cwd, source, outputName = `.env.${target}`) {
  const run = spawnSync(
    "node",
    [join(process.cwd(), "scripts", "distribute-env.mjs"), target, outputName],
    { cwd, input: source, encoding: "utf8" },
  );
  return { ...run, output: run.status === 0 ? readFileSync(join(cwd, outputName), "utf8") : "" };
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

/** What a deployed stack hands over: everything it mints, and nothing else. */
const source = [
  "APP_SECRET_SEED=stable-root-material",
  "SES_AWS_ACCESS_KEY_ID=ses-id",
  "PLACES_AWS_ACCESS_KEY_ID=minted-by-the-stack",
  "PLACES_AWS_SECRET_ACCESS_KEY=minted-secret",
  "REG_SUIT_S3_BUCKET_NAME=diveday-vrt",
  "REG_SUIT_AWS_ACCESS_KEY_ID=reg-suit-id",
  "REG_SUIT_AWS_SECRET_ACCESS_KEY=reg-suit-secret",
  "",
].join("\n");

describe("distribute-env", () => {
  it("takes the stack's value for a minted credential, whatever the target file said", () => {
    // The regression this design removes. The old merge let a value already in
    // .env.local win, so a key typed in by hand outlived every later deploy.
    const cwd = workspace();
    writeFileSync(join(cwd, ".env.local"), "PLACES_AWS_ACCESS_KEY_ID=typed-in-by-hand\n");

    const { status, output } = distribute("local", cwd, source);

    expect(status).toBe(0);
    expect(output).toContain("PLACES_AWS_ACCESS_KEY_ID=minted-by-the-stack");
    expect(output).not.toContain("typed-in-by-hand");
  });

  it("refuses a .env.manual that speaks for a value the stack produces", () => {
    // Refused rather than ignored: a value someone took the trouble to type is
    // never silently discarded, because that silence is what hid the original
    // bug for a week.
    const cwd = workspace();
    writeFileSync(join(cwd, ".env.manual"), "PLACES_AWS_ACCESS_KEY_ID=mine\n");

    const { status, stderr } = distribute("local", cwd, source);

    expect(status).toBe(1);
    expect(stderr).toContain("PLACES_AWS_ACCESS_KEY_ID");
    expect(stderr).toContain("no local override");
    expect(existsSync(join(cwd, ".env.local"))).toBe(false);
  });

  it("carries the values only a human can supply, from .env.manual", () => {
    const cwd = workspace();
    writeFileSync(
      join(cwd, ".env.manual"),
      "STRIPE_SECRET_KEY=sk_from_1password\nDATABASE_URL=postgres://neon\n",
    );

    const local = distribute("local", cwd, source).output;
    const vercel = distribute("vercel", cwd, source).output;

    expect(local).toContain("STRIPE_SECRET_KEY=sk_from_1password");
    expect(vercel).toContain("STRIPE_SECRET_KEY=sk_from_1password");
    expect(vercel).toContain("DATABASE_URL=postgres://neon");
  });

  // The checked-in constants this used to cover are gone -- DiveDay's own
  // origin, sender, Connect client id and Sentry DSN now live in the code that
  // reads them (src/lib/configured.ts), so `.env.manual` speaks for exactly
  // the manual keys and nothing else. The refusal above is the rule that
  // remains, and it has its own case.

  it("derives three independent app secrets from the seed", () => {
    const output = distribute("local", workspace(), source).output;
    const auth = output.match(/^AUTH_SECRET=(.+)$/m)?.[1];
    const encryption = output.match(/^SECRET_ENCRYPTION_KEY=(.+)$/m)?.[1];
    const cron = output.match(/^CRON_SECRET=(.+)$/m)?.[1];

    expect(auth).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(encryption).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(cron).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(new Set([auth, encryption, cron])).toHaveLength(3);
  });

  it("refuses to distribute a document from before the stack was deployed", () => {
    const { status, stderr } = distribute("local", workspace(), "SES_AWS_ACCESS_KEY_ID=ses-id\n");
    expect(status).toBe(1);
    expect(stderr).toContain("APP_SECRET_SEED");
  });

  it("sends each target only what that target consumes", () => {
    const cwd = workspace();
    const vercel = distribute("vercel", cwd, source).output;
    const github = distribute("github", cwd, source).output;

    // The seed derives the app secrets on a workstation; a deployed environment
    // gets the derived values and must never be able to re-derive them.
    expect(vercel).not.toMatch(/^APP_SECRET_SEED=/m);
    expect(vercel).toContain("AUTH_SECRET=");
    // Visual-regression credentials are CI's, not the application's.
    expect(vercel).not.toMatch(/^REG_SUIT_/m);
    expect(github).toContain("REG_SUIT_AWS_ACCESS_KEY_ID=reg-suit-id");
    expect(github).not.toContain("AUTH_SECRET=");
    // The deployer's own credentials are never any target's business.
    expect(vercel).not.toMatch(/^AWS_ACCESS_KEY_ID=/m);
    expect(github).not.toMatch(/^AWS_ACCESS_KEY_ID=/m);
  });

  it("writes a blank line locally and drops it for a remote target", () => {
    // Locally the file shows the whole shape so `pnpm check:env` can report what
    // is unset; pushing an empty value to Vercel would overwrite a variable set
    // by hand in the console with nothing.
    const cwd = workspace();
    expect(distribute("local", cwd, source).output).toMatch(/^META_APP_ID=$/m);
    expect(distribute("vercel", cwd, source).output).not.toMatch(/^META_APP_ID=/m);
  });

  it("writes all target files after a deploy, and never derives one from another", () => {
    // .env.vercel used to be rendered from the freshly written .env.local, which
    // is how a credential typed into a local file reached production and stayed
    // there. Both come from the stack document now.
    const directory = workspace();
    writeFileSync(join(directory, ".env.local"), "PLACES_AWS_ACCESS_KEY_ID=stale-local-value\n");

    deployAndSync(directory, source);

    const local = readFileSync(join(directory, ".env.local"), "utf8");
    const vercel = readFileSync(join(directory, ".env.vercel"), "utf8");
    const github = readFileSync(join(directory, ".env.github"), "utf8");

    expect(local).toContain("PLACES_AWS_ACCESS_KEY_ID=minted-by-the-stack");
    expect(vercel).toContain("PLACES_AWS_ACCESS_KEY_ID=minted-by-the-stack");
    expect(vercel).not.toContain("stale-local-value");
    expect(github).toContain("REG_SUIT_AWS_ACCESS_KEY_ID=reg-suit-id");
    expect(readFileSync(join(directory, "aws-profile-used"), "utf8")).toBe(
      "diveday-admin:us-east-1",
    );
    // The deploy creates the one hand-edited file on its way through.
    expect(existsSync(join(directory, ".env.manual"))).toBe(true);
  });
});

describe("the registry every one of those files reads", () => {
  it("gives each key exactly one producer", () => {
    // The property the whole design rests on: nothing can be produced by two
    // sources, so there is never a conflict to resolve.
    for (const key of ENV_KEYS) {
      expect(isManual(key) && isStackProduced(key)).toBe(false);
    }
  });

  it("declares every value the CDK stack writes", async () => {
    // `fillEnvExample` refuses a key the template does not declare, so a section
    // added to the stack without a registry row fails the synth. Assert it here
    // too, where the message can say why.
    const stack = readFileSync("infra/lib/infra-stack.ts", "utf8");
    const written = [...stack.matchAll(/envValues\.([A-Z][A-Z0-9_]*)\s*=/g)].map((m) => m[1]);
    for (const key of written) {
      expect(ENV_KEYS, `${key} is written by the stack but missing from the registry`).toContain(
        key,
      );
    }
  });
});
