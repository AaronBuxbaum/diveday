import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function probeAttachment(result) {
  if (
    result.status !== "timedOut" ||
    result.errors?.length !== 1 ||
    !/Test timeout (?:of \d+ms )?exceeded/.test(result.errors[0]?.message ?? "")
  )
    return false;
  return (result.attachments ?? []).some((attachment) => {
    if (attachment.name !== "browser-activity" || attachment.contentType !== "text/plain")
      return false;
    try {
      const text =
        typeof attachment.body === "string"
          ? Buffer.from(attachment.body, "base64").toString("utf8")
          : readFileSync(attachment.path, "utf8");
      return /^renderer: no answer to evaluate\(\(\) => true\) in \d+ms — wedged, not slow\r?\n/.test(
        text,
      );
    } catch {
      return false;
    }
  });
}

/** Fail closed: --last-failed is safe only when every initial failed result
 * carries the probe verdict, with no global errors or unexecuted tests. */
export function canRetryWedges(report) {
  if (!Array.isArray(report?.suites) || !Array.isArray(report.errors) || report.errors.length)
    return false;
  let failures = 0;
  let valid = true;
  function visit(suites) {
    for (const suite of suites) {
      for (const spec of suite.specs ?? [])
        for (const test of spec.tests ?? []) {
          if (test.status === "expected" && test.expectedStatus === "passed") continue;
          if (
            test.status !== "unexpected" ||
            test.expectedStatus !== "passed" ||
            test.results?.length !== 1
          ) {
            valid = false;
            continue;
          }
          const result = test.results[0];
          const errors = result.errors ?? [];
          const directProof =
            errors.length > 0 &&
            errors.every(
              (error) =>
                typeof error.message === "string" &&
                /^(?:Error: )?visual: page\.screenshot did not return within \d+ms at [^\n]+ The renderer did not answer a trivial evaluate, so it is wedged, not slow/.test(
                  error.message,
                ),
            );
          if (
            !["failed", "timedOut"].includes(result.status) ||
            !(directProof || probeAttachment(result))
          )
            valid = false;
          failures++;
        }
      visit(suite.suites ?? []);
    }
  }
  try {
    visit(report.suites);
  } catch {
    return false;
  }
  return valid && failures > 0;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = canRetryWedges(JSON.parse(readFileSync(process.argv[2], "utf8"))) ? 0 : 1;
  } catch {
    process.exitCode = 1;
  }
}
