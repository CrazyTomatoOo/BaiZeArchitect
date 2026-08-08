import path from "node:path";
import fs from "node:fs/promises";

interface EvidenceCandidate {
	repositoryId: string;
	commitSha: string;
	filePath: string;
	symbol: string;
	lineStart: number;
	lineEnd: number;
}

export interface EvidenceValidationResult {
	candidates: EvidenceCandidate[];
	corrected: number;
	rejected: string[];
}

const COMMENT_PREFIXES = ["//", "/*", "*", "--"];
const HASH_COMMENT_EXTENSIONS = new Set([
	".py",
	".rb",
	".sh",
	".bash",
	".zsh",
	".yaml",
	".yml",
	".toml",
]);

function isCommentLine(line: string, extension: string): boolean {
	const trimmed = line.trim();
	if (COMMENT_PREFIXES.some((prefix) => trimmed.startsWith(prefix)))
		return true;
	return HASH_COMMENT_EXTENSIONS.has(extension) && trimmed.startsWith("#");
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function symbolIdentifier(symbol: string): string | null {
	const tail = symbol.split(/[.#:]/).at(-1)?.replace(/\(.*$/, "") ?? "";
	return tail.match(/[A-Za-z_$][\w$]*$/)?.[0] ?? null;
}

function findSymbolLine(
	lines: string[],
	symbol: string,
	extension: string,
): number | null {
	const identifier = symbolIdentifier(symbol);
	if (!identifier) return null;
	const escaped = escapeRegExp(identifier);
	const exact = new RegExp(`\\b${escaped}\\b`);
	const declarationPatterns = [
		new RegExp(
			`\\b(?:type|class|interface|struct|enum|trait|def|function|fn)\\s+${escaped}\\b`,
		),
		new RegExp(`\\bfunc\\b.*\\b${escaped}\\s*\\(`),
		new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\b`),
		new RegExp(`\\b${escaped}\\s*\\(`),
	];
	let best: { line: number; score: number } | null = null;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (isCommentLine(line, extension) || !exact.test(line)) continue;
		const score = declarationPatterns.findIndex((pattern) =>
			pattern.test(line),
		);
		const rankedScore =
			score === -1 ? 1 : declarationPatterns.length - score + 1;
		if (!best || rankedScore > best.score)
			best = { line: index + 1, score: rankedScore };
	}
	return best?.line ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;
}

export async function validateEvidenceCandidates(
	values: unknown[],
	repoPath: string,
	repositoryId: string,
	commitSha: string,
): Promise<EvidenceValidationResult> {
	const candidates: EvidenceCandidate[] = [];
	const rejected: string[] = [];
	let corrected = 0;
	const root = await fs.realpath(repoPath);

	for (const [index, value] of values.entries()) {
		const candidate = asRecord(value);
		if (!candidate) {
			rejected.push(`#${index + 1}: candidate is not an object`);
			continue;
		}
		const filePath = String(candidate.filePath ?? "").replaceAll("\\", "/");
		const symbol = String(candidate.symbol ?? "");
		const rawStart = Number(candidate.lineStart);
		const rawEnd = Number(candidate.lineEnd);
		if (
			!filePath ||
			!symbol ||
			!Number.isFinite(rawStart) ||
			!Number.isFinite(rawEnd)
		) {
			rejected.push(`#${index + 1}: missing path, symbol, or line range`);
			continue;
		}

		const absolutePath = path.resolve(root, filePath);
		const relativePath = path.relative(root, absolutePath);
		if (
			!relativePath ||
			relativePath.startsWith("..") ||
			path.isAbsolute(relativePath)
		) {
			rejected.push(`#${index + 1}: path escapes repository (${filePath})`);
			continue;
		}

		let realPath: string;
		let source: string;
		try {
			realPath = await fs.realpath(absolutePath);
			const realRelative = path.relative(root, realPath);
			if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
				rejected.push(
					`#${index + 1}: symlink escapes repository (${filePath})`,
				);
				continue;
			}
			source = await fs.readFile(realPath, "utf8");
		} catch {
			rejected.push(`#${index + 1}: file does not exist (${filePath})`);
			continue;
		}

		const lines = source.split(/\r?\n/);
		if (lines.at(-1) === "") lines.pop();
		const symbolLine = findSymbolLine(
			lines,
			symbol,
			path.extname(realPath).toLowerCase(),
		);
		if (symbolLine === null) {
			rejected.push(`#${index + 1}: symbol not found (${filePath}:${symbol})`);
			continue;
		}

		const start = Math.max(1, Math.trunc(rawStart));
		const end = Math.max(start, Math.trunc(rawEnd));
		const span = Math.max(0, end - start);
		const lineStart = symbolLine;
		const lineEnd = Math.min(lines.length, lineStart + span);
		const normalizedPath = path
			.relative(root, realPath)
			.split(path.sep)
			.join("/");
		if (
			lineStart !== rawStart ||
			lineEnd !== rawEnd ||
			normalizedPath !== filePath ||
			candidate.repositoryId !== repositoryId ||
			candidate.commitSha !== commitSha
		) {
			corrected += 1;
		}
		candidates.push({
			repositoryId,
			commitSha,
			filePath: normalizedPath,
			symbol,
			lineStart,
			lineEnd,
		});
	}

	return { candidates, corrected, rejected };
}
