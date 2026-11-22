// The breakage-drill engine (ADR 20261122-diff-mutation-testing): reads one TypeScript source
// with a real parser and lists the small, deliberate breaks ("mutants") a test should notice.
//
// A mutant is a text splice on the original source, so its line and column are the source's own
// and match a `git diff`. Spans from `oxc-parser`'s JavaScript API are UTF-16 offsets, the same
// unit as a JavaScript string index, so a splice lands on the right character after any
// non-ASCII text (engine.test.mjs pins it). Every mutant is parsed again before it is offered:
// one that does not parse is dropped and counted, never run.
//
// Expression-level only. Never inside a type, an import or export specifier, a directive, a
// template literal's text, a tagged template (`sql\`...\``), an object key, or the target of
// `as const` / `satisfies`. Logging calls are never skipped.

import { parseSync } from "oxc-parser";

/** The plain words a person reads on the risk card for each kind of break. */
export const OPERATORS = {
  comparison: "flip a comparison",
  logical: "swap and/or",
  arithmetic: "change the math",
  negation: "negate a check",
  minus: "drop a minus sign",
  boolean: "flip true and false",
  number: "change a number",
  string: "empty a string",
  condition: "drop a condition",
  loop: "skip a loop",
  call: "skip a call",
  return: "return nothing",
  someEvery: "swap some and every",
  minMax: "swap min and max",
};

const COMPARISON_SWAPS = {
  "<": ["<="],
  "<=": ["<"],
  ">": [">="],
  ">=": [">"],
  "===": ["!=="],
  "!==": ["==="],
  "==": ["!="],
  "!=": ["=="],
};
const LOGICAL_SWAPS = { "&&": ["||"], "||": ["&&"], "??": ["||"] };
const ARITHMETIC_SWAPS = { "+": ["-"], "-": ["+"], "*": ["/"], "/": ["*"], "%": ["*"] };
const ASSIGNMENT_SWAPS = { "+=": ["-="], "-=": ["+="] };
const SOME_EVERY = new Map([
  ["some", "every"],
  ["every", "some"],
]);
const MIN_MAX = new Map([
  ["min", "max"],
  ["max", "min"],
]);
const COMPARISONS = new Set(Object.keys(COMPARISON_SWAPS));

/** A call statement whose callee starts with one of these is logging or an assertion, never drilled. */
const QUIET_CALLEES = /^(?:log\.|logger\.|console\.|span\.|Sentry\.|assert)/;

/** Keys whose subtree is a type, never an expression. */
const TYPE_KEYS = new Set([
  "typeAnnotation",
  "returnType",
  "typeParameters",
  "typeArguments",
  "superTypeArguments",
  "implements",
]);

/** `// mutation-ok: <reason>`: the reason must be at least this long. */
export const MIN_REASON = 8;

const MUTATION_OK = /^\s*mutation-ok\b\s*(?::\s*(.*?))?\s*$/;

/** A file nobody writes by hand, or one with nothing to run. */
export function isSkippedFile(file, source) {
  if (/\.d\.[cm]?ts$/.test(file)) return true;
  const head = source.slice(0, 600);
  return /@generated\b|\bauto-generated\b|\bDO NOT EDIT\b/i.test(head);
}

function lineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) if (source[i] === "\n") starts.push(i + 1);
  return starts;
}

function locate(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo] + 1 };
}

function lineText(source, starts, line) {
  const from = starts[line - 1];
  const to = line < starts.length ? starts[line] - 1 : source.length;
  return source.slice(from, to).trim();
}

function langOf(file) {
  return /\.[cm]?tsx$/.test(file) ? "tsx" : /\.[cm]?jsx?$/.test(file) ? "js" : "ts";
}

/** Parses with the language the file extension names; `errors` is empty when it parses. */
export function parse(file, source) {
  return parseSync(file, source, { lang: langOf(file) });
}

/**
 * The `// mutation-ok` comments in a file: `accepted` lines with their reasons, and `refused`
 * bare or too-short ones, which fail the run. A comment exempts its own line and the line below
 * it, so it can sit at the end of the line or on its own line above.
 */
