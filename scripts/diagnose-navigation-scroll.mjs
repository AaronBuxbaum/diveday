// Temporary #4183 probe. Explicitly invoked only by the diagnostic CI lane.
// Atomic replacement avoids modifying pnpm's shared hard-linked package store.
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const root = dirname(createRequire(import.meta.url).resolve("next/package.json"));
const restore = process.argv.includes("--restore");
const files = [
  "dist/client/components/layout-router.js",
  "dist/esm/client/components/layout-router.js",
];
function replaceOnce(source, needle, replacement) {
  if (source.split(needle).length !== 2) throw new Error(`Next probe anchor changed: ${needle}`);
  return source.replace(needle, replacement);
}
for (const relative of files) {
  const file = join(root, relative);
  const backup = `${file}.nav4183-original`;
  if (restore) {
    if (existsSync(backup)) {
      writeFileSync(`${file}.nav4183-tmp`, readFileSync(backup));
      renameSync(`${file}.nav4183-tmp`, file);
      unlinkSync(backup);
    }
    continue;
  }
  if (existsSync(backup)) throw new Error(`Restore the existing probe first: ${file}`);
  const original = readFileSync(file, "utf8");
  let source = original;
  source = replaceOnce(
    source,
    "const rects = instance.getClientRects();",
    `const rects = instance.getClientRects();
    globalThis.__nav4183?.("fragment-rects", { rects: Array.from(rects, r => ({ top:r.top, bottom:r.bottom, left:r.left, right:r.right, width:r.width, height:r.height })), viewportHeight }, instance);`,
  );
  source = replaceOnce(
    source,
    "return elementTop >= getScrollPaddingTop() && elementTop <= viewportHeight ? 1 : 2;",
    `const padding = getScrollPaddingTop();
    const state = elementTop >= padding && elementTop <= viewportHeight ? 1 : 2;
    globalThis.__nav4183?.("fragment-decision", { elementTop, padding, state }, instance);
    return state;`,
  );
  source = replaceOnce(
    source,
    "if (scrollRef === null || !scrollRef.current) return;",
    `globalThis.__nav4183?.("handler", { segment: renderTree.segment, pending: scrollRef?.current ?? null, forceScroll: scrollHandlerRef.forceScroll, hash: scrollHandlerRef.hashFragment }, scrollRef);
        if (scrollRef === null || !scrollRef.current) return;`,
  );
  source = replaceOnce(
    source,
    "let didHandleScroll = false;",
    `globalThis.__nav4183?.("target", {}, instance, scrollRef);
        let didHandleScroll = false;`,
  );
  source = replaceOnce(
    source,
    "didHandleScroll = true;",
    `globalThis.__nav4183?.("consume", { initialTargetState, hashFragment }, scrollRef, instance);
            didHandleScroll = true;`,
  );
  source = replaceOnce(
    source,
    "htmlElement.scrollTop = 0;",
    `htmlElement.scrollTop = 0;
            globalThis.__nav4183?.("after-scroll-top", {}, scrollRef, instance);`,
  );
  source = replaceOnce(
    source,
    "if (!didHandleScroll) {",
    `globalThis.__nav4183?.("handler-complete", { didHandleScroll, pending: scrollRef.current }, scrollRef, instance);
        if (!didHandleScroll) {`,
  );
  // Both builds are preflighted individually; backups make a partial install recoverable.
  writeFileSync(backup, original);
  writeFileSync(`${file}.nav4183-tmp`, source);
  renameSync(`${file}.nav4183-tmp`, file);
}
console.log(restore ? "Restored Next scroll handlers" : "Installed temporary #4183 scroll probes");
