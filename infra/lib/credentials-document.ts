import { readFileSync } from "node:fs";

/**
 * The body of the credential hand-off Secrets Manager secret: the application
 * `.env.example` with every stack-supplied app value filled in, followed by
 * profile blocks for workstation-only credentials.
 *
 * Shaped this way on purpose. The credentials are only useful once they are
 * somewhere else — a `.env.local`, Vercel's environment variables, a GitHub
 * Actions secret — so `pnpm infra:deploy` writes target dotenv files directly
 * instead of asking an operator to transcribe a bespoke JSON shape. `.env.example` already *is* the registry of what this project
 * configures, so deriving the document from it (rather than maintaining a
 * second list here) is what keeps the application section in step: a variable
 * renamed in `.env.example` renames itself here, and a value this stack claims
 * to supply for a key `.env.example` does not have fails the synth rather than
 * silently vanishing. Workstation credentials use their destination's profile
 * format instead of pretending to be application configuration.
 *
 * Everything the stack cannot know is left exactly as `.env.example` has it —
 * blank, under the comment explaining where it comes from — so the document
 * doubles as a complete `.env.local` scaffold rather than a partial one.
 */

/** `KEY=` at the start of a line, matching scripts/check-env.mjs's own parser. */
const ENV_KEY = /^[ \t]*([a-zA-Z_][a-zA-Z0-9_]*)[ \t]*=/;

/**
 * Credentials whose home is not a dotenv file at all — an AWS CLI profile, a
 * cloud environment's settings page. They ride along in the same document,
 * commented out so pasting the whole thing into `.env.local` stays safe, each
 * under the destination it belongs to.
 */
export interface OffDotenvCredential {
  /** Where it goes, as a heading: "diveday-mcp-readonly-local → ~/.aws/credentials". */
  readonly destination: string;
  /** One or two lines on what to do with it. */
  readonly note: string;
  /** Ready-to-paste lines in the destination's own format. */
  readonly body: readonly string[];
}

export interface CredentialsDocumentOptions {
  /** Contents of `.env.example`. */
  readonly template: string;
  /** Values to substitute, keyed by the `.env.example` key they fill. */
  readonly values: Readonly<Record<string, string>>;
  /** The secret's own name, so the document can tell you how to read it again. */
  readonly secretName: string;
  readonly offDotenv: readonly OffDotenvCredential[];
}

/** Reads `.env.example` from the repo root, relative to this file. */
export function readEnvExample(): string {
  return readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
}

/** Every variable name declared in a dotenv document, in file order. */
export function envExampleKeys(template: string): string[] {
  return template
    .split(/\r?\n/)
    .map((line) => line.match(ENV_KEY)?.[1])
    .filter((key): key is string => key !== undefined);
}

/**
 * `.env.example` with the given keys' values substituted and every other line —
 * comments, blanks, keys this stack cannot supply — left byte-for-byte alone.
 *
 * Throws on a key that `.env.example` does not declare. That is the drift
 * guard, and it fires during `cdk synth` rather than in a test only: renaming
 * `SES_AWS_ACCESS_KEY_ID` without updating the stack should stop a deploy, not
 * quietly produce a document missing the credential it exists to deliver.
 */
export function fillEnvExample(template: string, values: Readonly<Record<string, string>>): string {
  const declared = new Set(envExampleKeys(template));
  const unknown = Object.keys(values).filter((key) => !declared.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `.env.example declares no ${unknown.join(", ")} — the stack supplies a value for a key that no longer exists. Rename it in infra/lib/infra-stack.ts or restore it in .env.example.`,
    );
  }

  return template
    .split("\n")
    .map((line) => {
      const key = line.match(ENV_KEY)?.[1];
      if (key === undefined) return line;
      const value = values[key];
      return value === undefined ? line : `${key}=${value}`;
    })
    .join("\n");
}

const RULE = `# ${"-".repeat(74)}`;

function commented(lines: readonly string[]): string[] {
  return lines.map((line) => (line === "" ? "#" : `#   ${line}`));
}

/** The full secret body: header, filled app env, then the profile-only section. */
export function renderCredentialsDocument(options: CredentialsDocumentOptions): string {
  const header = [
    RULE,
    "# DiveDay credentials. Written by `cdk deploy` from infra/lib/infra-stack.ts.",
    "#",
    "# This starts with .env.example and every app value the stack can supply filled in.",
    "# Blank entries are the ones no AWS stack can know; the comment above each says",
    "# where it comes from.",
    "#",
    "# WHERE THIS GOES",
    "#   .env.local  — app configuration only. The cdk-deployer credential is",
    "#                 in a named AWS CLI profile block instead.",
    "#   Vercel      — the generated .env.vercel target: app runtime credentials",
    "#                 plus any nonblank Stripe values preserved from 1Password.",
    "#   GitHub      — the four REG_SUIT_* lines, as repository Actions secrets.",
    "#   AWS CLI     — answer yes to the profile prompt after deploy; it writes",
    "#                 every generated workstation profile under ~/.aws/credentials.",
    "#",
    "# Nothing reads this secret at runtime — it is a hand-off point, not a dependency.",
    "# Putting a value somewhere is still a manual act, and so is removing it: rotating",
    "# a key here breaks every copy of it until you re-paste.",
    "#",
    "# Read it again:",
    `#   aws secretsmanager get-secret-value --secret-id ${options.secretName} \\`,
    "#     --query SecretString --output text",
    "#",
    "# Rotate every key (the number may only ever increase; a later deploy that",
    "# omits it keeps the deployed value rather than rotating back):",
    "#   pnpm infra:deploy --parameters CredentialSerial=2",
    RULE,
    "",
  ];

  const offDotenv =
    options.offDotenv.length === 0
      ? []
      : [
          "",
          RULE,
          "# Not .env values.",
          "#",
          "# These credentials belong somewhere other than a dotenv file, so they are",
          "# commented out — pasting this whole document into .env.local stays safe. To",
          "# use one, copy its block and strip the leading `#   `.",
          RULE,
          ...options.offDotenv.flatMap((credential) => [
            "#",
            `# ${credential.destination}`,
            `#   ${credential.note}`,
            "#",
            ...commented(credential.body),
          ]),
        ];

  return [...header, fillEnvExample(options.template, options.values), ...offDotenv].join("\n");
}
