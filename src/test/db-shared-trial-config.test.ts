import { expect, it } from "vitest";
import candidate from "../../vitest.config";
import baseline from "../../vitest.db-isolated.config";

it("changes only candidate database isolation in the controlled baseline", () => {
  const candidateProjects = candidate.test?.projects ?? [];
  const baselineProjects = baseline.test.projects ?? [];
  expect(baselineProjects).toHaveLength(candidateProjects.length);
  let changed = 0;
  baselineProjects.forEach((project, i) => {
    const original = candidateProjects[i];
    if (typeof project !== "string" && "test" in project && project.test?.name === "dbShared") {
      expect(project.test.isolate).toBe(true);
      expect({ ...project, test: { ...project.test, isolate: false } }).toEqual(original);
      changed++;
    } else expect(project).toBe(original);
  });
  expect(changed).toBe(1);
  expect({ ...baseline, test: { ...baseline.test, projects: candidateProjects } }).toEqual(
    candidate,
  );
});
