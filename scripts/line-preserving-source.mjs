/** Blank source comments without changing character offsets or line breaks. */
export function blankComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead) => lead + " ".repeat(match.length - lead.length));
}

/** Prepare comment-free source and map match offsets to zero-based line indexes. */
export function prepareLinePreservingSource(source) {
  const text = blankComments(source);
  const lineStarts = [0];
  for (let offset = 0; offset < text.length; offset += 1) {
    if (text[offset] === "\n") lineStarts.push(offset + 1);
  }

  const lineAt = (index) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (lineStarts[mid] <= index) low = mid;
      else high = mid - 1;
    }
    return low;
  };

  return { text, lineAt };
}
