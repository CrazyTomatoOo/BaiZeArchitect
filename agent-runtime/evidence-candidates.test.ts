import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateEvidenceCandidates } from "./evidence-candidates.js";

test("corrects shifted symbol ranges and rejects invalid evidence", async () => {
	const repo = await mkdtemp(path.join(os.tmpdir(), "baize-evidence-"));
	try {
		await mkdir(path.join(repo, "src"));
		await writeFile(
			path.join(repo, "src", "service.go"),
			[
				"package src",
				"",
				"// UploadService handles uploads.",
				"type UploadService struct{}",
				"",
				"func (s UploadService) Retention() int { return 7 }",
				"",
				"func (s UploadService) Process() int {",
				"  return s.Retention()",
				"}",
			].join("\n"),
		);

		const result = await validateEvidenceCandidates(
			[
				{
					repositoryId: "wrong",
					commitSha: "wrong",
					filePath: "src/service.go",
					symbol: "service.go.UploadService",
					lineStart: 3,
					lineEnd: 3,
				},
				{
					repositoryId: "repo",
					commitSha: "abc123",
					filePath: "src/service.go",
					symbol: "service.go.Process",
					lineStart: 7,
					lineEnd: 9,
				},
				{
					filePath: "../outside.go",
					symbol: "outside.go.Nope",
					lineStart: 1,
					lineEnd: 1,
				},
				{
					filePath: "src/service.go",
					symbol: "service.go.Missing",
					lineStart: 1,
					lineEnd: 1,
				},
			],
			repo,
			"repo",
			"abc123",
		);

		assert.equal(result.corrected, 2);
		assert.deepEqual(
			result.candidates.map(({ lineStart, lineEnd }) => [lineStart, lineEnd]),
			[
				[4, 4],
				[8, 10],
			],
		);
		assert.equal(result.candidates[0].repositoryId, "repo");
		assert.equal(result.candidates[0].commitSha, "abc123");
		assert.equal(result.rejected.length, 2);
	} finally {
		await rm(repo, { recursive: true, force: true });
	}
});
