import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories = [];

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "diveday-infra-cdk-"));
  directories.push(directory);
  const bin = join(directory, "bin");
  const cdkDirectory = join(directory, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(cdkDirectory, { recursive: true });
  writeFileSync(
    join(bin, "aws"),
    `#!/bin/sh
if [ "$1" = "sts" ]; then printf '%s' '{"Account":"123456789012"}'; fi
`,
  );
  writeFileSync(join(cdkDirectory, "cdk"), "#!/bin/sh\nprintf '%s' \"$AWS_PROFILE:$*\" > \"$DIVEDAY_CDK_LOG\"\n");
  chmodSync(join(bin, "aws"), 0o755);
  chmodSync(join(cdkDirectory, "cdk"), 0o755);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe("infra-cdk", () => {
  it("verifies the selected administrator session before running the first synth", () => {
    const directory = fixture();
    const result = spawnSync(process.execPath, [join(process.cwd(), "scripts", "infra-cdk.mjs"), "synth"], {
      cwd: directory,
      env: {
        ...process.env,
        AWS_PROFILE: "diveday-admin",
        DIVEDAY_CDK_LOG: join(directory, "cdk.log"),
        PATH: `${join(directory, "bin")}:${process.env.PATH}`,
      },
    });

    expect(result.status).toBe(0);
    expect(readFileSync(join(directory, "cdk.log"), "utf8")).toBe("diveday-admin:synth");
  });
});
