import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { lastAssistantText, promisesUnfinishedWork } from "./unfinished-promises.mjs";

/**
 * The guard exists because of a specific, boring failure: a session ended three
 * turns running on a sentence describing what it would do next, did none of it,
 * and the user watched silence until they asked whether it was still working.
 *
 * Its whole risk is the opposite failure — blocking a turn that was right to
 * end. So these cases are weighted toward the benign endings, and the real
 * offender is pinned verbatim.
 */
describe("promisesUnfinishedWork", () => {
  const DIRTY = true;

  it("catches the sentence that actually caused this", () => {
    expect(
      promisesUnfinishedWork(
        "The concurrency guard is green.\n\nNow the queued work: dropping `roll_call_crew_attestations`, and the wait-list mark.",
        DIRTY,
      ),
    ).toBe(true);
  });

  it.each([
    "Next I'll run the visual suite.",
    "Two streams left. Once they land, I'll drop the table.",
    "That's fixed. I'll now pick up the wait-list mark.",
    "Still to do: the seed scenario and its capture.",
  ])("catches %j", (text) => {
    expect(promisesUnfinishedWork(text, DIRTY)).toBe(true);
  });

  it.each([
    // A question hands the turn back on purpose. This is a good ending.
    ["Everything is green and pushed. Want me to open the PR?", "a question"],
    ["I've stopped here — say the word and I'll drop the table.", "an explicit handoff"],
    ["Done: the guard is fixed and four regression tests pin it.", "a plain completion"],
    // The promise describes the *user's* next step, not the session's.
    ["Merged. CI will post the visual report when it finishes.", "somebody else's next step"],
  ])("leaves %j alone (%s)", (text) => {
    expect(promisesUnfinishedWork(text, DIRTY)).toBe(false);
  });

  it("leaves a promise alone when the tree is clean", () => {
    // "Finished and pushed, here is what happens next" is the ordinary way a
    // completed piece of work ends, and it reads identically to the offender.
    // The dirty tree is what separates them.
    expect(promisesUnfinishedWork("Pushed. Next I'll watch CI.", false)).toBe(false);
  });

  it("reads only the closing paragraphs", () => {
    // A promise quoted from a subagent's report, or recounted mid-turn, is not
    // this turn ending on one — otherwise every long relay would trip it.
    const buried = `An agent reported: "Next I'll re-shoot the capture."\n\n${"Everything below is a finished summary. ".repeat(40)}`;
    expect(promisesUnfinishedWork(buried, DIRTY)).toBe(false);
  });
});

describe("lastAssistantText", () => {
  const write = (lines) => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "promises-")), "t.jsonl");
    writeFileSync(file, `${lines.join("\n")}\n`);
    return file;
  };
  const assistant = (text) =>
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } });

  it("takes the last assistant message, not the last line", () => {
    const file = write([
      assistant("earlier"),
      JSON.stringify({ type: "user", message: { content: "a reply" } }),
      assistant("closing"),
      JSON.stringify({ type: "system", content: "a hook fired" }),
    ]);
    expect(lastAssistantText(file)).toBe("closing");
  });

  it("skips a tool-only assistant turn, which has no closing message", () => {
    const file = write([
      assistant("the real closing message"),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: {} }] },
      }),
    ]);
    expect(lastAssistantText(file)).toBe("the real closing message");
  });

  it("survives a malformed line rather than throwing", () => {
    // The hook fails open, and this is the most likely reason it would need to.
    const file = write(["{not json", assistant("closing")]);
    expect(lastAssistantText(file)).toBe("closing");
  });
});
