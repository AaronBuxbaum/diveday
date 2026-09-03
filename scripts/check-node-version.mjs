import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Every place this repository names a Node version says the same one.
 *
 * There were six declarations and they disagreed: `engines` said `>=24.0.0`,
 * the README said 24, CI installed 24, `@types/node` was `^26` (so the tree
 * type-checked against a major nothing runs), four Lambdas deployed on
 * `nodejs22.x`, and the containers this project is developed in ship Node
 * 22.22.2. Only CI's pin was enforced by anything (issue #1326).
 *
 * That is not a tidiness problem. `engines` is warn-only by default, and pnpm
 * writes the warning to **stdout** as the first line of every `pnpm <script>`
 * and every `pnpm install` — which is how two MCP servers launched through
 * `pnpm` had their JSON-RPC handshake corrupted and cost every session a
 * 30-second connect timeout for each (fixed in #1324, guarded by check 8 of
 * `scripts/check-agents.mjs`). A version nobody reconciles is a version that
 * eventually ends up on a channel that cannot carry it.
 *
 * So the numbers live here, once, and this refuses any file that drifts from
 * them. Changing the supported major means changing `NODE_MAJOR` and then
 * doing what this guard tells you.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The Node major this project runs on and supports (ADR 20260903-node-24-is-the-floor). */
export const NODE_MAJOR = 24;

/**
 * The floor inside that major, and it is **not** `24.0.0`.
 *
 * `jsdom@30`, which is the DOM environment the whole unit suite runs in,
 * declares `engines.node: "^22.22.2 || ^24.15.0 || >=26.0.0"` — so Node 24.0
 * through 24.14 satisfies a `>=24.0.0` field and violates a dependency we
 * install on every machine. A floor that admits versions the tree cannot
 * actually install on is the same false declaration this guard exists to stop,
 * one level down. Re-derive it when a dependency bump moves it:
 *
 *   node -e 'for (const d of require("node:fs").readdirSync("node_modules/.pnpm")) { …read engines… }'
 *
 * or just read `node_modules/jsdom/package.json`, which has been the binding
 * constraint since 2026-09-03.
 */
export const NODE_FLOOR = "24.15.0";

/**
 * The major AWS Lambda runs the handlers in `infra/` on, stated separately
 * because it is a different question with a different clock: AWS publishes and
 * retires runtimes on its own schedule, so "the major we develop on" and "the
 * major that exists in Lambda" can legitimately diverge for a while. They are
 * equal today, and `aws-cdk-lib`'s own helper Lambdas (the custom-resource
 * provider framework, `AwsCustomResource`, the OIDC provider) already synthesize
 * `nodejs24.x` via `determineLatestNodeRuntime`, so pinning ours lower was
 * making one stack run two majors.
 */
export const LAMBDA_NODE_MAJOR = 24;

/** Each file, what it must say, and the sentence that explains the drift. */
const DECLARATIONS = [
  {
    file: "package.json",
    find: (text) => JSON.parse(text).engines?.node,
    want: `>=${NODE_FLOOR}`,
    where: "engines.node",
  },
  {
    file: ".nvmrc",
    find: (text) => text.trim(),
    want: String(NODE_MAJOR),
    where: "the whole file",
  },
  {
    file: ".github/actions/setup/action.yml",
    find: (text) => text.match(/^\s*node-version:\s*(\S+)\s*$/m)?.[1],
    want: String(NODE_MAJOR),
    where: "node-version:",
  },
  {
    file: ".github/actions/setup/action.yml",
    find: (text) => text.match(/Sets up pnpm, Node (\d+)/)?.[1],
    want: String(NODE_MAJOR),
    where: "the description prose",
  },
  {
    file: "README.md",
    find: (text) => text.match(/Requires Node (\d+)/)?.[1],
    want: String(NODE_MAJOR),
    where: "the Quickstart line",
  },
  {
    file: "package.json",
    find: (text) => JSON.parse(text).devDependencies?.["@types/node"]?.match(/(\d+)\./)?.[1],
    want: String(NODE_MAJOR),
    where: "the @types/node major",
  },
  {
    file: "infra/lib/infra-stack.ts",
    find: (text) => [...new Set(text.match(/lambda\.Runtime\.NODEJS_\d+_X/g) ?? [])].join(", "),
    want: `lambda.Runtime.NODEJS_${LAMBDA_NODE_MAJOR}_X`,
    where: "every Lambda runtime",
  },
  {
    file: "infra/lib/infra-stack.ts",
    find: (text) => [...new Set(text.match(/target: "node\d+"/g) ?? [])].join(", "),
    want: `target: "node${LAMBDA_NODE_MAJOR}"`,
    where: "the esbuild bundling target",
  },
  {
    file: "infra/lib/visual-bucket-pruner.test.ts",
    find: (text) => text.match(/Runtime: "(nodejs[\d.x]+)"/)?.[1],
    want: `nodejs${LAMBDA_NODE_MAJOR}.x`,
    where: "the synthesized-runtime assertion",
  },
];

/** Every declaration that disagrees, as a sentence naming the file and both values. */
export function findNodeVersionDrift(read) {
  const drift = [];
  for (const { file, find, want, where } of DECLARATIONS) {
    const text = read(file);
    if (text === undefined) {
      drift.push(`${file} is missing — it is one of this repo's Node-version declarations.`);
      continue;
    }
    let said;
    try {
      said = find(text);
    } catch (error) {
      drift.push(`${file} could not be read for ${where}: ${error?.message ?? error}`);
      continue;
    }
    if (said !== want) {
      drift.push(
        `${file} (${where}) says ${said ?? "nothing"}, and every other declaration says ${want}.`,
      );
    }
  }
  return drift;
}

// Imported by the test, which must not read the tree or exit the process.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = [...new Set(DECLARATIONS.map((d) => d.file))];
  const contents = new Map(
    await Promise.all(
      files.map(async (file) => {
        try {
          return [file, await readFile(path.join(ROOT, file), "utf8")];
        } catch {
          return [file, undefined];
        }
      }),
    ),
  );
  const drift = findNodeVersionDrift((file) => contents.get(file));

  if (drift.length > 0) {
    console.error("The repository disagrees with itself about which Node it runs on:");
    console.error(drift.map((line) => `- ${line}`).join("\n"));
    console.error(
      "\nThe numbers live in scripts/check-node-version.mjs (NODE_MAJOR, NODE_FLOOR, LAMBDA_NODE_MAJOR). Change them there first, then bring every file above into line — never the other way round.",
    );
    console.error(
      "This is a guard rather than a convention because `engines` is warn-only and pnpm writes that warning to stdout, which is how a mismatch took both MCP servers down (issue #1326, ADR 20260903-node-24-is-the-floor).",
    );
    process.exit(1);
  }

  console.log(
    `node-version: ${DECLARATIONS.length} declarations agree on Node ${NODE_MAJOR} (floor ${NODE_FLOOR}, Lambda nodejs${LAMBDA_NODE_MAJOR}.x)`,
  );
}
