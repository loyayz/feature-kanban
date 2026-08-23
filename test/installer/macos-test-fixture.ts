import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stageMacApp, type StagedMacApp } from "../../scripts/stage-macos-package.js";
import type { MacArchitecture } from "../../src/installer/macos-package.js";

function writeFixtureFile(path: string, contents: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

export function thinMachO(architecture: MacArchitecture): Buffer {
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(architecture === "arm64" ? 0x0100000c : 0x01000007, 4);
  return header;
}

export interface MacTestFixture {
  root: string;
  repoRoot: string;
  outputBase: string;
  architecture: MacArchitecture;
  bootstrapPath: string;
  stage(): Promise<StagedMacApp>;
  setPackagedSkill(contents: string): void;
}

export function createMacTestFixture(root: string, architecture: MacArchitecture = "arm64"): MacTestFixture {
  const repoRoot = resolve(root, "repo");
  const outputBase = resolve(root, "Applications");
  const bootstrapPath = resolve(root, "inputs", "FeatureKanbanBootstrap");
  writeFixtureFile(bootstrapPath, thinMachO(architecture));
  writeFixtureFile(resolve(repoRoot, "dist", "server", "server", "index.js"), "server");
  writeFixtureFile(resolve(repoRoot, "dist", "server", "launcher", "index.js"), "launcher");
  writeFixtureFile(resolve(repoRoot, "dist", "server", "installer", "macos-installation.js"), "installer");
  writeFixtureFile(resolve(repoRoot, "dist", "web", "browser", "index.html"), "<main>Feature Kanban</main>");
  writeFixtureFile(resolve(repoRoot, "inject", "feature-kanban.user.js"), "// injection");
  writeFixtureFile(resolve(repoRoot, "skills", "feature-lifecycle", "SKILL.md"), "packaged-v1");
  writeFixtureFile(
    resolve(repoRoot, "skills", "feature-lifecycle", "references", "feature-kanban-api.md"),
    "api reference",
  );
  writeFixtureFile(
    resolve(repoRoot, "installer", "macos", "Info.plist.template"),
    readFileSync(resolve(process.cwd(), "installer", "macos", "Info.plist.template")),
  );
  return {
    root,
    repoRoot,
    outputBase,
    architecture,
    bootstrapPath,
    stage: () => stageMacApp({
      repoRoot,
      outputBase,
      architecture,
      productVersion: "0.1.0",
      nodeVersion: "v24.15.0",
      bootstrapPath,
    }),
    setPackagedSkill: (contents) => {
      writeFixtureFile(resolve(repoRoot, "skills", "feature-lifecycle", "SKILL.md"), contents);
    },
  };
}
