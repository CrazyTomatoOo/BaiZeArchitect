import assert from "node:assert/strict";
import test from "node:test";
import { generateEvidence } from "./evidence.js";

test("rejects repository ids that can escape the evidence directory", async () => {
	assert.equal(await generateEvidence(".", "../outside"), null);
});
