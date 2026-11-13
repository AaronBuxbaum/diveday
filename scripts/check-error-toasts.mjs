import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * **An error is a toast, never a component that stays on the page** (Aaron,
 * 2026-11-13). A refused save, a failed load or a failed assist draws
 * `ErrorToast` (`src/components/Toast.tsx`) — through `FormStatus`, a `danger`
 * `ShopNotice`, or on its own — and leaves after a beat.
 *
 * What a grep can see reliably is the live-region role such a component takes,
 * so this refuses `role="alert"` anywhere under `src/app` and `src/components`
 * except `Toast.tsx` (the toast itself) and the files in `ALLOWED`, each of
 * which says why it is not an error component. Field-level validation stays
 * beside its control through `Field`'s `error`.
 */

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const ROOTS = ["src/app", "src/components"];

/** File → why a `role="alert"` there is not an error component. */
export const ALLOWED = new Map([
  ["src/components/Toast.tsx", "the error toast itself"],
  ["src/components/ui/form.tsx", "`Field`'s own validation hint, beside the control it describes"],
  ["src/components/ui/InlineConfirm.tsx", "a confirmation the person answers, not an error"],
  [
    "src/components/offline-manifest/shared.tsx",
    "lost offline work the crew must acknowledge, not dismiss",
  ],
  [
    "src/components/offline-manifest/CheckpointNav.tsx",
    "a blocking roll-call prompt that takes focus",
  ],
  [
    "src/app/shop/[shopSlug]/trips/[id]/manifest/_components/CheckpointGapGuard.tsx",
    "a blocking roll-call prompt that takes focus",
  ],
  [
    "src/app/shop/[shopSlug]/trips/[id]/manifest/_components/StageStrip.tsx",
    "the send-everyone-home confirmation the crew must answer",
  ],
  ["src/components/OfflineManifestManager.tsx", "already a fixed, auto-leaving notice"],
  [
    "src/app/shop/[shopSlug]/courses/[slug]/edit/_components/ConflictGuardedForm.tsx",
    "an edit conflict carrying its Reload action",
  ],
  [
    "src/app/shop/[shopSlug]/schedule/board/_components/DayBoard.tsx",
    "persistent allocation, hull and capacity safety conflicts, not failed actions",
  ],
  [
    "src/app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx",
    "a removal confirmation and a live move preview, not a failure",
  ],
  [
    "src/app/shop/[shopSlug]/trips/[id]/_components/packet/TripPacket.tsx",
    "a printed paper notice",
  ],
]);

const EXTENSIONS = new Set([".tsx"]);

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(rel)));
    else if (EXTENSIONS.has(path.extname(entry.name)) && !/\.test\.tsx$/.test(entry.name))
      files.push(rel);
  }
  return files;
}

export function findInlineErrors(file, text) {
  if (ALLOWED.has(file.split(path.sep).join("/"))) return [];
  return text
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(
      ({ line }) =>
        /role="alert"/.test(line) && !/^\s*(\*|\/\/|\{\/\*)/.test(line) && /<[a-zA-Z]/.test(line),
    )
    .map(({ line, number }) => ({ file, line: number, text: line.trim() }));
}

async function main() {
  const violations = [];
  for (const root of ROOTS)
    for (const file of await walk(root))
      violations.push(...findInlineErrors(file, await readFile(path.join(ROOT, file), "utf8")));
  if (violations.length === 0) {
    console.log("check:error-toasts: no error component is drawn on the page.");
    return;
  }
  console.error(
    "check:error-toasts: an error is a toast, never a component on the page. Use `ErrorToast` (src/components/Toast.tsx), `FormStatus` or a `danger` `ShopNotice`.\n",
  );
  for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