export function exemptions(comments, source) {
  const starts = lineStarts(source);
  const accepted = [];
  const refused = [];
  const lines = new Set();
  for (const comment of comments) {
    if (comment.type !== "Line") continue;
    const match = MUTATION_OK.exec(comment.value);
    if (!match) continue;
    const { line } = locate(starts, comment.start);
    const lineStart = starts[line - 1];
    const ownLine = source.slice(lineStart, comment.start).trim() === "";
    const codeLine = ownLine ? line + 1 : line;
    const reason = (match[1] ?? "").trim();
    if (reason.length < MIN_REASON) {
      refused.push({ line: codeLine });
      continue;
    }
    accepted.push({ line: codeLine, reason });
    lines.add(line);
    lines.add(line + 1);
  }
  return { accepted, refused, lines };
}

/** The first token between `from` and `to`, skipping whitespace, parentheses and comments. */
function operatorAt(source, from, to, operator) {
  let i = from;
  while (i < to) {
    const ch = source[i];
    if (/\s|\(|\)/.test(ch)) {
      i += 1;
    } else if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      i = end === -1 ? to : end + 1;
    } else if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? to : end + 2;
    } else {
      return source.startsWith(operator, i) ? i : -1;
    }
  }
  return -1;
}

function isStringLiteral(node) {
  return node?.type === "Literal" && typeof node.value === "string";
}

function isEquivalentDefault(node) {
  if (node.type === "ArrayExpression" || node.type === "ObjectExpression") return true;
  return node.type === "Literal" && node.value === false;
}

function isNothing(node) {
  if (!node) return true;
  if (node.type === "Identifier" && node.name === "undefined") return true;
  if (node.type === "Literal" && node.value === null && node.raw === "null") return true;
  if (node.type === "UnaryExpression" && node.operator === "void") return true;
  return false;
}

function returnsVoid(fn) {
  const type = fn?.returnType?.typeAnnotation;
  if (!type) return false;
  if (type.type === "TSVoidKeyword" || type.type === "TSUndefinedKeyword") return true;
  if (
    type.type === "TSTypeReference" &&
    type.typeName?.name === "Promise" &&
    type.typeArguments?.params?.length === 1
  ) {
    const inner = type.typeArguments.params[0].type;
    return inner === "TSVoidKeyword" || inner === "TSUndefinedKeyword";
  }
  return false;
}

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

function isConstAssertion(node) {
  const type = node.typeAnnotation;
  return (
    node.type === "TSAsExpression" &&
    type?.type === "TSTypeReference" &&
    type.typeName?.type === "Identifier" &&
    type.typeName.name === "const"
  );
}

/** Walks the expression and statement nodes a mutant may touch, with each node's parent. */
function walk(node, visit, parent = null, key = null, fn = null) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, parent, key, fn);
    return;
  }
  if (!node || typeof node !== "object" || typeof node.type !== "string") return;
  switch (node.type) {
    case "ImportDeclaration":
    case "ExportAllDeclaration":
    case "TaggedTemplateExpression":
    case "TSSatisfiesExpression":
      return;
    case "ExportNamedDeclaration":
      walk(node.declaration, visit, node, "declaration", fn);
      return;
    case "TSAsExpression":
    case "TSNonNullExpression":
    case "TSTypeAssertion":
    case "TSInstantiationExpression":
      if (isConstAssertion(node)) return;
      walk(node.expression, visit, node, "expression", fn);
      return;
    case "ExpressionStatement":
      if (node.directive) return;
      break;
    default:
      if (node.type.startsWith("TS")) return;
  }
  visit(node, parent, key, fn);
  const enclosing = FUNCTIONS.has(node.type) ? node : fn;
  for (const [childKey, child] of Object.entries(node)) {
    if (childKey === "type" || TYPE_KEYS.has(childKey)) continue;
    if (child && typeof child === "object") walk(child, visit, node, childKey, enclosing);
  }
}

