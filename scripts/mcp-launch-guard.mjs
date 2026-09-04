// The rule that keeps the #1324 outage from coming back, as a function two
// callers can share: `scripts/check-agents.mjs` runs it over the real tree,
// and `scripts/check-agents.test.mjs` runs it over configs written by hand.
//
// A stdio MCP server speaks JSON-RPC over stdout. Package managers write their
// own diagnostics to stdout too — on any machine whose Node does not satisfy
// this package's `engines`, every `pnpm <bin>` prints `[WARN] Unsupported
// engine: …` as the first line the client reads, the handshake never parses,
// and the server dies on a 30-second connect timeout. Both stdio entries in
// `.mcp.json` were like that until 2026-09-03 (ADR
// 20260903-node-24-is-the-floor). The cost is silent and every session pays it.
//
// What corrupts the stream is the *command line*, not the executable, so the
// scan below reads `command` and every entry of `args`, tokenising each arg on
// whitespace — `sh -c "pnpm playwright-mcp"` is the form somebody working
// around the guard's message would reach for first.

/**
 * Every launcher that writes to stdout before the process it wraps does.
 * `pnpx` ships beside `pnpm`; `corepack` is the shim in front of all of them.
 */
const PACKAGE_MANAGERS = new Set(["pnpm", "pnpx", "npm", "npx", "yarn", "bun", "bunx", "corepack"]);

/**
 * The package-manager name in one command-line word, or undefined.
 *
 * Strips a leading path (`/usr/local/bin/pnpm`) and a Windows `.cmd`/`.exe`
 * suffix, both of which are the same launcher under a different spelling.
 */
export function packageManagerIn(word) {
  if (typeof word !== "string") return undefined;
  const name = word
    .split("/")
    .pop()
    .replace(/\.(cmd|exe|bat|ps1)$/i, "");
  return PACKAGE_MANAGERS.has(name) ? name : undefined;
}

/** Every word of a launch: the executable plus each arg split on whitespace. */
function commandLineWords(command, args) {
  const words = typeof command === "string" ? [command] : [];
  for (const arg of Array.isArray(args) ? args : []) {
    if (typeof arg !== "string") continue;
    words.push(...arg.split(/\s+/).filter(Boolean));
  }
  return words;
}

/** The first package manager anywhere on a launch's command line, or undefined. */
export function packageManagerOnCommandLine(command, args) {
  for (const word of commandLineWords(command, args)) {
    const found = packageManagerIn(word);
    if (found) return found;
  }
  return undefined;
}

/**
 * A command naming a path (rather than a bare name resolved off `PATH`), so a
 * typo is a file that does not exist rather than a server that never starts.
 * `./node_modules/.bin/x`, `node_modules/.bin/x` and an absolute path all
 * count; `node` and `sh` do not.
 */
function isPathCommand(command) {
  return typeof command === "string" && command.includes("/");
}

/**
 * Problems with how this repository's agent-facing processes are launched.
 *
 * @param {object} input
 * @param {object} input.mcp - the parsed `.mcp.json`.
 * @param {object} [input.launch] - the parsed `.claude/launch.json`.
 * @param {(command: string) => boolean} input.exists - does this path exist, resolved against the repo root?
 * @returns {string[]} one sentence per problem.
 */
export function findLaunchProblems({ mcp, launch, exists }) {
  const problems = [];

  for (const [name, server] of Object.entries(mcp?.mcpServers ?? {})) {
    const command = server?.command;
    if (!command) continue; // an http server has no command line to corrupt

    const manager = packageManagerOnCommandLine(command, server.args);
    if (manager) {
      problems.push(
        `.mcp.json: the "${name}" server is launched through \`${manager}\`, whose own warnings go to stdout and corrupt the JSON-RPC stream — point \`command\` straight at the binary (e.g. ./node_modules/.bin/<bin>)`,
      );
      continue;
    }
    if (isPathCommand(command) && !exists(command)) {
      problems.push(`.mcp.json: the "${name}" server points at ${command}, which does not exist`);
    }
  }

  // `.claude/launch.json` launches `pnpm dev`, and deliberately may: a launch
  // configuration's stdout is nobody's protocol channel, so a `[WARN]` line
  // there is noise rather than a corrupt handshake. What makes that true is
  // the `port` field — readiness is a port probe, not a line read off stdout.
  // So the rule this file enforces on a launch entry is the mechanism rather
  // than the spelling: go through a package manager and you must declare the
  // port, because without one the only thing left to wait on is the stream the
  // package manager is writing into.
  for (const entry of launch?.configurations ?? []) {
    const manager = packageManagerOnCommandLine(entry?.runtimeExecutable, entry?.runtimeArgs);
    if (manager && typeof entry?.port !== "number") {
      problems.push(
        `.claude/launch.json: the "${entry?.name ?? "unnamed"}" configuration runs through \`${manager}\` without a \`port\` — readiness would have to be read off the stdout that \`${manager}\` writes its own warnings to. Declare the port, or launch the binary directly`,
      );
    }
  }

  return problems;
}
