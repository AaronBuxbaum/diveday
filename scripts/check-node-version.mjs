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
 *
 * One rule here is not about Node at all. The README's Quickstart sentence
 * claims the repository pins *both* the runtime and the package manager, and
 * for a day only the runtime half was checked — so a merge that bumped
 * `packageManager` to pnpm 11.25.0 left that sentence saying 11.24.0, which is
 * the same defect one column over. `packageManager` is the source of truth
 * there (Renovate bumps it); the README has to follow.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The Node major this project runs on and supports (ADR 20260903-node-24-is-the-floor). */
export const NODE_MAJOR = 24;

/**
 * Node's realpath cache can preserve package symlinks after an unrelated pipe stat
 * on older releases (nodejs/node#65113), duplicating Next's modules under pnpm.
 * Match the fixed runtime verified in CI; dependency engines alone cannot prove
 * this runtime correctness floor (issue #3083).
 */
export const NODE_FLOOR = "24.22.0";

/**
 * Artifact producers and consumers need one exact runtime. A major-only
 * setup-node selector can reuse different cached patches on different runners
 * (24.22.0 build vs 24.21.0 capture in run 39791953247), invalidating evidence.
 * This CI pin is separate from the supported local runtime range above.
 */
export const CI_NODE_VERSION = "24.22.0";

/** Refuse unsupported direct launchers before they start children or touch dev state. */
export function nodeRuntimeProblem(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const minimum = NODE_FLOOR.split(".").map(Number);
  const actual = match?.slice(1).map(Number);
  if (
    actual?.[0] === NODE_MAJOR &&
    (actual[1] > minimum[1] || (actual[1] === minimum[1] && actual[2] >= minimum[2]))
  ) {
    return null;
  }
  return `Node ${version} is unsupported; this checkout requires ^${NODE_FLOOR} and pins ${CI_NODE_VERSION}. Run pnpm install --frozen-lockfile, then pnpm dev to use its project-local runtime.`;
}

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

/**
 * The ES library floor the compiler describes, in both TypeScript projects.
 *
 * `lib` is a runtime-floor claim exactly the way `@types/node` is, and it was
 * the hole left open when the Node declarations were reconciled: `esnext` hands
 * the compiler ES2025-and-later library types regardless of what Node 24 or any
 * browser baseline actually has, so an API nothing runs still compiles green
 * (issue #1329). It sits here rather than in a comment because the default in
 * every scaffold is `esnext`, so it drifts back the moment a config is
 * regenerated and nothing would say so.
 *
 * Narrowing it constrains client code too, which is the accepted cost: a
 * browser has more than ES2024, and being slightly under-described there is
 * cheaper than compiling against a surface Node does not have.
 */
export const ES_LIB = "es2024";

/** Each file, what it must say, and the sentence that explains the drift. */
const DECLARATIONS = [
  {
    file: "package.json",
    find: (text) => {
      const runtime = JSON.parse(text).devEngines?.runtime;
      return `${runtime?.name}@${runtime?.version}:${runtime?.onFail}`;
    },
    want: `node@${CI_NODE_VERSION}:download`,
    where: "devEngines.runtime",
  },
  {
    file: "package.json",
    find: (text) => JSON.parse(text).engines?.node,
    want: `^${NODE_FLOOR}`,
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
    want: CI_NODE_VERSION,
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
  // Both of these read by regex rather than `JSON.parse`: src/worker/tsconfig.json
  // carries `//` comments explaining why it exists at all, so it is not
  // parseable JSON, and the root one is read the same way to keep the pair
  // symmetrical.
  {
    file: "tsconfig.json",
    find: (text) => text.match(/"lib"\s*:\s*\[([^\]]*)\]/)?.[1]?.replace(/["\s]/g, ""),
    want: `dom,dom.iterable,${ES_LIB}`,
    where: "compilerOptions.lib",
  },
  {
    file: "src/worker/tsconfig.json",
    find: (text) => text.match(/"lib"\s*:\s*\[([^\]]*)\]/)?.[1]?.replace(/["\s]/g, ""),
    want: `${ES_LIB},webworker,dom.iterable`,
    where: "compilerOptions.lib",
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
  // The one rule whose truth is another file rather than a constant: the
  // README's Quickstart names the pnpm pin as well as the Node one, and
  // `packageManager` is what decides it.
  const manifest = read("package.json");
  const readme = read("README.md");
  if (manifest !== undefined && readme !== undefined) {
    let pinned;
    try {
      pinned = JSON.parse(manifest).packageManager?.match(/^pnpm@(\S+)$/)?.[1];
    } catch {
      // Already reported above by the engines rule; nothing to add here.
    }
    const said = readme.match(/and pnpm ([\d.]+)/)?.[1];
    if (pinned !== undefined && said !== pinned) {
      drift.push(
        `README.md (the pnpm version in the Quickstart line) says ${said ?? "nothing"}, and package.json's packageManager says ${pinned}.`,
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
      "\nThe numbers live in scripts/check-node-version.mjs (NODE_MAJOR, NODE_FLOOR, CI_NODE_VERSION, LAMBDA_NODE_MAJOR, ES_LIB). Change them there first, then bring every file above into line — never the other way round.",
    );
    console.error(
      "This is a guard rather than a convention because `engines` is warn-only and pnpm writes that warning to stdout, which is how a mismatch took both MCP servers down (issue #1326, ADR 20260903-node-24-is-the-floor).",
    );
    process.exit(1);
  }

  console.log(
    `node-version: ${DECLARATIONS.length + 1} declarations agree on Node ${NODE_MAJOR} (floor ${NODE_FLOOR}, Lambda nodejs${LAMBDA_NODE_MAJOR}.x, ES lib ${ES_LIB}), and the README's pnpm pin matches packageManager`,
  );
}
