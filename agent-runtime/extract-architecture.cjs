#!/usr/bin/env node
/**
 * extract-architecture.cjs — 从 GitNexus 索引(LadybugDB `<repo>/.gitnexus/lbug`)
 * 提取仓库级架构证据,供 gateway generateEvidence 注入 evidence/<repoId>.json。
 *
 * 图 schema(实测):
 *   节点:Function / Method / Struct / Interface / File / Folder / Community /
 *        Section / Property / Process / Const / Variable
 *   边:  统一 CodeRelation 标签,类型在 r.type ∈ {CALLS, ACCESSES, DEFINES,
 *        CONTAINS, IMPORTS, MEMBER_OF, STEP_IN_PROCESS, HAS_METHOD, HAS_PROPERTY,
 *        IMPLEMENTS, EXTENDS}
 *   聚类:Community 节点(label/cohesion/symbolCount) + 符号经 MEMBER_OF 归属
 *
 * 产物形态对齐 web/src/baize-dashboard.ts 的 Evidence 接口:
 *   architecture.hotspots[{name, qualified_name, fan_in}]
 *   architecture.boundaries[{from, to, call_count}]
 *   architecture.clusters[{label, members, cohesion, top_nodes[]}]
 * 输出:整个 architecture 对象(含统计)以 JSON 写 stdout;失败写 stderr + exit 0(空)。
 *
 * LadybugDB = KuzuDB,Node API:{ Database, Connection }。
 * getAll() 是 async —— 必须 await(否则拿到 Promise → {})。
 */
"use strict";

const { existsSync } = require("fs");

/** 解析 @ladybugdb/core:本地 → gitnexus 全局 node_modules → 兜底 */
function loadLadybug() {
	for (const spec of [
		"@ladybugdb/core",
		"/usr/local/lib/node_modules/gitnexus/node_modules/@ladybugdb/core",
		`${process.env.HOME ?? ""}/.npm-global/lib/node_modules/gitnexus/node_modules/@ladybugdb/core`,
	]) {
		try {
			return require(spec); // eslint-disable-line @typescript-eslint/no-require-imports
		} catch {
			/* 下一个候选 */
		}
	}
	throw new Error("@ladybugdb/core not found (需 gitnexus 已安装)");
}

async function main() {
	const repoPath = process.argv[2] ?? "";
	const dbPath = `${repoPath}/.gitnexus/lbug`.replace(/\/$/, "");
	if (!repoPath || !existsSync(dbPath)) {
		throw new Error(`lbug 未找到:${dbPath}(先 gitnexus analyze)`);
	}

	const { Database, Connection } = loadLadybug();
	// readOnly = 第 4 参;bufferManagerSize=0 用默认。
	const db = new Database(dbPath, 0, true, true);
	const conn = new Connection(db);

	/** 跑一条 Cypher,失败返回 fallback(容错:不因单查询挂掉整体) */
	async function cypher(q, fallback = []) {
		try {
			const res = await conn.query(q);
			return await res.getAll();
		} catch {
			return fallback;
		}
	}

	const [nodes, edges] = await Promise.all([
		cypher("MATCH (n) RETURN count(n) AS c", [{ c: 0 }]),
		cypher("MATCH ()-[r]->() RETURN count(r) AS c", [{ c: 0 }]),
	]);
	const nodeLabels = await cypher(
		"MATCH (n) RETURN labels(n) AS label, count(n) AS count ORDER BY count DESC",
	);
	const edgeTypes = await cypher(
		"MATCH ()-[r:CodeRelation]->() RETURN r.type AS type, count(r) AS count ORDER BY count DESC",
	);

	// hotspots:fan_in 最高的函数(排除 test,聚焦生产代码)
	const hotspotRows = await cypher(
		`MATCH (f:Function)<-[r:CodeRelation]-()
		 WHERE r.type="CALLS" AND NOT f.filePath STARTS WITH "test"
		 RETURN f.name AS name, f.filePath AS file, count(r) AS fan_in
		 ORDER BY fan_in DESC LIMIT 10`,
	);
	const hotspots = hotspotRows.map((r) => ({
		name: r.name,
		qualified_name: `${r.file}:${r.name}`,
		fan_in: Number(r.fan_in),
	}));

	// boundaries:顶层目录间调用计数(耦合面)
	const boundaryRows = await cypher(
		`MATCH (cf:Function)-[r:CodeRelation]->(df:Function)
		 WHERE r.type="CALLS"
		 WITH string_split(cf.filePath,"/")[1] AS src,
		      string_split(df.filePath,"/")[1] AS dst,
		      count(r) AS cnt
		 WHERE src<>dst
		 RETURN src,dst,cnt ORDER BY cnt DESC LIMIT 10`,
	);
	const boundaries = boundaryRows.map((r) => ({
		from: r.src,
		to: r.dst,
		call_count: Number(r.cnt),
	}));

	// clusters:Community 聚类(Leiden 预计算)+ 代表节点
	const clusterRows = await cypher(
		`MATCH (s:Function)-[r:CodeRelation]->(c:Community)
		 WHERE r.type="MEMBER_OF"
		 WITH c, collect(s.name)[0..5] AS top
		 RETURN c.label AS label, c.cohesion AS cohesion,
		        c.symbolCount AS members, top
		 ORDER BY members DESC LIMIT 12`,
	);
	const clusters = clusterRows.map((r) => ({
		label: r.label,
		members: Number(r.members),
		cohesion: Number(r.cohesion),
		top_nodes: r.top ?? [],
	}));

	try {
		db.close?.();
	} catch {
		/* ignore */
	}

	const architecture = {
		project: repoPath.split("/").filter(Boolean).pop() ?? repoPath,
		total_nodes: Number(nodes[0]?.c ?? 0),
		total_edges: Number(edges[0]?.c ?? 0),
		node_labels: nodeLabels.map((r) => ({
			label: Array.isArray(r.label) ? r.label.join("|") : String(r.label),
			count: Number(r.count),
		})),
		edge_types: edgeTypes.map((r) => ({ type: r.type, count: Number(r.count) })),
		hotspots,
		boundaries,
		clusters,
	};

	process.stdout.write(JSON.stringify(architecture, null, 2));
}

main().catch((e) => {
	// 不让 gateway 因证据提取失败而崩;记 stderr + 输出空骨架。
	console.error("[extract-architecture]", e?.message ?? e);
	process.stdout.write(
		JSON.stringify(
			{ hotspots: [], boundaries: [], clusters: [], error: String(e?.message ?? e) },
			null,
			2,
		),
	);
});
