/**
 * readiness-labels — readiness check names / artifact kinds → Chinese labels,
 * plus optional detail humanizers.
 */

export const READINESS_CHECK_LABELS: Record<string, string> = {
	terminal_current_work: "无活动工作",
	no_gate: "门禁清空",
	complete_required_artifacts: "产物完整",
	no_unpublished_effects: "无暂存副作用",
	evidence_coverage: "证据覆盖",
	disposed_decisions: "决策已处置",
	disposed_findings: "发现已处置",
	current_critic_coverage: "评审覆盖",
	no_consistency_error: "一致性正常",
	buildable_approval_packet: "可构建审批包",
};

const TERMINAL_WORK_DETAIL_LABELS: Record<string, string> = {
	activeClaims: "活动声明",
	activeAttempts: "活动尝试",
	activeRuns: "活动运行",
	nonTerminalTasks: "未终结任务",
};

function humanizeTerminalCurrentWorkDetail(detail: string): string {
	const parts: string[] = [];
	for (const segment of detail.split(/\s+/)) {
		const eqIndex = segment.indexOf("=");
		if (eqIndex === -1) continue;
		const key = segment.slice(0, eqIndex);
		const value = segment.slice(eqIndex + 1);
		const label = TERMINAL_WORK_DETAIL_LABELS[key];
		if (label === undefined) continue;
		parts.push(`${value} 个${label}`);
	}
	return parts.join(" · ");
}

export const READINESS_CHECK_DETAILS: Record<string, (detail: string) => string> = {
	terminal_current_work: humanizeTerminalCurrentWorkDetail,
};


export function readinessCheckLabel(name: string): string {
	return READINESS_CHECK_LABELS[name] ?? name;
}

export function readinessCheckDetail(name: string, detail: string): string {
	return READINESS_CHECK_DETAILS[name]?.(detail) ?? detail;
}
