// The exact #4201 runtime delta is removed only on the ephemeral expected-red runner.
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

export const CAUSAL_TEST = "a delayed warm departure does not restore the board scroll";
export const CAUSAL_REPEATS = 3;
const STATE = ".navigation-proof-originals.json";
const stateAddition = `        // Only a new pathname with the default scroll behavior gets this
        // measurement. Hash, history, refresh and scroll:false keep their
        // existing scroll intent and do not participate.
        if (scrollRef !== null && url.pathname !== oldUrl.pathname && typeof window !== 'undefined') {
            scrollRef.initialNavigationScrollY = window.scrollY;
        }
`;
const layoutAddition = `                // A short streamed fallback can clamp the inherited offset to
                // its bottom before this handler runs. The browser can restore
                // the larger offset when the page grows, after this intent was
                // consumed. Honor this forward navigation while it is clamped.
                const initialScrollY = scrollRef.initialNavigationScrollY;
                if (typeof initialScrollY === 'number' && htmlElement.scrollTop > 0 && initialScrollY > htmlElement.scrollTop && htmlElement.scrollTop >= htmlElement.scrollHeight - viewportHeight) {
                    htmlElement.scrollTop = 0;
                }
`;
export const FIX_ADDITIONS = { state: stateAddition, layout: layoutAddition };
const digest = (source) => createHash("sha256").update(source).digest("hex");
function replaceOnce(source, needle, replacement) {
  if (source.split(needle).length !== 2)
    throw new Error(`Expected exactly one Next16.4.5 proof anchor: ${needle}`);
  return source.replace(needle, replacement);
}
export function removeCausalFix(source, kind, version) {
  if (version !== "16.4.5" || !FIX_ADDITIONS[kind])
    throw new Error("Unsupported causal proof version/hunk");
  return replaceOnce(source, FIX_ADDITIONS[kind], "");
}
export function instrumentScrollRouter(source) {
  for (const [needle, extra] of [
    [
      "const rects = instance.getClientRects();",
      '\n    globalThis.__nav4183?.("fragment-rects", { rects: Array.from(rects, r => ({ top:r.top, bottom:r.bottom, height:r.height, width:r.width })), viewportHeight }, null, instance);',
    ],
    [
      "if (scrollRef === null || !scrollRef.current) return;",
      '\n        globalThis.__nav4183?.("handler", { pending: scrollRef.current }, scrollRef);',
    ],
    [
      "didHandleScroll = true;",
      '\n            globalThis.__nav4183?.("consume", { initialTargetState, pending: scrollRef.current, hashFragment }, scrollRef, instance);',
    ],
  ])
    source = replaceOnce(source, needle, needle + extra);
  return replaceOnce(
    source,
    "return elementTop >= getScrollPaddingTop() && elementTop <= viewportHeight ? 1 : 2;",
    `const padding = getScrollPaddingTop();
    const state = elementTop >= padding && elementTop <= viewportHeight ? 1 : 2;
    globalThis.__nav4183?.("fragment-decision", { elementTop, padding, state }, null, instance);
    return state;`,
  );
}
export function atomicWrite(path, source, mode = statSync(path).mode & 0o777) {
  const temporary = `${path}.nav4183-${randomUUID()}.tmp`;
  writeFileSync(temporary, source, { mode, flag: "wx" });
  chmodSync(temporary, mode);
  renameSync(temporary, path);
}
export function restoreOriginals(
  originals,
  read = (path) => readFileSync(path, "utf8"),
  write = atomicWrite,
) {
  for (const item of originals) {
    if (digest(item.source) !== item.sha256) throw new Error(`Corrupt proof backup: ${item.path}`);
  }
  for (const item of originals) write(item.path, item.source, item.mode);
  for (const item of originals) {
    if (digest(read(item.path)) !== item.sha256)
      throw new Error(`Proof restoration mismatch: ${item.path}`);
  }
  return originals.map(({ path, sha256, mode }) => ({ path, sha256, mode }));
}
function namedTests(report) {
  const specs = [];
  const walk = (suite) => {
    specs.push(...(suite.specs ?? []));
    for (const child of suite.suites ?? []) walk(child);
  };
  walk(report);
  if (report.errors?.length || specs.length !== 1 || specs[0].title !== CAUSAL_TEST) {
    throw new Error("Expected only the named causal regression with no setup/report errors");
  }
  return specs[0].tests ?? [];
}
export function classifyCausalRed(report, exitCode, loadTimeline) {
  if (exitCode !== 1)
    throw new Error("Expected Playwright assertion exit1, never a setup/timeout exit");
  const tests = namedTests(report);
  if (tests.length !== CAUSAL_REPEATS) throw new Error("Missing causal repeats");
  const repeats = new Set();
  return tests.map((test) => {
    const result = test.results?.[0];
    const errors = result?.errors ?? [];
    const message = stripVTControlCharacters(errors[0]?.message ?? "");
    if (
      test.projectName !== "chromium" ||
      test.expectedStatus !== "passed" ||
      test.status !== "unexpected" ||
      test.results?.length !== 1 ||
      result?.status !== "failed" ||
      result.retry !== 0 ||
      errors.length !== 1 ||
      !message.includes("the departure opened partway down itself") ||
      !message.includes("toBeLessThanOrEqual") ||
      /timeout|timed out/i.test(message)
    ) {
      throw new Error(
        "Expected only the unchanged named scroll assertion, with no retry/setup/timeout failure",
      );
    }
    const attachment = result.attachments?.find((item) => item.name === "navigation-scroll-4183");
    if (!attachment || !result.attachments.some((item) => item.name === "trace"))
      throw new Error("Missing causal timeline/trace");
    const timeline = loadTimeline(attachment);
    if (
      !Number.isInteger(timeline.repeat) ||
      timeline.repeat < 0 ||
      timeline.repeat >= CAUSAL_REPEATS ||
      repeats.has(timeline.repeat)
    )
      throw new Error("Duplicate/missing causal repeat identity");
    repeats.add(timeline.repeat);
    const allEvents = timeline.events ?? [];
    const final = allEvents.at(-1);
    const clickIndex = allEvents.findLastIndex(
      (event) => event.kind === "click" && event.detail?.destination === final?.url,
    );
    const click = allEvents[clickIndex];
    if (!click || !/\/schedule\/board$/.test(click.url) || !(click.y > 0))
      throw new Error("Missing final board-to-departure navigation epoch");
    const events = allEvents.slice(clickIndex + 1);
    const geometry = final?.geometry;
    const main = geometry?.mains?.[0];
    const bar = geometry?.chrome?.[0];
    const maxTop = Math.max(0, Math.round((main?.top ?? NaN) + final?.y - (bar?.height ?? NaN)));
    if (
      final?.kind !== "final" ||
      !/\/trips\//.test(final.url) ||
      !geometry?.headings?.length ||
      !(Number.parseFloat(geometry.padding) > 0) ||
      !(final.y > maxTop)
    )
      throw new Error("Missing failing settled main/heading geometry");
    const expected = message.match(/Expected:\s*<=\s*(\d+(?:\.\d+)?)/)?.[1];
    const received = message.match(/Received:\s*(\d+(?:\.\d+)?)/)?.[1];
    if (Number(expected) !== maxTop || Number(received) !== final.y)
      throw new Error("Assertion numbers do not match settled geometry");
    const consumeIndex = events.findIndex(
      (event) =>
        event.kind === "consume" &&
        event.url === final.url &&
        event.detail?.initialTargetState === 1 &&
        event.detail.pending === true &&
        event.y > 0 &&
        event.y < click.y &&
        click.y === final.y &&
        event.y === event.geometry?.height - event.geometry?.viewport,
    );
    const consumed = events[consumeIndex];
    if (
      !consumed ||
      !events
        .slice(0, consumeIndex)
        .some(
          (event) =>
            event.kind === "handler" &&
            event.ref === consumed.ref &&
            event.detail?.pending === true,
        ) ||
      !events
        .slice(0, consumeIndex)
        .some(
          (event) =>
            event.kind === "fragment-rects" &&
            event.target === consumed.target &&
            event.detail?.rects?.length,
        ) ||
      !events
        .slice(0, consumeIndex)
        .some(
          (event) =>
            event.kind === "fragment-decision" &&
            event.target === consumed.target &&
            event.detail?.state === 1,
        ) ||
      !events
        .slice(consumeIndex + 1)
        .some((event) => event.kind === "scroll" && event.url === final.url && event.y === final.y)
    ) {
      throw new Error(
        "Timeline does not prove clamped pending intent consumption followed by restoration",
      );
    }
    return {
      name: CAUSAL_TEST,
      repeat: timeline.repeat,
      scrollY: final.y,
      maxTop,
      clampedY: consumed.y,
    };
  });
}
function prepare() {
  if (process.platform !== "linux" || process.env.CI !== "true")
    throw new Error("Expected-red mutation is Linux CI only");
  if (existsSync(STATE))
    throw new Error("Restore the previous causal proof before preparing again");
  const require = createRequire(import.meta.url);
  const next = dirname(require.resolve("next/package.json"));
  const version = require("next/package.json").version;
  const workspace = realpathSync(process.cwd());
  if (workspace !== realpathSync(process.env.GITHUB_WORKSPACE))
    throw new Error("Proof must stay in its isolated job workspace");
  const withinWorkspace = (path) => {
    const rel = relative(workspace, realpathSync(path));
    if (rel.startsWith("..") || isAbsolute(rel))
      throw new Error("Proof target is outside the isolated workspace");
  };
  const originals = [];
  const replacements = [];
  for (const variant of ["client", "esm/client"]) {
    for (const [name, kind] of [
      ["app-router-state", "state"],
      ["layout-router", "layout"],
    ]) {
      const path = join(next, `dist/${variant}/components/${name}.js`);
      withinWorkspace(path);
      const source = readFileSync(path, "utf8");
      let changed = removeCausalFix(source, kind, version);
      if (kind === "layout") changed = instrumentScrollRouter(changed);
      originals.push({ path, source, sha256: digest(source), mode: statSync(path).mode & 0o777 });
      replacements.push({ path, source: changed });
    }
  }
  const path = resolve("e2e/staff-nav.spec.ts");
  withinWorkspace(path);
  const source = readFileSync(path, "utf8");
  const changed = `import { startNavigationProof, attachNavigationProof } from "./navigation-proof-observer";\n${source}\ntest.beforeEach(async ({ page }) => { await startNavigationProof(page); });\ntest.afterEach(async ({ page }, info) => { await attachNavigationProof(page, info); });\n`;
  originals.push({ path, source, sha256: digest(source), mode: statSync(path).mode & 0o777 });
  replacements.push({ path, source: changed });
  // All hunks are validated before the first write; backups precede every mutation.
  writeFileSync(STATE, JSON.stringify(originals));
  for (const item of replacements) atomicWrite(item.path, item.source);
  writeFileSync(
    "navigation-proof-before-delta.json",
    JSON.stringify(
      {
        commit: "20e17625f9409de3f07d1cca27af58510fcca6dd",
        version,
        files: originals.map(({ path, sha256, mode }) => ({ path, sha256, mode })),
      },
      null,
      2,
    ),
  );
}
function main(command, exitCode) {
  if (command === "prepare") prepare();
  else if (command === "restore") {
    const originals = JSON.parse(readFileSync(STATE, "utf8"));
    const restored = restoreOriginals(originals);
    for (const item of originals) {
      if ((statSync(item.path).mode & 0o777) !== item.mode)
        throw new Error(`Restored mode mismatch: ${item.path}`);
    }
    writeFileSync("navigation-proof-restoration.json", JSON.stringify(restored, null, 2));
    unlinkSync(STATE);
    // Never reuse compiled observer/pre-fix chunks for the restored proof.
    rmSync(resolve(".next"), { recursive: true, force: true });
  } else if (command === "classify") {
    const results = classifyCausalRed(
      JSON.parse(readFileSync("navigation-proof-before/results.json", "utf8")),
      Number(exitCode),
      (attachment) => JSON.parse(readFileSync(attachment.path, "utf8")),
    );
    writeFileSync("navigation-proof-before.json", JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
  } else throw new Error("Use prepare, restore or classify");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main(process.argv[2], process.argv[3]);
