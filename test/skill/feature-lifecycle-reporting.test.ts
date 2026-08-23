import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const skillPath = resolve(process.cwd(), "skills/feature-lifecycle/SKILL.md");
const referencePath = resolve(process.cwd(), "skills/feature-lifecycle/references/feature-kanban-api.md");
const phaseTwoPath = resolve(process.cwd(), "skills/feature-lifecycle/references/phase-2-lifecycle-plan.md");
const stageFourFailurePath = resolve(
  process.cwd(),
  "skills/feature-lifecycle/references/stage-4-failure-escalation.md",
);
const stageFivePath = resolve(process.cwd(), "skills/feature-lifecycle/references/stage-5-integration.md");

function readSkillFiles(): { skill: string; reference: string } {
  return {
    skill: readFileSync(skillPath, "utf8"),
    reference: readFileSync(referencePath, "utf8"),
  };
}

function readPhaseTwo(): string {
  return readFileSync(phaseTwoPath, "utf8");
}

function readStageFive(): string {
  return readFileSync(stageFivePath, "utf8");
}

function readStageFourFailureEscalation(): string {
  return readFileSync(stageFourFailurePath, "utf8");
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
  assert.doesNotMatch(skill, /npm\s+(run\s+)?start|Start-Process|spawn\s+the\s+service/i);
});

