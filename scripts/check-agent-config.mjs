import { readFile } from "node:fs/promises";
import process from "node:process";

const configFiles = [".claude/settings.json", ".codex/hooks.json"];
const violations = [];

for (const file of configFiles) {
  const config = JSON.parse(await readFile(file, "utf8"));
  const sessionStartHooks = config.hooks?.SessionStart ?? [];

  if (sessionStartHooks.length > 0) {
    violations.push(`${file}: SessionStart hooks must be empty`);
  }
}

if (violations.length > 0) {
  console.error(
    `Agent configuration violations:\n${violations.map((item) => `- ${item}`).join("\n")}`,
  );
  console.error(
    "Remote reviews cannot publish progress until startup hooks finish. Install dependencies during the task instead.",
  );
  process.exit(1);
}

console.log("agents: startup is non-blocking");
