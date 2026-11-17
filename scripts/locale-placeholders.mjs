/**
 * The placeholders a translation must carry over unchanged: the ICU argument
 * names and the rich-text tags. `scripts/check-locale.mjs` holds every bundle
 * to the argument names; `scripts/draft-locale.mjs` holds a machine draft to
 * both before it is written anywhere (issue #4250).
 */

/**
 * ICU argument names in a message — `{name}` and the `{count, plural, …}` head
 * alike, and *only* those.
 *
 * The nesting matters. A plural branch body is itself a brace group holding
 * ordinary text (`one {queda #}`), and matching every `{word` in the string
 * reads that text as two more arguments — which fails any translation whose
 * plural forms differ by more than the number, i.e. most of them outside
 * English. Argument names sit at even brace depth (an argument opens at depth
 * 0; its branch bodies open at depth 1; an argument nested inside a body opens
 * at depth 2), so depth is what tells the two apart.
 */
export function placeholders(message) {
  const names = [];
  let depth = 0;
  const text = String(message);
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (character !== "{") continue;
    if (depth % 2 === 0) {
      const name = /^\s*(\w+)/.exec(text.slice(index + 1));
      if (name) names.push(name[1]);
    }
    depth += 1;
  }
  return names.sort();
}

/** Rich-text tags (`<link>`, `</link>`, `<strong>`), sorted, repeats kept. */
export function richTextTags(message) {
  return (String(message).match(/<\/?[A-Za-z][A-Za-z0-9]*>/g) ?? []).sort();
}

/**
 * Whether `draft` keeps every placeholder of `reference`, and nothing more:
 * the same ICU argument names and the same rich-text tags, each as often.
 * `missing` and `extra` name what differs, for the line a human reads.
 */
export function placeholderParity(reference, draft) {
  const expected = [...placeholders(reference), ...richTextTags(reference)];
  const actual = [...placeholders(draft), ...richTextTags(draft)];
  const missing = difference(expected, actual);
  const extra = difference(actual, expected);
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

/** `left` minus `right`, as multisets. */
function difference(left, right) {
  const remaining = [...right];
  const out = [];
  for (const item of left) {
    const at = remaining.indexOf(item);
    if (at === -1) out.push(item);
    else remaining.splice(at, 1);
  }
  return out;
}
