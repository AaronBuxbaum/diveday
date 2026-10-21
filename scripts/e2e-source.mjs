// Small lexical reader for conservative source checks. Comments are discarded;
// quoted contents are tokens, never executable declarations. Balanced delimiters
// keep nested callback/suite bodies separate without depending on compiler APIs.
export function tokens(source) {
  const result = [];
  // Failed suffixes are memoized by regex state. A malformed class containing
  // many slashes must not make each later slash rescan the same suffix.
  const failedRegex = [new Set(), new Set()];
  function regexEnd(start) {
    let cursor = start + 1;
    let inClass = 0;
    const visited = [];
    while (cursor < source.length) {
      if (failedRegex[inClass].has(cursor)) break;
      visited.push([cursor, inClass]);
      const char = source[cursor];
      if (char === "\\") {
        if (cursor + 1 === source.length || source[cursor + 1] === "\n") break;
        cursor += 2;
      } else if (inClass) {
        if (char === "]") inClass = 0;
        cursor++;
      } else if (char === "[") {
        inClass = 1;
        cursor++;
      } else if (char === "/") {
        if (cursor === start + 1) break;
        cursor++;
        while (cursor < source.length && /[dgimsuvy]/.test(source[cursor])) cursor++;
        return cursor;
      } else if (char === "\n") break;
      else cursor++;
    }
    for (const [index, state] of visited) failedRegex[state].add(index);
    return start + 1;
  }
  const failedQuotes = new Map(['"', "'", "`"].map((quote) => [quote, new Set()]));
  let noBlockCommentEnd = false;
  for (let cursor = 0; cursor < source.length; ) {
    const start = cursor;
    const char = source[cursor];
    if (/\s/.test(char)) {
      cursor++;
      continue;
    }
    if (source.startsWith("//", cursor)) {
      const end = source.indexOf("\n", cursor + 2);
      cursor = end === -1 ? source.length : end;
      continue;
    }
    if (!noBlockCommentEnd && source.startsWith("/*", cursor)) {
      const end = source.indexOf("*/", cursor + 2);
      if (end !== -1) {
        cursor = end + 2;
        continue;
      }
      noBlockCommentEnd = true;
    }
    if (char === '"' || char === "'" || char === "`") {
      const failed = failedQuotes.get(char);
      const visited = [];
      cursor++;
      while (cursor < source.length && source[cursor] !== char && !failed.has(cursor)) {
        visited.push(cursor);
        cursor += source[cursor] === "\\" ? 2 : 1;
      }
      // An unterminated quote remains punctuation, as in the original reader.
      if (cursor < source.length && source[cursor] === char) cursor++;
      else {
        for (const index of visited) failed.add(index);
        cursor = start + 1;
      }
    } else if (char === "/") cursor = regexEnd(start);
    else if (/[A-Za-z_$]/.test(char)) {
      cursor++;
      while (cursor < source.length && /[\w$]/.test(source[cursor])) cursor++;
    } else cursor++;
    result.push({ text: source.slice(start, cursor), index: start });
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
