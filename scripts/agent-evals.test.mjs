import { describe, expect, it } from "vitest";

import { grade, loadTasks, observe, report, validateTasks } from "./agent-evals.mjs";

const line = (...blocks) => JSON.stringify({ type: "assistant", message: { content: blocks } });
const skill = (name) => ({ type: "tool_use", name: "Skill", input: { skill: name } });
const agent = (type) => ({ type: "tool_use", name: "Agent", input: { subagent_type: type } });

describe("the golden task file", () => {
  const tasks = loadTasks();

  it("holds about ten tasks, each with a prompt, a source and an expectation", () => {
    expect(tasks.length).toBeGreaterThanOrEqual(10);
    for (const task of tasks) {
      expect(task.prompt.length).toBeGreaterThan(20);
      expect(task.source.length).toBeGreaterThan(10);
    }
  });

  it("covers a reviewer, a skill and a must-not-delegate case", () => {
    expect(tasks.some((task) => task.expect.agent)).toBe(true);
    expect(tasks.some((task) => task.expect.skill)).toBe(true);
    expect(tasks.some((task) => task.expect.noSubagent)).toBe(true);
  });

  it("names only skills and reviewer agents that exist", () => {
    const skills = new Set([
      "i18n-copy",
      "brand-voice",
      "copy-restraint",
      "schema-change",
      "instant-navigation",
      "new-feature",
      "visual-triage",
      "debug",
      "adr",
    ]);
    const agents = new Set(["dive-domain-expert", "security-reviewer"]);
    expect(validateTasks(tasks, { skills, agents })).toEqual([]);
    expect(validateTasks(tasks, { skills: new Set(), agents })[0]).toMatch(/no skill/);
  });
});

describe("observe", () => {
  it("reads loaded skills and spawned subagent types, ignoring noise", () => {
    const stream = [
      "not json",
      line(skill("schema-change")),
      line({ type: "text" }, agent("dive-domain-expert")),
    ].join("\n");
    expect(observe(stream)).toMatchObject({
      skills: ["schema-change"],
      agents: ["dive-domain-expert"],
    });
  });

  it("counts a read of a skill's file through Bash or Read as loading it", () => {
    const bash = {
      type: "tool_use",
      name: "Bash",
      input: { command: "sed -n 1,80p .agents/skills/schema-change/SKILL.md" },
    };
    const read = {
      type: "tool_use",
      name: "Read",
      input: { file_path: "/x/.claude/skills/debug/SKILL.md" },
    };
    expect(observe([line(bash), line(read)].join("\n")).skills).toEqual(["schema-change", "debug"]);
  });

  it("drops a plugin prefix from a skill name", () => {
    expect(observe(line(skill("diveday:debug"))).skills).toEqual(["debug"]);
  });
});

describe("grade", () => {
  const seen = (skills = [], agents = []) => ({ skills, agents });

  it("passes when any listed skill or agent was drawn", () => {
    expect(grade({ expect: { skill: ["a", "b"] } }, seen(["b"])).pass).toBe(true);
    expect(grade({ expect: { agent: ["r"] } }, seen([], ["r"])).pass).toBe(true);
  });

  it("fails with a reason that names what happened instead", () => {
    const result = grade({ expect: { skill: ["a"] } }, seen(["z"]));
    expect(result.pass).toBe(false);
    expect(result.why).toContain("loaded [z]");
    expect(grade({ expect: { agent: ["r"] } }, seen()).why).toContain("no subagent");
  });

  it("counts a reviewer the final answer names as required, since a planning run rarely spawns one", () => {
    const task = { expect: { agent: ["dive-domain-expert"] } };
    expect(
      grade(task, { skills: [], agents: [], text: "Needs a dive-domain-expert run." }).pass,
    ).toBe(true);
    expect(grade(task, { skills: [], agents: [], text: "Run the tests." }).pass).toBe(false);
  });

  it("fails a one-file change that spawned any subagent", () => {
    expect(grade({ expect: { noSubagent: true } }, seen([], [])).pass).toBe(true);
    expect(grade({ expect: { noSubagent: true } }, seen([], ["Explore"])).pass).toBe(false);
  });
});

describe("report", () => {
  it("names the task that flipped, not just the total", () => {
    const tasks = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const text = report(tasks, {
      a: [{ pass: true }, { pass: true }],
      b: [{ pass: true }, { pass: false, why: "loaded [x]" }],
      c: [
        { pass: false, why: "w" },
        { pass: false, why: "w" },
      ],
    });
    expect(text).toContain("b | pass / FAIL | FLIPPED (loaded [x])");
    expect(text).toContain("c | FAIL / FAIL | stable fail");
    expect(text).toContain("a | pass / pass | stable");
    expect(text).toContain("3/6 runs passed; 1 task(s) flipped");
  });
});
