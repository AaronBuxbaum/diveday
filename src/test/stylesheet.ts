import { readFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";

/**
 * **`globals.css`, read as rules rather than as text**, for the tests that
 * pin what the stylesheet asks for without a browser (`src/app/*.test.ts`).
 *
 * A rule's *layer* decides what it can beat — an unlayered declaration beats
 * every Tailwind utility whatever its specificity, an `@layer base` one loses
 * to all of them — so the helpers keep the two apart. What a selector matches
 * is the DOM's to say: a jsdom test hands `rule.prelude` to `element.matches`.
 */
export type CssBlock = { prelude: string; body: string };

/** Remove CSS comments by their parser offsets, without treating string contents as comments. */
function withoutComments(css: string): string {
  const comments: Array<[start: number, end: number]> = [];
  postcss.parse(css).walkComments((comment) => {
    const source = comment.source;
    if (!source) return;
    const { start, end } = source;
    if (start?.offset !== undefined && end?.offset !== undefined) {
      comments.push([start.offset, end.offset]);
    }
  });

  let result = css;
  for (const [start, end] of comments.reverse()) {
    result = result.slice(0, start) + result.slice(end);
  }
  return result;
}

/** The app's stylesheet with its comments stripped. */
export function readGlobalsCss(): string {
  return withoutComments(
    readFileSync(path.join(import.meta.dirname, "..", "app", "globals.css"), "utf8"),
  );
}

type BlockNode = postcss.Rule | postcss.AtRule;

function isBlockNode(node: postcss.ChildNode): node is BlockNode {
  return node.type === "rule" || (node.type === "atrule" && node.nodes !== undefined);
}

/** Serialize a container's children with PostCSS's original whitespace and semicolons. */
function bodyOf(node: postcss.Container): string {
  return postcss.root({ nodes: node.nodes, raws: node.raws }).toString();
}

function preludeOf(node: BlockNode): string {
  if (node.type === "rule") return (node.raws.selector?.value ?? node.selector).trim();
  return `@${node.name}${node.raws.afterName ?? ""}${node.raws.params?.value ?? node.params}`.trim();
}

function blockOf(node: BlockNode): CssBlock {
  return { prelude: preludeOf(node), body: bodyOf(node) };
}

function blocksIn(nodes: readonly postcss.ChildNode[] = []): CssBlock[] {
  return nodes.filter(isBlockNode).map(blockOf);
}

/** The `prelude { body }` blocks at the top level of `css`. */
export function topLevelBlocks(css: string): CssBlock[] {
  return blocksIn(postcss.parse(css).nodes);
}

/**
 * Every style rule outside any cascade layer. `@media`, `@supports` and
 * `@container` are walked into; `@layer`, `@utility`, `@theme` and the other
 * directives are layered (or emit nothing) and are skipped.
 */
export function unlayeredRules(css: string): CssBlock[] {
  const walk = (nodes: readonly postcss.ChildNode[] = []): CssBlock[] =>
    nodes.flatMap((node) => {
      if (node.type === "atrule") {
        if (/^@(media|supports|container)\b/.test(preludeOf(node))) {
          return walk(node.nodes);
        }
        return [];
      }
      return node.type === "rule" ? [blockOf(node)] : [];
    });

  return walk(postcss.parse(css).nodes);
}

/** The style rules inside the stylesheet's direct `@layer base` blocks. */
export function baseLayerRules(css: string): CssBlock[] {
  const root = postcss.parse(css);
  return root.nodes.flatMap((node) => {
    if (node.type !== "atrule" || preludeOf(node) !== "@layer base") return [];
    return blocksIn(node.nodes);
  });
}

/** A declaration block's `property: value` pairs, whitespace-normalised. */
export function declarations(body: string): Record<string, string> {
  const root = postcss.parse(`__declarations__ {${body}}`);
  const rule = root.first;
  if (rule?.type !== "rule") return {};

  return Object.fromEntries(
    rule.nodes
      ?.filter((node): node is postcss.Declaration => node.type === "decl")
      .map((declaration) => [
        declaration.prop.trim(),
        `${declaration.value}${declaration.important ? " !important" : ""}`
          .trim()
          .replace(/\s+/g, " "),
      ]) ?? [],
  );
}
