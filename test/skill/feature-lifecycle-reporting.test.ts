import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const skillPath = resolve(process.cwd(), "skills/feature-lifecycle/SKILL.md");
const referencePath = resolve(process.cwd(), "skills/feature-lifecycle/references/feature-kanban-api.md");
const phaseTwoPath = resolve(process.cwd(), "skills/feature-lifecycle/references/phase-2-lifecycle-plan.md");

function readSkillFiles(): { skill: string; reference: string } {
  return {
    skill: readFileSync(skillPath, "utf8"),
    reference: readFileSync(referencePath, "utf8"),
  };
}

function readPhaseTwo(): string {
  return readFileSync(phaseTwoPath, "utf8");
}

function exampleJson(reference: string, marker: string): Record<string, unknown> {
  const expression = new RegExp("<!-- " + marker + " -->\\s*```json\\s*([\\s\\S]*?)```");
  const match = reference.match(expression);
  assert.ok(match?.[1], `missing ${marker} JSON example`);
  return JSON.parse(match[1]) as Record<string, unknown>;
}

test("defines a discoverable cross-tool lifecycle skill and never starts the board service", () => {
  const { skill } = readSkillFiles();
  const completeWorkflow = skill + readPhaseTwo();
  assert.match(skill, /^---\r?\nname: feature-lifecycle\r?\ndescription: .+/);
  assert.match(completeWorkflow, /Codex.*Claude|Claude.*Codex/s);
  assert.match(completeWorkflow, /原始仓库根目录|original repository root/i);
  assert.match(completeWorkflow, /basename|末级目录名/i);
  assert.match(completeWorkflow, /看板同步|Feature Kanban sync failure/i);
  assert.doesNotMatch(skill, /npm\s+(run\s+)?start|Start-Process|spawn\s+the\s+service/i);
});

test("uses the retail lifecycle structure and bundles its Phase 2 workflow", () => {
  const { skill } = readSkillFiles();
  assert.ok(existsSync(phaseTwoPath), "missing bundled Phase 2 lifecycle workflow");
  const phaseTwo = readPhaseTwo();
  assert.match(skill, /## 核心约定/);
  assert.match(skill, /references\/phase-2-lifecycle-plan\.md/);
  assert.doesNotMatch(skill, /## 跨运行环境约定/);
  assert.match(phaseTwo, /\*\*Card ID\*\*: <uuid>/);
  assert.match(phaseTwo, /Feature Kanban 初始化/);
});

test("persists card/session IDs before POST and documents idempotent retry without overwrite", () => {
  const { reference } = readSkillFiles();
  const phaseTwo = readPhaseTwo();
  const persistIndex = phaseTwo.indexOf("在任何网络调用前");
  const postIndex = phaseTwo.indexOf("POST /api/cards");
  assert.ok(persistIndex >= 0 && postIndex > persistIndex);
  assert.match(reference, /same `cardId`.*returns the existing card.*does not overwrite/is);
  assert.match(reference, /`409`.*identity conflict/is);
});

test("documents full create/PATCH snapshots and all eight stage mappings", () => {
  const { reference } = readSkillFiles();
  const create = exampleJson(reference, "create-payload");
  const patch = exampleJson(reference, "patch-payload");
  for (const key of ["stage", "progress", "waitingForUser", "blocked", "aiTool", "branch", "session"]) {
    assert.ok(key in create, `create payload missing ${key}`);
    assert.ok(key in patch, `patch payload missing ${key}`);
  }
  for (const key of ["cardId", "projectName", "title", "lifecycleDocumentPath"]) {
    assert.ok(key in create, `create payload missing ${key}`);
    assert.ok(!(key in patch), `PATCH must not redefine immutable ${key}`);
  }
  assert.equal(create.projectPath, "C:\\code\\feature-kanban");
  assert.equal(patch.specDocumentPath,
    "C:\\code\\feature-kanban\\.worktrees\\feature-lifecycle-kanban\\docs\\superpowers\\specs\\2026-08-12-feature-lifecycle-kanban-design.md");
  assert.equal((patch.progress as Record<string, unknown>).implementationSummary, "前端交互");
  assert.equal(create.title, "feature-lifecycle-kanban");
  for (const stage of [
    "initializing", "designing", "requirements_review", "implementation_planning",
    "implementing_and_reviewing", "finalizing_branch", "awaiting_integration", "completed",
  ]) assert.match(reference, new RegExp("`" + stage + "`"));
});

test("requires the original project path, produced Stage 1 spec, and a semantic short batch summary", () => {
  const { skill, reference } = readSkillFiles();
  const phaseTwo = readPhaseTwo();
  assert.match(phaseTwo, /项目完整路径.*原始仓库根目录.*absolute path/is);
  assert.match(phaseTwo, /projectPath.*必须上传.*原始仓库根目录.*不得上传 linked worktree/is);
  assert.match(skill + reference, /specDocumentPath.*Stage 1.*Markdown spec/is);
  assert.match(skill + reference, /specDocumentPath.*生命周期文档.*实现计划.*外部需求文档/is);
  assert.match(skill, /每个 Stage 4 完整快照都必须发送 `implementationSummary`.*不超过 10 个 Unicode 字符.*禁止只写“批次1”/is);
  assert.match(reference, /completed.*rewrite.*original repository root/is);
});

test("reports the feature slug as the card title without the date prefix", () => {
  assert.match(readPhaseTwo(), /title.*<feature-slug>.*(去掉|不含).*日期/is);
});

test("records API failure locally and continues the lifecycle without trying to recover the service", () => {
  const { reference } = readSkillFiles();
  assert.match(readPhaseTwo(), /请求失败.*看板同步.*继续 Stage 1/is);
  assert.match(reference, /connection failure.*do not retry in a loop.*do not start the service/is);
});

test("preserves the upstream lifecycle stages while adding board reporting", () => {
  const { skill } = readSkillFiles();
  for (const contract of [
    "### Stage 1：方案设计",
    "### Stage 2：需求评审",
    "### Stage 3：制定实现计划",
    "### Stage 4：编码、评审与修复",
    "### Stage 5：Squash 并 rebase",
    "## Feature Kanban 上报协议",
  ]) assert.match(skill, new RegExp(contract));
  assert.match(skill, /(不得|禁止).*启动.*服务/);
});

test("archives a completed card only after the development branch is deleted", () => {
  const { skill, reference } = readSkillFiles();
  const deleteBranch = skill.lastIndexOf("git branch -d <feature-branch>");
  const archiveCard = skill.lastIndexOf("PATCH /api/cards/{cardId}/archive");
  assert.ok(deleteBranch >= 0 && archiveCard > deleteBranch);
  assert.match(skill, /归档失败.*不影响.*completed/s);
  assert.match(reference, /PATCH.*\/api\/cards\/\{cardId\}\/archive.*\{\s*"archived"\s*:\s*true\s*\}/s);
});