function clip(text, max = 60) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Every candidate mutant in `source`, before exemptions and line filtering: `{ kind, start,
 * end, replacement, was, became }`, where `[start, end)` is the spliced range and `was` /
 * `became` are the short texts the card shows.
 */
function candidates(program, source) {
  const found = [];
  const add = (
    kind,
    start,
    end,
    replacement,
    was = source.slice(start, end),
    became = replacement,
  ) => found.push({ kind, start, end, replacement, was: clip(was), became: clip(became) });
  const swapOperator = (kind, node, swaps) => {
    for (const next of Object.hasOwn(swaps, node.operator) ? swaps[node.operator] : []) {
      const at = operatorAt(source, node.left.end, node.right.start, node.operator);
      if (at !== -1) add(kind, at, at + node.operator.length, next);
    }
  };

  walk(program, (node, parent, key, fn) => {
    switch (node.type) {
      case "BinaryExpression": {
        if (COMPARISONS.has(node.operator)) {
          swapOperator("comparison", node, COMPARISON_SWAPS);
          for (const side of [node.left, node.right]) {
            if (isStringLiteral(side) && side.value !== "")
              add("string", side.start, side.end, '""');
          }
        } else if (Object.hasOwn(ARITHMETIC_SWAPS, node.operator)) {
          // `"Hello " + name` joins text; a minus there is noise, not a drill.
          const text = (side) => isStringLiteral(side) || side.type === "TemplateLiteral";
          if (node.operator === "+" && (text(node.left) || text(node.right))) break;
          swapOperator("arithmetic", node, ARITHMETIC_SWAPS);
        }
        break;
      }
      case "LogicalExpression":
        // `a ?? []`, `a ?? {}` and `a ?? false` equal `a || …` for every value of a's type (an
        // array or object is never falsy; false || false is false): a known equivalent break.
        if (node.operator === "??" && isEquivalentDefault(node.right)) break;
        swapOperator("logical", node, LOGICAL_SWAPS);
        break;
      case "AssignmentExpression":
        for (const next of Object.hasOwn(ASSIGNMENT_SWAPS, node.operator)
          ? ASSIGNMENT_SWAPS[node.operator]
          : []) {
          const at = operatorAt(source, node.left.end, node.right.start, node.operator);
          if (at !== -1) add("arithmetic", at, at + 2, next);
        }
        break;
      case "UnaryExpression":
        if (node.operator === "!") add("negation", node.start, node.argument.start, "", "!", "");
        else if (node.operator === "-") add("minus", node.start, node.argument.start, "", "-", "");
        break;
      case "Literal": {
        const isKey = parent?.type === "Property" && key === "key" && !parent.computed;
        if (isKey || parent?.type === "ImportExpression") break;
        if (typeof node.value === "boolean") {
          add("boolean", node.start, node.end, String(!node.value));
        } else if (typeof node.value === "number" && !/n$/.test(node.raw ?? "")) {
          const next = node.value + 1;
          if (Number.isFinite(next) && next !== node.value)
            add("number", node.start, node.end, String(next));
        } else if (isStringLiteral(node) && parent?.type === "SwitchCase" && key === "test") {
          if (node.value !== "") add("string", node.start, node.end, '""');
        }
        break;
      }
      case "IfStatement": {
        const was = source.slice(node.test.start, node.test.end);
        add("condition", node.test.start, node.test.end, "true", was, "true");
        add("condition", node.test.start, node.test.end, "false", was, "false");
        break;
      }
      case "WhileStatement":
        add("loop", node.test.start, node.test.end, "false");
        break;
      case "ConditionalExpression": {
        const test = source.slice(node.test.start, node.test.end);
        for (const branch of [node.consequent, node.alternate]) {
          const text = source.slice(branch.start, branch.end);
          add("condition", node.start, node.end, `(${text})`, `${test} ? …`, text);
        }
        break;
      }
      case "ReturnStatement": {
        if (isNothing(node.argument) || returnsVoid(fn)) break;
        add("return", node.argument.start, node.argument.end, "undefined");
        break;
      }
      case "ExpressionStatement": {
        let call = node.expression;
        if (call.type === "AwaitExpression") call = call.argument;
        if (call.type === "ChainExpression") call = call.expression;
        if (call.type !== "CallExpression") break;
        const callee = source.slice(call.callee.start, call.callee.end);
        if (QUIET_CALLEES.test(callee) || call.callee.type === "Super") break;
        add(
          "call",
          node.start,
          node.end,
          "void 0;",
          source.slice(node.start, node.end),
          "(skipped)",
        );
        break;
      }
      case "CallExpression": {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) break;
        const name = callee.property?.name;
        const swap = SOME_EVERY.get(name);
        if (swap) add("someEvery", callee.property.start, callee.property.end, swap);
        if (callee.object?.type === "Identifier" && callee.object.name === "Math") {
          const other = MIN_MAX.get(name);
          if (other) add("minMax", callee.property.start, callee.property.end, other);
        }
        break;
      }
      default:
    }
  });
  return found;
}

