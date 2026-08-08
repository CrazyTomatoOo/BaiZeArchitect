/**
 * evidence.ts — 容器内 gitnexus 证据生成(由 Gateway 调用)。
 *
 * gitnexus analyze <repo> → 写 <repo>/.gitnexus/lbug(KuzuDB 图);
 * extract-architecture.cjs 查图提取 hotspots/boundaries/clusters → EvidenceDoc。
 * 产物落 evidence/<repoId>.json(web UI evidence-snapshot 消费)。
 *
 * 完全在容器内运行；测试仓库先复制到 tmpfs，GitNexus 索引和 EvidenceDoc
 * 随一次性容器删除，不依赖或修改任何宿主目录。
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AGENT_RUNTIME_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.BAIZE_PROJECT_ROOT ?? join(AGENT_RUNTIME_DIR, "..");
const EVIDENCE_DIR = process.env.BAIZE_EVIDENCE_DIR ?? join(ROOT, "evidence");
const SAFE_REPO_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface EvidenceDoc {
	repositoryId: string;
	project?: string;
	repoPath?: string;
	generatedBy?: string;
	architecture?: {
		project?: string;
		total_nodes?: number;
		total_edges?: number;
		node_labels?: Array<{ label: string; count: number }>;
		edge_types?: Array<{ type: string; count: number }>;
		languages?: Array<{ language: string; file_count: number }>;
		entry_points?: Array<{
			name: string;
			qualified_name: string;
			file: string;
		}>;
		hotspots?: Array<{
			name: string;
			qualified_name: string;
			fan_in: number;
		}>;
		boundaries?: Array<{ from: string; to: string; call_count: number }>;
		layers?: Array<{ name: string; layer: string; reason: string }>;
		clusters?: Array<{
			id?: number;
			label: string;
			members: number;
			cohesion: number;
			top_nodes: string[];
		}>;
	};
}

/** 跑 extract-architecture.cjs 查 GitNexus 索引。 */
async function extractArchitecture(
	repoPath: string,
): Promise<Record<string, unknown>> {
	const stdout = await new Promise<string>((resolve, reject) =>
		execFile(
			"node",
			[join(AGENT_RUNTIME_DIR, "extract-architecture.cjs"), repoPath],
			{ timeout: 120000, maxBuffer: 1 << 24 },
			(err, out) => (err ? reject(err) : resolve(out)),
		),
	);
	return JSON.parse(stdout) as Record<string, unknown>;
}

/**
 * 容器内生成证据:gitnexus analyze → extract-architecture → EvidenceDoc,
 * 落 evidence/<repoId>.json。任何阶段失败返 null(证据是增强,非必需)。
 */
export async function generateEvidence(
	repoPath: string,
	repoId: string,
): Promise<EvidenceDoc | null> {
	if (!SAFE_REPO_ID.test(repoId)) {
		console.warn(`[evidence] invalid repository id: ${repoId}`);
		return null;
	}
	try {
		await new Promise<void>((resolve, reject) =>
			execFile("gitnexus", ["analyze", repoPath], { timeout: 600000 }, (err) =>
				err ? reject(err) : resolve(),
			),
		);
	} catch (e) {
		console.warn("[evidence] gitnexus analyze failed:", (e as Error).message);
		return null;
	}
	let architecture: Record<string, unknown>;
	try {
		architecture = await extractArchitecture(repoPath);
	} catch (e) {
		console.warn(
			"[evidence] extract-architecture failed:",
			(e as Error).message,
		);
		return null;
	}
	const evidence: EvidenceDoc = {
		repositoryId: repoId,
		repoPath,
		generatedBy: "gitnexus",
		architecture: architecture as EvidenceDoc["architecture"],
	};
	try {
		await mkdir(EVIDENCE_DIR, { recursive: true });
		await writeFile(
			join(EVIDENCE_DIR, `${repoId}.json`),
			JSON.stringify(evidence, null, 2),
		);
	} catch (e) {
		console.warn(
			"[evidence] write evidence.json failed:",
			(e as Error).message,
		);
	}
	return evidence;
}
