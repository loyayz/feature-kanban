import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from "@angular/core";
import type { CardSummary, LifecycleProgress } from "../../../../src/shared/lifecycle-contract";

const stepLabels: Record<string, string> = {
  creating_worktree: "正在创建 worktree",
  creating_lifecycle_document: "正在建立生命周期文档",
  ready: "初始化就绪",
  clarifying: "正在澄清需求",
  comparing_approaches: "正在比较方案",
  writing_spec: "正在编写设计规格",
  reviewing: "正在评审",
  updating_spec: "正在更新设计规格",
  planning: "正在编写实现计划",
  coding: "正在编码",
  validating: "正在验证",
  fixing: "正在修正",
  quality_gate: "完整质量门禁",
  squashing: "正在整理提交",
  rebasing: "正在变基",
  verifying_final_state: "正在验证最终状态",
  waiting_for_user: "等待整合确认",
  integration_declined: "暂不整合",
  integrated: "已整合",
  complete: "本阶段已完成",
};

@Component({
  selector: "fk-lifecycle-card",
  standalone: true,
  templateUrl: "./lifecycle-card.component.html",
  styleUrl: "./lifecycle-card.component.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { "[attr.data-card-id]": "card.id" },
})
export class LifecycleCardComponent {
  @Input({ required: true }) card!: CardSummary;
  @Output() readonly openCard = new EventEmitter<string>();

  progressLabel(progress: LifecycleProgress): string {
    const base = stepLabels[progress.step] ?? progress.step.replaceAll("_", " ");
    if (progress.stage !== "implementing_and_reviewing") return base;
    const context = [
      progress.implementationSummary ?? "",
      progress.implementationBatch ? `批次 ${progress.implementationBatch}` : "",
      progress.reviewRound ? `评审 ${progress.reviewRound}` : "",
      progress.consecutiveCleanReviews ? `连续干净 ${progress.consecutiveCleanReviews}` : "",
    ].filter(Boolean);
    return context.length ? `${base} · ${context.join(" / ")}` : base;
  }

  relativeTime(value: string): string {
    const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
    if (elapsed < 60_000) return "刚刚同步";
    if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
    if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
    return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(value));
  }
}
