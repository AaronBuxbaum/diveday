// Small lexical reader for conservative source checks. Comments are discarded;
// quoted contents are tokens, never executable declarations. Balanced delimiters
// keep nested callback/suite bodies separate without depending on compiler APIs.
export function tokens(source) {
  const result = [];
  const pattern =
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|(["'`])(?:\\[\s\S]|(?!\1)[^\\])*?\1|\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\n\\])+\/[dgimsuvy]*|[A-Za-z_$][\w$]*|[^\s]/g;
  for (const match of source.matchAll(pattern)) {
    if (match[0].startsWith("//") || match[0].startsWith("/*")) continue;
    result.push({ text: match[0], index: match.index });
  }
  return result;
}
export function calls(source) {
  const ts = tokens(source);
  const close = new Map();
  const stack = [];
  for (let i = 0; i < ts.length; i++) {
    if ("([{".includes(ts[i].text)) stack.push(i);
    else if (")]}".includes(ts[i].text)) {
      const start = stack.pop();
      if (start !== undefined) close.set(start, i);
    }
  }
  const found = [];
  for (let i = 0; i < ts.length; i++) {
    if (!/^[A-Za-z_$]/.test(ts[i].text) || ts[i - 1]?.text === ".") continue;
    let end = i;
    let name = ts[i].text;
    while (ts[end + 1]?.text === "." && /^[A-Za-z_$]/.test(ts[end + 2]?.text ?? "")) {
      name += `.${ts[end + 2].text}`;
      end += 2;
    }
    if (ts[end + 1]?.text !== "(" || !close.has(end + 1)) continue;
    const last = close.get(end + 1);
    const args = [];
    let argStart = end + 2;
    for (let cursor = argStart; cursor < last; cursor++) {
      if (close.has(cursor)) cursor = close.get(cursor);
      else if (ts[cursor].text === ",") {
        args.push(ts.slice(argStart, cursor));
        argStart = cursor + 1;
      }
    }
    if (argStart < last) args.push(ts.slice(argStart, last));
    found.push({
      name,
      args,
      start: ts[i].index,
      end: ts[last].index + 1,
      arg: ts[end + 2]?.text,
      tokens: ts.slice(end + 2, last),
    });
  }
  return found;
}
export function literal(text) {
  return /^["'`]/.test(text ?? "") && !text.includes("${") ? text.slice(1, -1) : null;
}
// Only top-level callback syntax counts: an arrow inside an options object
// does not end the declaration header. Function callbacks have the same role.
function isCallback(argument) {
  const start = argument[0]?.text === "async" ? 1 : 0;
  if (argument[start]?.text === "function") return true;
  let depth = 0;
  for (let i = start; i < argument.length; i++) {
    const text = argument[i].text;
    if ("([{".includes(text)) depth++;
    else if (")]}".includes(text)) depth--;
    else if (depth === 0 && text === "=" && argument[i + 1]?.text === ">") return true;
  }
  return false;
}
function header(call) {
  const callback = call.args?.findIndex(isCallback) ?? -1;
  return { callback, tokens: callback === -1 ? call.tokens : call.args.slice(0, callback).flat() };
}
export function disabled(call, all) {
  const within = (inner, outer) => inner.start > outer.start && inner.end < outer.end;
  const annotation = (other) =>
    /^test\.(skip|fixme|fail)$/.test(other.name) &&
    !(literal(other.arg) !== null && header(other).callback !== -1);
  const quarantined = (item) =>
    header(item).tokens?.some((token) => /@quarantine/.test(token.text));
  const parents = all.filter(
    (other) => /^test\.describe(?:\.(?:only|skip|fixme))?$/.test(other.name) && within(call, other),
  );
  return (
    /\.(skip|fixme|fail)$/.test(call.name) ||
    quarantined(call) ||
    all.some(
      (other) =>
        annotation(other) &&
        !all.some(
          (scope) =>
            /^(?:test|test\.describe)(?:\.(?:only|skip|fixme|fail))?$/.test(scope.name) &&
            within(other, scope),
        ),
    ) ||
    parents.some(
      (parent) =>
        /\.(skip|fixme)$/.test(parent.name) ||
        quarantined(parent) ||
        // Only suite-level annotations or hooks apply to descendants. A sibling
        // skipped test does not disable this declaration.
        all.some(
          (other) =>
            annotation(other) &&
            within(other, parent) &&
            !all.some(
              (test) =>
                /^test(?:\.(?:only|skip|fixme|fail))?$/.test(test.name) && within(other, test),
            ),
        ),
    ) ||
    all.some((other) => within(other, call) && annotation(other))
  );
}
