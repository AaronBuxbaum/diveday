import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

function directWedge(error) {
  return (
    typeof error?.message === "string" &&
    /^(?:Error: )?(?:visual: page\.screenshot did not return within \d+ms at [^\n]+ The renderer did not answer a trivial evaluate, so it is wedged, not slow|visual: [^\n]+ did not return within \d+ms at [^\n]+ — the shot may contain an unpainted band; check the diff for a blank stripe\. The renderer did not answer a trivial evaluate within \d+ms, so it is wedged, not slow\.)/.test(
      error.message,
    )
  );
}

function testDeadline(error) {
  if (typeof error?.message !== "string") return false;
  // Playwright colors its deadline message in JSON reports; no other text or
  // assertion that merely quotes a deadline is an accepted companion error.
  const plain = stripVTControlCharacters(error.message);
  return /^Test timeout (?:of \d+ms )?exceeded\.?$/.test(plain);
}

function probeAttachment(result) {
  if (result.status !== "timedOut") return false;
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
 * carries the probe verdict, with no global errors or unexpectedly unexecuted tests. */
export function canRetryWedges(report) {
  if (!Array.isArray(report?.suites) || !Array.isArray(report.errors) || report.errors.length)
    return false;
  let failures = 0;
  let valid = true;
  function visit(suites) {
    for (const suite of suites) {
      for (const spec of suite.specs ?? [])
        for (const test of spec.tests ?? []) {
          const onlyResult = test.results?.length === 1 ? test.results[0] : null;
          if (
            onlyResult &&
            !onlyResult.errors?.length &&
            ((test.status === "expected" &&
              test.expectedStatus === "passed" &&
              onlyResult.status === "passed") ||
              (test.status === "skipped" &&
                test.expectedStatus === "skipped" &&
                onlyResult.status === "skipped"))
          )
            continue;
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
          const recognizedErrors =
            errors.length > 0 &&
            errors.every(
              (error) =>
                directWedge(error) || (result.status === "timedOut" && testDeadline(error)),
            );
          const independentProof = errors.some(directWedge) || probeAttachment(result);
          if (
            !["failed", "timedOut"].includes(result.status) ||
            !recognizedErrors ||
            !independentProof
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
