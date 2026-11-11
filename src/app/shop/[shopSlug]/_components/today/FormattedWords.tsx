import { Fragment } from "react";

/** Preserve Intl's characters; only applied scaling enables these word boundaries. */
export function FormattedWords({ text }: { text: string }) {
  return (
    <span className="device-text-formatted-words">
      {[...text.matchAll(/[^\u00a0\u202f]*[\u00a0\u202f]|[^\u00a0\u202f]+$/g)].map((part) => (
        <Fragment key={part.index}>
          {part[0]}
          <wbr className="device-text-word-break" />
        </Fragment>
      ))}
    </span>
  );
}