/**
 * The mutants of one file.
 *
 * `lines` (optional) keeps only mutants whose spliced text starts on one of those lines, which
 * is how a pull request's changed lines are drilled. Returns `{ mutants, accepted, refused,
 * unparsable }`: `accepted` are the `// mutation-ok` lines (in `lines`, when given) with their
 * reasons, `refused` the bare ones, and `unparsable` how many candidates were dropped because
 * the mutated text did not parse.
 */
export function mutantsFor(file, source, { lines } = {}) {
  const parsed = parse(file, source);
  if (parsed.errors.length > 0) {
    throw new Error(`${file} does not parse: ${parsed.errors[0].message}`);
  }
  const starts = lineStarts(source);
  const exempt = exemptions(parsed.comments, source);
  const inScope = (line) => !lines || lines.has(line);
  const mutants = [];
  let unparsable = 0;
  const counter = new Map();
  const ordered = candidates(parsed.program, source).sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
  for (const candidate of ordered) {
    const { line, column } = locate(starts, candidate.start);
    if (!inScope(line) || exempt.lines.has(line)) continue;
    const text =
      source.slice(0, candidate.start) + candidate.replacement + source.slice(candidate.end);
    if (parse(file, text).errors.length > 0) {
      unparsable += 1;
      continue;
    }
    const base = `${file}:${line}:${column}:${candidate.kind}`;
    const n = (counter.get(base) ?? 0) + 1;
    counter.set(base, n);
    mutants.push({
      id: `${base}:${n}`,
      file,
      line,
      column,
      operator: OPERATORS[candidate.kind],
      was: candidate.was,
      became: candidate.became,
      snippet: lineText(source, starts, line),
      start: candidate.start,
      end: candidate.end,
      replacement: candidate.replacement,
    });
  }
  return {
    mutants,
    accepted: exempt.accepted.filter((entry) => inScope(entry.line)),
    refused: exempt.refused.filter((entry) => inScope(entry.line)),
    unparsable,
  };
}

/** The source with one mutant applied. */
export function applyMutant(source, mutant) {
  return source.slice(0, mutant.start) + mutant.replacement + source.slice(mutant.end);
}

function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function seededShuffle(items, seed) {
  let state = hash32(seed) || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * At most `max` mutants, dealt round-robin across files so a large file cannot crowd out a small
 * one, each file's order shuffled by a seed (the head commit), so a run is repeatable. Returns
 * the chosen mutants in source order per file.
 */
export function chooseMutants(byFile, max, seed) {
  const files = [...byFile.keys()].sort();
  const queues = files.map((file) => seededShuffle(byFile.get(file), `${seed}:${file}`));
  const chosen = new Set();
  let added = true;
  while (chosen.size < max && added) {
    added = false;
    for (const queue of queues) {
      if (chosen.size >= max) break;
      const next = queue.shift();
      if (next) {
        chosen.add(next);
        added = true;
      }
    }
  }
  return files.flatMap((file) => byFile.get(file).filter((mutant) => chosen.has(mutant)));
}
