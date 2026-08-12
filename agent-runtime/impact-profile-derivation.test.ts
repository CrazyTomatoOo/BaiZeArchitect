import assert from "node:assert/strict";
import { test } from "node:test";
import {
	ALWAYS_REQUIRED_KINDS,
	IMPACT_DIMENSION_TO_KIND,
	TRACE_LINK_REQUIRED_KINDS,
	deriveRequiredArtifactSet,
	type ImpactDimension,
	type ImpactProfile,
} from "./workflow/impact-profile.js";

function makeProfile(overrides: Partial<Record<ImpactDimension, "yes" | "no" | "unknown">> = {}): ImpactProfile {
	const dims: ImpactDimension[] = ["process", "actors", "behavior", "architecture", "data", "api"];
	const profile = {} as Record<string, { status: "yes" | "no" | "unknown"; rationale: string }>;
	for (const dim of dims) {
		const status = overrides[dim] ?? "no";
		profile[dim] = { status, rationale: `rationale for ${dim}` };
	}
	return profile as unknown as ImpactProfile;
}

test("deriveRequiredArtifactSet always includes requirement, analysis, and design", () => {
	const set = deriveRequiredArtifactSet(makeProfile());
	assert.deepEqual(set.requiredKinds, ["requirement", "analysis", "design"]);
	assert.deepEqual(set.blockingDimensions, []);
	assert.equal(set.complete, true);
});

test("deriveRequiredArtifactSet adds scenario for process=yes", () => {
	const set = deriveRequiredArtifactSet(makeProfile({ process: "yes" }));
	assert(set.requiredKinds.includes("scenario"));
	assert(!set.requiredKinds.includes("usecase"));
});

test("deriveRequiredArtifactSet adds usecase for actors=yes", () => {
	const set = deriveRequiredArtifactSet(makeProfile({ actors: "yes" }));
	assert(set.requiredKinds.includes("usecase"));
});

test("deriveRequiredArtifactSet adds function for behavior=yes", () => {
	const set = deriveRequiredArtifactSet(makeProfile({ behavior: "yes" }));
	assert(set.requiredKinds.includes("function"));
});

test("deriveRequiredArtifactSet adds architecture for architecture=yes", () => {
	const set = deriveRequiredArtifactSet(makeProfile({ architecture: "yes" }));
	assert(set.requiredKinds.includes("architecture"));
});

test("deriveRequiredArtifactSet adds data for data=yes", () => {
	const set = deriveRequiredArtifactSet(makeProfile({ data: "yes" }));
	assert(set.requiredKinds.includes("data"));
});

test("deriveRequiredArtifactSet adds api for api=yes", () => {
	const set = deriveRequiredArtifactSet(makeProfile({ api: "yes" }));
	assert(set.requiredKinds.includes("api"));
});

test("deriveRequiredArtifactSet adds all kinds when all dimensions are yes", () => {
	const set = deriveRequiredArtifactSet(makeProfile({
		process: "yes", actors: "yes", behavior: "yes", architecture: "yes", data: "yes", api: "yes",
	}));
	assert.deepEqual(set.requiredKinds, ["requirement", "analysis", "design", "scenario", "usecase", "function", "architecture", "data", "api"]);
});

test("deriveRequiredArtifactSet blocks on unknown dimension", () => {
	const set = deriveRequiredArtifactSet(makeProfile({ process: "unknown" }));
	assert.deepEqual(set.blockingDimensions, ["process"]);
	assert.equal(set.complete, false);
});

test("deriveRequiredArtifactSet blocks on multiple unknown dimensions", () => {
	const set = deriveRequiredArtifactSet(makeProfile({ process: "unknown", api: "unknown" }));
	assert.deepEqual(set.blockingDimensions, ["process", "api"]);
	assert.equal(set.complete, false);
});

test("deriveRequiredArtifactSet no does not add corresponding kind", () => {
	const set = deriveRequiredArtifactSet(makeProfile({ process: "no", actors: "no", behavior: "no", architecture: "no", data: "no", api: "no" }));
	assert.deepEqual(set.requiredKinds, [...ALWAYS_REQUIRED_KINDS]);
});

test("TRACE_LINK_REQUIRED_KINDS includes analysis, design, architecture, data, api", () => {
	assert.deepEqual([...TRACE_LINK_REQUIRED_KINDS], ["analysis", "design", "architecture", "data", "api"]);
});

test("IMPACT_DIMENSION_TO_KIND maps process to scenario", () => {
	assert.equal(IMPACT_DIMENSION_TO_KIND.process, "scenario");
	assert.equal(IMPACT_DIMENSION_TO_KIND.actors, "usecase");
	assert.equal(IMPACT_DIMENSION_TO_KIND.behavior, "function");
	assert.equal(IMPACT_DIMENSION_TO_KIND.architecture, "architecture");
	assert.equal(IMPACT_DIMENSION_TO_KIND.data, "data");
	assert.equal(IMPACT_DIMENSION_TO_KIND.api, "api");
});
