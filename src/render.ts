import type { Accepted, ConfirmationView } from "./confirm.ts";
import type { SkipRecord } from "./chainstate.ts";
import type { MigratePlan } from "./migrate.ts";
import type { RenamePlan } from "./rename.ts";
import type { RetiredOutcome, RetiredView } from "./retire.ts";
import type { ChainDetail, ChainSummary, ItemView } from "./status.ts";
import type { Issue } from "./types.ts";

/** 输出契约版本。只增不改：删字段或改语义必须升版本。 */
export const SCHEMA_VERSION = 1;

export interface Created {
  id: string;
  path: string;
}
export interface ErrorPayload {
  rule: string;
  message: string;
}

/** 机器可读输出：JSON.stringify，顶层由调用方带 schemaVersion。 */
export function toJson(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

/** 人读输出 = 同一份数据的渲染（与 --json 同源，不可能漂移）。 */
export function renderIssues(issues: Issue[]): string {
  if (issues.length === 0) return "校验通过：0 个问题\n";
  const count = (level: Issue["level"]) =>
    issues.filter((issue) => issue.level === level).length;
  const lines = [
    `校验：${issues.length} 个问题（ERROR ${count("ERROR")} / WARNING ${count("WARNING")} / INFO ${count("INFO")}）`,
  ];
  for (const issue of issues) {
    lines.push(`  ${issue.level} ${issue.rule} ${issue.path} — ${issue.message}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderCreated(created: Created): string {
  return `已创建 ${created.path}（${created.id}）\n`;
}

export function renderAccepted(accepted: Accepted): string {
  // 与 --json 同源：IR 是「已确认」，其余层是「已复核」（对上游）。
  if (accepted.kind === "reviewed") {
    const upstreams = Object.keys(accepted.reviewed).sort();
    return `已复核 ${accepted.id}：${accepted.by} @ ${accepted.at}（上游：${upstreams.join("、")}）\n`;
  }
  return `已确认 ${accepted.id}：${accepted.by} @ ${accepted.at}\n`;
}

/** 确认状态的人读渲染（与 --json 的 state/by/at 同源）。 */
function renderConfirmation(confirmation: ConfirmationView): string {
  if (confirmation.state === "confirmed") {
    return `已确认（${confirmation.by} @ ${confirmation.at}）`;
  }
  if (confirmation.state === "stale") {
    return `已失效（${confirmation.by} @ ${confirmation.at} 确认后实质内容已改）`;
  }
  return "未确认";
}

/** 退役状态的人读渲染（与 --json 同源；撤销后是「回到未退役」）。 */
function renderRetiredState(retired: RetiredView): string {
  if (retired.state === "active") return `已撤销退役 ${retired.id}（条目回到未退役）`;
  const replacement =
    retired.supersededBy === null ? "" : `；取代者：${retired.supersededBy}`;
  return `已退役 ${retired.id}：${retired.by} @ ${retired.at}（理由：${retired.why}${replacement}）`;
}

/** 撤销一个本来就没退役的条目是幂等的：别报一件没发生过的动作（#194）。 */
export function renderRetired(outcome: RetiredOutcome): string {
  const { retired, changed } = outcome;
  if (retired.state === "active" && !changed) {
    return `${retired.id} 未退役：本来就没有退役记录\n`;
  }
  return `${renderRetiredState(retired)}\n`;
}

/** 链总览：在做（还有要推进的）排在已了结（退役）的前面，#194。 */
export function renderChains(chains: ChainSummary[]): string {
  if (chains.length === 0) return "没有链。\n";
  const live = chains.filter((chain) => !chain.concluded);
  const done = chains.filter((chain) => chain.concluded);
  const lines = [
    done.length === 0
      ? `链：${chains.length} 条`
      : `链：${chains.length} 条（在做 ${live.length} / 已了结 ${done.length}）`,
  ];
  for (const chain of [...live, ...done]) {
    lines.push(
      `  ${chain.id}  ${chain.title}  ${chain.items} 个条目  覆盖 ${chain.coverage.covered}/${chain.coverage.total}  陈旧 直接 ${chain.stale.direct} / 传递 ${chain.stale.transitive}${chain.concluded ? "  已了结" : ""}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

const GATE_LABEL: Record<string, string> = {
  "ir-entry": "IR 录入",
  "sr-ar": "SR→AR 分配",
  "function-split": "功能拆分",
};

/** 门禁的人读渲染：kind（auto/signed）、阻塞还是提醒、判据原文、签字人与两项清单。 */
function renderGates(gates: ChainDetail["gates"]): string[] {
  const lines = ["门禁："];
  for (const gate of gates) {
    const label = GATE_LABEL[gate.gate] ?? gate.gate;
    const kind = gate.kind === "auto" ? "自动" : "需签字";
    const role = gate.blocking ? "阻塞" : "提醒";
    const signer =
      gate.by !== null && gate.at !== null ? ` — ${gate.by} @ ${gate.at} 签字` : "";
    const state = gate.state === "passed" ? "已通过" : "未过";
    lines.push(`  ${label} [${kind}·${role}] ${state}${signer}`);
    lines.push(`    判据：${gate.criterion}`);
    for (const check of gate.checks ?? []) {
      lines.push(`    ${check.passed ? "✓" : "✗"} ${check.check}`);
    }
    // B2：签字记录里的判据与当前判据不一致时原样亮出（签字人对照着重签）
    if (
      gate.signedCriterion !== undefined &&
      gate.signedCriterion !== null &&
      gate.signedCriterion !== gate.criterion
    ) {
      lines.push(`    签字判据：${gate.signedCriterion}`);
    }
    if (gate.missing !== undefined && gate.missing.length > 0) {
      lines.push(`    缺：${gate.missing.join("；")}`);
    }
    const pending = gate.pending;
    if (pending !== undefined) {
      const unrealized = pending.unrealizedUsecases.map((u) => u.id).join("、");
      if (unrealized !== "") lines.push(`    未覆盖的用例：${unrealized}`);
      const stale = pending.unreviewedStale
        .map((s) => `${s.id}（上游 ${s.upstreams.join("、")}）`)
        .join("、");
      if (stale !== "") lines.push(`    未复核的陈旧：${stale}`);
    }
  }
  return lines;
}

export function renderChain(chain: ChainDetail): string {
  const root = chain.items.find((item) => item.id === chain.id);
  const concluded =
    (root !== undefined && root.retired !== null) ||
    (chain.items.length > 0 && chain.items.every((item) => item.retired !== null));
  const lines = [`链 ${chain.id}：${chain.items.length} 个条目${concluded ? "（已了结）" : ""}`];
  for (const item of chain.items) {
    lines.push(
      `  ${item.id} [${item.layer}] ${item.title}${item.retired === null ? "" : "（已退役）"}`,
    );
  }
  // #182 共享标注：认领多条 SR 的条目同属多条链，标出来才不会被误读成重复计数
  for (const share of chain.shared) {
    lines.push(`  与链 ${share.chain} 共享 ${share.count} 条条目`);
  }
  lines.push("阶段：");
  for (const stage of chain.stages) {
    const own =
      stage.skipped === null
        ? "未跳过"
        : `已跳过 — ${stage.skipped.by} @ ${stage.skipped.at}：${stage.skipped.why}`;
    if (stage.subStages !== undefined) {
      const sub = (record: SkipRecord | null): string =>
        record === null
          ? "未跳过"
          : `已跳过 — ${record.by} @ ${record.at}：${record.why}`;
      lines.push(
        `  ${stage.stage}: ${own}（items ${sub(stage.subStages.items)} / points ${sub(stage.subStages.points)}）`,
      );
    } else {
      lines.push(`  ${stage.stage}: ${own}`);
    }
  }
  for (const coverage of chain.coverage) {
    lines.push(`  ${coverage.id} ${coverage.covered}/${coverage.total} 已覆盖`);
  }
  lines.push(renderChainStale(chain.stale));
  lines.push(...renderGates(chain.gates));
  return `${lines.join("\n")}\n`;
}

/** 链级陈旧汇总：「直接下游 N 条待复核（…）；另有 M 条下游受影响」。 */
function renderChainStale(stale: ChainDetail["stale"]): string {
  if (stale.direct.length === 0 && stale.transitive === 0) return "  陈旧：无";
  const parts: string[] = [];
  if (stale.direct.length > 0) {
    parts.push(`直接下游 ${stale.direct.length} 条待复核（${stale.direct.join("、")}）`);
  }
  if (stale.transitive > 0) {
    parts.push(`另有 ${stale.transitive} 条下游受影响`);
  }
  return `  陈旧：${parts.join("；")}`;
}

export function renderItem(item: ItemView): string {
  const lines = [
    `条目 ${item.id}（${item.layer}）`,
    `  title: ${item.title}`,
    `  path: ${item.path}`,
    `  parent: ${item.parent ?? "—"}`,
    `  chain: ${item.chain ?? "—"}`,
    `  confirmation: ${renderConfirmation(item.confirmation)}`,
    `  statement: ${item.statement}`,
  ];
  if (item.retired !== null) {
    const replacement =
      item.retired.supersededBy === null ? "" : `；取代者：${item.retired.supersededBy}`;
    lines.push(
      `  retired: ${item.retired.by} @ ${item.retired.at}（理由：${item.retired.why}${replacement}）`,
    );
  }
  const clues = Object.keys(item.acceptance);
  if (clues.length > 0) {
    lines.push("  acceptance:");
    for (const clue of clues) {
      lines.push(`    ${clue}: ${item.acceptance[clue] ?? ""}`);
    }
  }
  if (item.clueCoverage !== undefined && item.clueCoverage.length > 0) {
    lines.push("  线索覆盖（被哪些 SR 覆盖）：");
    for (const clue of item.clueCoverage) {
      const by =
        clue.coveredBy.length > 0
          ? `被 ${clue.coveredBy.join("、")} 覆盖`
          : "未覆盖";
      lines.push(`    ${clue.clueId}: ${clue.text} — ${by}`);
    }
  }
  if (item.catalogs !== undefined && item.catalogs.length > 0) {
    const sources = item.catalogs
      .map((source) => `${source.scenario} → ${source.catalog}`)
      .join("、");
    lines.push(`  继承自场景目录：${sources}`);
  }
  if (item.realizedBy !== undefined && item.realizedBy.length > 0) {
    lines.push(`  realizedBy: ${item.realizedBy.join("、")}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderError(error: ErrorPayload): string {
  return `错误 [${error.rule}]：${error.message}\n`;
}

/** rename 的人读渲染：文件 + 行 + 旧值 → 新值；dry-run 额外给「建议先提交」。 */
export function renderRename(plan: RenamePlan, options: { write: boolean }): string {
  if (plan.changes.length === 0) {
    return `0 处引用（${plan.field}: ${plan.old}）\n`;
  }
  const verb = options.write ? "已改写" : "发现";
  const lines = [
    `${verb} ${plan.changes.length} 处引用（${plan.field}: ${plan.old} → ${plan.new}）：`,
  ];
  for (const change of plan.changes) {
    lines.push(
      `  ${change.path}:${change.line}: ${change.field}: ${change.old} → ${change.new}`,
    );
  }
  if (!options.write) {
    lines.push("未写盘（dry-run）。建议先提交，确认无误后加 --write 落盘。");
  }
  return `${lines.join("\n")}\n`;
}

/** migrate 的人读渲染：文件 + 行 + 旧值 → 新值；拿不准的点名；dry-run 额外给「建议先提交」。 */
export function renderMigrate(plan: MigratePlan, options: { write: boolean }): string {
  if (plan.changes.length === 0 && plan.skipped.length === 0) {
    return "0 处改动（仓库已是新形状）\n";
  }
  const verb = options.write ? "已改写" : "发现";
  const lines: string[] = [];
  if (plan.changes.length > 0) {
    lines.push(`${verb} ${plan.changes.length} 处改动（旧模型 → 新形状）：`);
    for (const change of plan.changes) {
      lines.push(`  ${change.path}:${change.line}: ${change.from} → ${change.to}`);
    }
  } else {
    lines.push("0 处改动");
  }
  if (plan.skipped.length > 0) {
    lines.push(`跳过 ${plan.skipped.length} 处（拿不准，未改；剩余问题 validate 会报）：`);
    for (const skip of plan.skipped) {
      lines.push(`  ${skip.path}${skip.line === null ? "" : `:${skip.line}`}: ${skip.reason}`);
    }
  }
  if (!options.write && plan.changes.length > 0) {
    lines.push("未写盘（dry-run）。建议先提交，确认无误后加 --write 落盘。");
  }
  return `${lines.join("\n")}\n`;
}
