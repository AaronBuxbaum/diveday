import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";

// Entire committed tree, full inherited environment (hashed, never serialized), dependency
// installation and executable identities. Only deterministic local static stages opt in.
export function stageKey({ tree, step, env, tools, dependencies }) {
  if (!tree || !tools || !dependencies) return null;
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        tree,
        step,
        env: Object.entries(env).sort(([a], [b]) => a.localeCompare(b)),
        tools,
        dependencies,
      }),
    )
    .digest("hex");
}
export function installationIdentity(root) {
  try {
    return ["node_modules/.modules.yaml", "node_modules/.pnpm/lock.yaml"].map((file) => {
      const full = `${root}/${file}`;
      return [file, readFileSync(full, "utf8"), statSync(full).mtimeMs];
    });
  } catch {
    return null;
  }
}
export { runBoundedAsync as runStageAsync } from "./subprocess.mjs";

export async function collectStages(steps, run, concurrency = 2) {
  const results = new Array(steps.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, steps.length) }, async () => {
      while (next < steps.length) {
        const index = next++;
        try {
          results[index] = await run(steps[index]);
        } catch (error) {
          results[index] = { name: steps[index].name, status: "failed", error: String(error) };
        }
      }
    }),
  );
  return results;
}

/** Reuse only the directly invoked, checksum-identified Biome binary on known platforms. */
export function lintToolIdentity(root) {
  if (process.env.BIOME_BINARY || !["darwin", "win32"].includes(process.platform)) return null; // libc resolution is uncertain on Linux
  try {
    const require = createRequire(`${root}/package.json`);
    const biomeRequire = createRequire(require.resolve("@biomejs/biome/package.json"));
    const binary = biomeRequire.resolve(
      `@biomejs/cli-${process.platform}-${process.arch}/biome${process.platform === "win32" ? ".exe" : ""}`,
    );
    return { binary, digest: createHash("sha256").update(readFileSync(binary)).digest("hex") };
  } catch {
    return null;
  }
}

export function verificationInputsStable({ head, tree, status }, initial) {
  return head === initial.head && tree === initial.tree && status === "";
}
