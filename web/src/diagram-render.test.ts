import { describe, expect, it } from "vitest";

import {
	diagramKindFor,
	graphToMermaid,
	isGraphDiagram,
	sanitizeMermaidName,
	type GraphDiagram,
} from "./diagram-render";

describe("graphToMermaid", () => {
	const flow: GraphDiagram = {
		type: "graph",
		nodes: [
			{ id: "trigger", label: "到达有效期末日" },
			{ id: "s0", label: "扫描到期积分" },
			{ id: "s1", label: "冻结到期积分" },
			{ id: "final", label: "到期积分不可再使用" },
		],
		edges: [
			["trigger", "s0"],
			["s0", "s1"],
			["s1", "final"],
		],
	};

	it("renders scenario as a TD flowchart", () => {
		const source = graphToMermaid("scenario", flow);
		expect(source).toBe(
			[
				"flowchart TD",
				'  trigger["到达有效期末日"]',
				'  s0["扫描到期积分"]',
				'  s1["冻结到期积分"]',
				'  final["到期积分不可再使用"]',
				"  trigger --> s0",
				"  s0 --> s1",
				"  s1 --> final",
			].join("\n"),
		);
	});

	it("renders architecture as an LR flowchart with edge labels", () => {
		const architecture: GraphDiagram = {
			type: "graph",
			nodes: [
				{ id: "gw", label: "积分网关" },
				{ id: "svc", label: "积分服务" },
			],
			edges: [["gw", "svc", "HTTP 调用"]],
		};
		expect(graphToMermaid("architecture", architecture)).toBe(
			'flowchart LR\n  gw["积分网关"]\n  svc["积分服务"]\n  gw -->|HTTP 调用| svc',
		);
	});

	it("renders data as erDiagram with sanitized entity names", () => {
		const data: GraphDiagram = {
			type: "graph",
			nodes: [
				{ id: "acct", label: "会员账户" },
				{ id: "detail (可选)", label: "积分明细(可选)" },
			],
			edges: [["acct", "detail (可选)", "1 — N"]],
		};
		const source = graphToMermaid("data", data);
		expect(source).toContain("erDiagram");
		expect(source).toContain("detail_ ");
		expect(source).not.toContain("(");
		expect(source).toContain(': "1 — N"');
	});

	it("returns null for kinds without a default diagram type", () => {
		expect(graphToMermaid("analysis", flow)).toBeNull();
		expect(graphToMermaid("design", flow)).toBeNull();
		expect(graphToMermaid("requirement", flow)).toBeNull();
	});

	it("returns null for malformed diagram shapes", () => {
		expect(graphToMermaid("scenario", { type: "graph", nodes: [], edges: [] })).toBeNull();
		expect(
			graphToMermaid("scenario", {
				type: "graph",
				nodes: [{ id: "", label: "x" }],
				edges: [],
			} as GraphDiagram),
		).toBeNull();
	});
});

describe("diagramKindFor", () => {
	it("maps scenario/usecase/function/architecture to flowchart and data to erDiagram", () => {
		expect(diagramKindFor("scenario")).toBe("flowchart");
		expect(diagramKindFor("usecase")).toBe("flowchart");
		expect(diagramKindFor("function")).toBe("flowchart");
		expect(diagramKindFor("architecture")).toBe("flowchart");
		expect(diagramKindFor("data")).toBe("erDiagram");
	});

	it("returns null for kinds without a default diagram type", () => {
		expect(diagramKindFor("analysis")).toBeNull();
		expect(diagramKindFor("design")).toBeNull();
		expect(diagramKindFor("api")).toBeNull();
	});
});

describe("sanitizeMermaidName", () => {
	it("strips brackets, parens and the word 可选", () => {
		expect(sanitizeMermaidName("积分明细(可选)")).toBe("积分明细");
		expect(sanitizeMermaidName("批次（可选）")).toBe("批次");
	});

	it("collapses whitespace to underscores", () => {
		expect(sanitizeMermaidName("会员 账户")).toBe("会员_账户");
	});
});

describe("isGraphDiagram", () => {
	it("accepts a valid graph shape", () => {
		const valid: GraphDiagram = {
			type: "graph",
			nodes: [{ id: "a", label: "A" }],
			edges: [["a", "b"]],
		};
		expect(isGraphDiagram(valid)).toBe(true);
	});

	it("rejects wrong type, empty labels, malformed edges", () => {
		expect(isGraphDiagram({ type: "mermaid", source: "x" })).toBe(false);
		expect(isGraphDiagram({ type: "graph", nodes: [], edges: [] })).toBe(false);
		expect(isGraphDiagram({ type: "graph", nodes: [{ id: "a", label: "" }], edges: [] })).toBe(false);
		expect(isGraphDiagram({ type: "graph", nodes: [{ id: "a", label: "A" }], edges: [["a"]] })).toBe(false);
	});
});