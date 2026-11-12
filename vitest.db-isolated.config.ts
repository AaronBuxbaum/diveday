import config from "./vitest.config";

// Controlled #4416 baseline: identical files, project names, shard weights,
// fixtures, coverage and deadlines; only the candidate project's isolation changes.
export default {
  ...config,
  test: {
    ...config.test,
    projects: config.test?.projects?.map((project) => {
      if (typeof project === "string" || !("test" in project)) return project;
      return project.test?.name === "dbShared"
        ? { ...project, test: { ...project.test, isolate: true } }
        : project;
    }),
  },
};
