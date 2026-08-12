export interface RequirementBaseline {
	schemaVersion: "artifact/requirement/v1";
	artifactKind: "requirement";
	summary: string;
	sourceRefs: readonly unknown[];
	title: string;
	description: string;
	goals?: readonly string[];
	nonGoals?: readonly string[];
	constraints?: readonly string[];
}