test("uses the retail lifecycle structure and bundles its conditional workflows", () => {
  const { skill } = readSkillFiles();
  assert.ok(existsSync(phaseTwoPath), "missing bundled Phase 2 lifecycle workflow");
  assert.ok(existsSync(stageFivePath), "missing bundled Stage 5 integration workflow");
  const phaseTwo = readPhaseTwo();
  assert.match(skill, /## 核心约定/);
  assert.match(skill, /references\/phase-2-lifecycle-plan\.md/);
  assert.match(skill, /references\/stage-5-integration\.md/);
  assert.doesNotMatch(skill, /## 跨运行环境约定/);
  assert.match(phaseTwo, /\*\*Card ID\*\*: <uuid>/);
  assert.match(phaseTwo, /Feature Kanban 初始化/);
});

test("keeps lifecycle orchestration exclusive and applies the Stage 5 validation matrix", () => {
  const { skill } = readSkillFiles();
  const stageFive = readStageFive();

  assert.match(skill, /唯一流程编排者/);
  assert.match(skill, /### 流程型 skill 调用守卫/);
  assert.match(skill, /其他 skill 的 description.*不能覆盖本生命周期的显式规则/s);
  assert.match(skill, /rebase 无冲突.*不重新评审.*不重跑完整门禁/s);
  assert.match(skill, /rebase 发生过冲突.*追加一次完整主代理评审.*不重跑完整质量门禁/s);
  assert.match(skill, /base HEAD 或 tree ID 任一不一致.*保留 feature 分支和 worktree/s);
  assert.match(stageFive, /git merge --ff-only <feature-branch>/);
  assert.match(stageFive, /git status --short --untracked-files=all --ignored/);
});

test("owns repeated-failure escalation without invoking PUA skills", () => {
  const { skill } = readSkillFiles();
  assert.ok(existsSync(stageFourFailurePath), "missing bundled Stage 4 failure escalation workflow");
  assert.doesNotMatch(skill, /pua(?::[a-z0-9-]+)?/i);
  assert.match(skill, /references\/stage-4-failure-escalation\.md/);

  const escalation = readStageFourFailureEscalation();
  assert.match(escalation, /同一确认缺陷.*连续 2 次.*失败/s);
  assert.match(escalation, /3 个.*可证伪.*根因假设/s);
  assert.match(escalation, /本质不同.*方案/s);
  assert.match(escalation, /最多 2 次.*升级修复/s);
  assert.match(escalation, /仍失败.*未解决.*暂停/s);
});

test("creates automated tests only for explicit requirements or business-process changes", () => {
  const { skill } = readSkillFiles();
  const stageFive = readStageFive();
  const earlyDecision = skill.indexOf("首次在任何用户回复");
  const stageOne = skill.indexOf("### Stage 1：方案设计");

  assert.ok(earlyDecision >= 0 && earlyDecision < stageOne);
  assert.match(
    skill,
    /首次在任何用户回复、方案、spec 或计划.*新增\/补充测试前.*判定/s,
  );
  assert.match(
    skill,
    /运行既有 E2E、单元测试或完整质量门禁.*不构成.*新增测试/s,
  );
  assert.match(skill, /默认不新增自动化测试/);
  assert.match(
    skill,
    /用户、需求、项目指令或既有质量门禁明确要求.*业务流程变化/s,
  );
  assert.match(
    skill,
    /入口条件.*业务分支.*状态迁移.*事务.*回滚.*补偿.*权限门控.*外部副作用顺序/s,
  );
  assert.match(
    skill,
    /金额、库存、税费.*未改变上述流程.*不得新增测试/s,
  );
  assert.match(
    skill,
    /任一触发条件成立.*必须.*既有测试.*覆盖.*不足.*新增.*最小行为测试/s,
  );
  assert.match(skill, /专项验证.*不(?:等于|授权).*新增测试/s);
  assert.match(skill, /Stage 3[\s\S]*默认.*无需新增自动化测试/);
  assert.match(
    skill,
    /Stage 4[\s\S]*逐项核对.*测试文件.*测试用例.*运行结果/s,
  );
  assert.match(skill, /缺少.*必需测试.*确认缺陷/s);
  assert.match(stageFive, /受影响编译、既有专项测试或静态检查/);
  assert.match(stageFive, /不得据此新增测试/);
  assert.match(
    stageFive,
    /冲突本身.*不构成测试触发.*冲突解决.*业务流程变化.*必需测试/s,
  );
  assert.doesNotMatch(
    skill,
    /核心不变量、权限、金额\/状态流转、幂等、并发、事务、数据完整性、失败恢复补最小行为测试/,
  );
  assert.doesNotMatch(skill, /CSS 宽度|提示持续时间|URL 默认参数规范化/);
});

test("keeps discovery inferential and places the full gate after focused Stage 4 review", () => {
  const { skill } = readSkillFiles();
  const stageFive = readStageFive();
  const stageFour = skill.slice(
    skill.indexOf("### Stage 4：编码、评审与修复"),
    skill.indexOf("### Stage 5：固化、整合与清理"),
  );

  assert.match(skill, /可从用户输入、仓库、项目文档或既有约定可靠推断.*不得询问/s);
  assert.match(skill, /同一决策.*输入或约束未实质变化.*不得重复确认/s);
  assert.match(stageFour, /开发与评审期间.*只运行.*专项测试/s);
  assert.match(stageFour, /一轮.*完整范围.*No findings[\s\S]*一次定向复核/s);
  assert.match(stageFour, /发现问题.*一次同范围定向确认.*不回到全量评审/s);
  assert.doesNotMatch(skill + stageFive, /两轮干净评审|两轮连续零问题|第二角度干净后计数 2/);

  const focusedReview = stageFour.indexOf("一次定向复核");
  const fullGate = stageFour.indexOf("完整质量门禁", focusedReview);
  assert.ok(focusedReview >= 0 && fullGate > focusedReview);
  assert.match(stageFour, /质量门禁.*最多两轮.*定向修复.*同范围复核/s);
  assert.match(stageFour, /两轮后仍失败.*暂停/s);
  assert.doesNotMatch(stageFive, /直接执行 Stage 3.*完整质量门禁/s);
  assert.match(stageFive, /确认 Stage 4 完整质量门禁.*已通过/s);
  assert.match(stageFive, /Stage 5 自身不得运行/);
  assert.doesNotMatch(
    stageFive,
    /(?:直接|再次|重新|仍在此位置)(?:执行|运行|重跑)[^。\n]*完整质量门禁/s,
  );
  assert.match(skill, /命令输出.*成功.*摘要.*失败.*失败段/s);
});

test("persists card/session IDs before POST without response-dependent branching", () => {
  const { reference } = readSkillFiles();
  const phaseTwo = readPhaseTwo();
  const persistIndex = phaseTwo.indexOf("在任何网络调用前");
  const postIndex = phaseTwo.indexOf("POST /api/cards");
  assert.ok(persistIndex >= 0 && postIndex > persistIndex);
  assert.match(reference, /same `cardId`.*idempotent.*does not overwrite/is);
  assert.doesNotMatch(reference, /Stop reporting.*(?:response|conflict|error)/is);
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

test("omits unavailable external session IDs and supplements the same session later", () => {
  const { reference } = readSkillFiles();
  const phaseTwo = readPhaseTwo();
  const create = exampleJson(reference, "create-payload");
  const patch = exampleJson(reference, "patch-payload");
  const createSession = create.session as Record<string, unknown>;
  const patchSession = patch.session as Record<string, unknown>;

  assert.equal(Object.hasOwn(createSession, "externalSessionId"), false);
  assert.equal(patchSession.sessionRecordId, createSession.sessionRecordId);
  assert.equal(typeof patchSession.externalSessionId, "string");
  assert.match(phaseTwo, /session.*省略 `externalSessionId`.*`null`.*空字符串.*`unavailable`/is);
  assert.match(reference, /omit `externalSessionId`.*`null`.*empty string.*`unavailable`/is);
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

test("reports every lifecycle transition without depending on API responses", () => {
  const { skill, reference } = readSkillFiles();
  const phaseTwo = readPhaseTwo();
  const completeWorkflow = skill + phaseTwo + reference;

  assert.match(phaseTwo, /POST.*无论.*结果.*后续.*PATCH/is);
  assert.match(skill, /每次阶段或状态变化.*完整.*PATCH/is);
  assert.match(skill, /质量门禁.*不能替代.*看板上报/is);
  assert.match(completeWorkflow, /不解析.*服务端.*响应/is);
  assert.match(completeWorkflow, /失败.*不记录.*不阻塞/is);
  assert.doesNotMatch(completeWorkflow, /失败.*(?:写入|更新).*看板同步/is);
  assert.doesNotMatch(completeWorkflow, /optional (?:local )?projection/i);
});

test("preserves the upstream lifecycle stages while adding board reporting", () => {
  const { skill } = readSkillFiles();
  for (const contract of [
    "### Stage 1：方案设计",
    "### Stage 2：需求评审",
    "### Stage 3：制定实现计划",
    "### Stage 4：编码、评审与修复",
    "### Stage 5：固化、整合与清理",
    "## Feature Kanban 上报协议",
  ]) assert.match(skill, new RegExp(contract));
  assert.match(skill, /(不得|禁止).*启动.*服务/);
});

test("automatically archives the completed snapshot without a second endpoint and uses 500ms calls", () => {
  const { skill, reference } = readSkillFiles();
  const phaseTwo = readPhaseTwo();
  const stageFive = readStageFive();
  const completeWorkflow = skill + phaseTwo + reference + stageFive;
  const completedSnapshot = stageFive.indexOf("`completed` / `integrated`");
  const deleteBranch = stageFive.indexOf("git branch -d <feature-branch>");

  assert.ok(completedSnapshot >= 0 && deleteBranch > completedSnapshot);
  assert.match(skill, /`completed` \/ `integrated`.*自动归档/is);
  assert.match(stageFive, /完整快照.*同一事务内自动归档.*不存在第二个归档调用/is);
  assert.match(reference, /completed.*integrated.*archives the card in the same transaction/is);
  assert.doesNotMatch(completeWorkflow, /\/api\/cards\/\{cardId\}\/archive/);
  assert.match(skill, /精确 500ms 超时/);
  assert.match(phaseTwo, /精确 500ms 超时/);
  assert.match(reference, /Add-Type -AssemblyName System\.Net\.Http/);
  assert.match(reference, /FromMilliseconds\(500\)/);
  assert.doesNotMatch(reference, /TimeoutSec/);
});
