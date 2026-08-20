import type { ReactElement } from "react";

/**
 * Depth-first readers for the element tree a Server Component returns.
 *
 * Why not render it: these pages carry server-action *functions* as a `<form>`'s
 * `action`, which no HTML serializer will take, and `@testing-library` would
 * need a client boundary that does not exist. Reading the props the page
 * actually built is both simpler and closer to the question being asked —
 * "did this page decide to show that control?" rather than "how does it look?".
 *
 * Every walker here is the same shape: recurse through arrays and `children`,
 * collect one prop, return it in render order. They live together because the
 * settings hub, the orders index, and anything else that tests a rendering
 * *condition* need the identical traversal, and three private copies of a tree
 * walk is three places for one to drift.
 */

/** Every element whose `type` matches `component`, in render order. */
export function findElements<P>(
  node: unknown,
  component: unknown,
  found: ReactElement<P>[] = [],
): ReactElement<P>[] {
  if (node === null || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, component, found);
    return found;
  }
  if ("type" in node && "props" in node) {
    const element = node as ReactElement<P & { children?: unknown }>;
    if (element.type === component) found.push(element as unknown as ReactElement<P>);
    findElements(element.props?.children, component, found);
  }
  return found;
}

/** Every `href` on an anchor or `Link` anywhere in a tree. */
export function hrefsIn(node: unknown, found: string[] = []): string[] {
  if (node === null || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) hrefsIn(child, found);
    return found;
  }
  if ("props" in node) {
    const element = node as ReactElement<{ href?: unknown; children?: unknown }>;
    if (typeof element.props?.href === "string") found.push(element.props.href);
    hrefsIn(element.props?.children, found);
  }
  return found;
}

/** Every `name` on a `<select>` anywhere in a tree, in render order. */
export function selectNamesIn(node: unknown, found: string[] = []): string[] {
  if (node === null || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) selectNamesIn(child, found);
    return found;
  }
  if ("type" in node && "props" in node) {
    const element = node as ReactElement<{ name?: unknown; children?: unknown }>;
    if (element.type === "select" && typeof element.props?.name === "string") {
      found.push(element.props.name);
    }
    selectNamesIn(element.props?.children, found);
  }
  return found;
}

/**
 * Every `aria-label` anywhere in a tree — how a conditional panel names itself,
 * and therefore the cheapest honest answer to "did it render at all?".
 */
export function ariaLabelsIn(node: unknown, found: string[] = []): string[] {
  if (node === null || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) ariaLabelsIn(child, found);
    return found;
  }
  if ("props" in node) {
    const element = node as ReactElement<{ "aria-label"?: unknown; children?: unknown }>;
    const label = element.props?.["aria-label"];
    if (typeof label === "string") found.push(label);
    ariaLabelsIn(element.props?.children, found);
  }
  return found;
}

/**
 * Every `name` on a hidden input anywhere in a tree — which rows offered a
 * control, since a form that acts on a row id always carries that id hidden.
 */
/** Every `name` on an `<input>` anywhere in a tree, hidden ones included. */
export function inputNamesIn(node: unknown, found: string[] = []): string[] {
  if (node === null || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) inputNamesIn(child, found);
    return found;
  }
  if ("type" in node && "props" in node) {
    const element = node as ReactElement<{ name?: unknown; children?: unknown }>;
    if (element.type === "input" && typeof element.props?.name === "string") {
      found.push(element.props.name);
    }
    inputNamesIn(element.props?.children, found);
  }
  return found;
}

export function hiddenInputNamesIn(node: unknown, found: string[] = []): string[] {
  if (node === null || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) hiddenInputNamesIn(child, found);
    return found;
  }
  if ("type" in node && "props" in node) {
    const element = node as ReactElement<{ type?: unknown; name?: unknown; children?: unknown }>;
    if (
      element.type === "input" &&
      element.props?.type === "hidden" &&
      typeof element.props?.name === "string"
    ) {
      found.push(element.props.name);
    }
    hiddenInputNamesIn(element.props?.children, found);
  }
  return found;
}
