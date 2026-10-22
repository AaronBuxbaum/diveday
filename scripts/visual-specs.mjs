import { readdirSync } from "node:fs";
import path from "node:path";
export function isVisualSpec(file) {
  return /^visual(?:-[\w-]+)?\.spec\.ts$/.test(path.basename(file));
}
export function visualSpecs(root = process.cwd()) {
  return readdirSync(path.join(root, "e2e"))
    .filter(isVisualSpec)
    .sort()
    .map((file) => `e2e/${file}`);
}
