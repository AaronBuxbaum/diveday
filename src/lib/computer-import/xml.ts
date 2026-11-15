import { COMPUTER_IMPORT_LIMITS as LIMIT, refuse } from "./types";
export type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
};
const namePattern = "[A-Za-z_][A-Za-z0-9_.:-]*";
function decode(raw: string): string {
  return raw.replace(/&([^;]*);|&/g, (full, entity: string | undefined) => {
    const builtins: Record<string, string> = { amp: "&", lt: "<", gt: ">", apos: "'", quot: '"' };
    if (entity && Object.hasOwn(builtins, entity)) return builtins[entity] ?? "";
    if (entity && /^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(entity)) {
      const code =
        entity[1] === "x" ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (
        code === 9 ||
        code === 10 ||
        code === 13 ||
        (code >= 32 &&
          code <= 0x10ffff &&
          !(code >= 0xd800 && code <= 0xdfff) &&
          code !== 0xfffe &&
          code !== 0xffff)
      )
        return String.fromCodePoint(code);
    }
    void full;
    return refuse("unsafe_xml");
  });
}
/** Deliberately small XML reader. No resolver, DTD, entity declarations or network operations. */
export function parseXml(input: string): XmlNode {
  if (
    /<!DOCTYPE|<!ENTITY/i.test(input) ||
    Array.from(input).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    })
  )
    refuse("unsafe_xml");
  const document: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack = [document];
  let pos = 0;
  let count = 0;
  while (pos < input.length) {
    const parent = stack.at(-1);
    if (!parent) refuse("invalid_xml");
    if (input.startsWith("<!--", pos)) {
      const end = input.indexOf("-->", pos + 4);
      if (end < 0 || input.slice(pos + 4, end).includes("--")) refuse("invalid_xml");
      pos = end + 3;
      continue;
    }
    if (input.startsWith("<?", pos)) {
      const end = input.indexOf("?>", pos + 2);
      if (end < 0 || pos > 0 || !/^<\?xml\s/.test(input)) refuse("invalid_xml");
      pos = end + 2;
      continue;
    }
    if (input.startsWith("<![CDATA[", pos)) {
      const end = input.indexOf("]]>", pos + 9);
      if (end < 0 || stack.length < 2) refuse("invalid_xml");
      parent.text += input.slice(pos + 9, end);
      pos = end + 3;
    } else if (input[pos] !== "<") {
      const end = input.indexOf("<", pos);
      const next = end < 0 ? input.length : end;
      const raw = input.slice(pos, next);
      if (raw.includes("]]>")) refuse("invalid_xml");
      parent.text += decode(raw);
      pos = next;
    } else if (input.startsWith("</", pos)) {
      const match = new RegExp(`^</(${namePattern})\\s*>`).exec(input.slice(pos));
      if (!match || stack.length < 2 || match[1] !== parent.name) refuse("invalid_xml");
      stack.pop();
      pos += match[0].length;
    } else {
      const match = new RegExp(`^<(${namePattern})(?=[\\s/>])`).exec(input.slice(pos));
      if (!match) refuse("invalid_xml");
      const node: XmlNode = {
        name: match[1] ?? "",
        attrs: Object.create(null) as Record<string, string>,
        children: [],
        text: "",
      };
      pos += match[0].length;
      let closed = false;
      let selfClosing = false;
      while (pos < input.length) {
        const rest = input.slice(pos);
        const end = /^\s*(\/?)>/.exec(rest);
        if (end) {
          pos += end[0].length;
          closed = true;
          selfClosing = end[1] === "/";
          break;
        }
        const attr = new RegExp(`^\\s+(${namePattern})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`).exec(
          rest,
        );
        if (!attr?.[1] || Object.hasOwn(node.attrs, attr[1])) refuse("invalid_xml");
        node.attrs[attr[1]] = decode(attr[2] ?? attr[3] ?? "");
        if (
          (node.attrs[attr[1]]?.length ?? 0) > LIMIT.textLength ||
          Object.keys(node.attrs).length > 64
        )
          refuse("limit_exceeded");
        pos += attr[0].length;
      }
      if (!closed) refuse("invalid_xml");
      parent.children.push(node);
      if (++count > LIMIT.xmlNodes || stack.length >= LIMIT.xmlDepth) refuse("limit_exceeded");
      if (!selfClosing) stack.push(node);
    }
    if (parent.text.length > LIMIT.textLength) refuse("limit_exceeded");
  }
  if (stack.length !== 1 || document.children.length !== 1 || document.text.trim())
    refuse("invalid_xml");
  const root = document.children[0];
  if (!root) refuse("invalid_xml");
  return root;
}
export const localName = (node: XmlNode) => node.name.split(":").at(-1) ?? node.name;
export const children = (node: XmlNode, name: string) =>
  node.children.filter((n) => localName(n) === name);
export function descendants(node: XmlNode, name: string): XmlNode[] {
  return node.children.flatMap((n) => [
    ...(localName(n) === name ? [n] : []),
    ...descendants(n, name),
  ]);
}
export const child = (node: XmlNode, name: string) => children(node, name)[0];
export const value = (node: XmlNode, name: string) => child(node, name)?.text.trim();
