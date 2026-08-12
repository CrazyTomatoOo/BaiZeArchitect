import type { ArtifactKind, WritableArtifactKind } from "./plan-types.js";

export type ImpactDimension = "process" | "actors" | "behavior" | "architecture" | "data" | "api";
export type ImpactStatus = "yes" | "no" | "unknown";

export interface ImpactDimensionValue {
	readonly status: ImpactStatus;
	readonly rationale: string;
	readonly sourceRefs?: readonly unknown[];
}

export interface ImpactProfile {
	readonly process: ImpactDimensionValue;
	readonly actors: ImpactDimensionValue;
	readonly behavior: ImpactDimensionValue;
	readonly architecture: ImpactDimensionValue;
	readonly data: ImpactDimensionValue;
	readonly api: ImpactDimensionValue;
}

export const IMPACT_DIMENSION_TO_KIND: Readonly<Record<ImpactDimension, WritableArtifactKind>> = {
	process: "scenario",
	actors: "usecase",
	behavior: "function",
	architecture: "architecture",
	data: "data",
	api: "api",
};

export const ALWAYS_REQUIRED_KINDS: readonly ArtifactKind[] = ["requirement", "analysis", "design"];

export const TRACE_LINK_REQUIRED_KINDS: readonly WritableArtifactKind[] = [
	"analysis",
	"design",
	"architecture",
	"data",
	"api",
];

export interface RequiredArtifactSet {
	readonly requiredKinds: readonly ArtifactKind[];
	readonly blockingDimensions: readonly ImpactDimension[];
	readonly complete: boolean;
}

export function deriveRequiredArtifactSet(profile: ImpactProfile): RequiredArtifactSet {
	const requiredKinds: ArtifactKind[] = [...ALWAYS_REQUIRED_KINDS];
	const blockingDimensions: ImpactDimension[] = [];
	for (const dimension of Object.keys(IMPACT_DIMENSION_TO_KIND) as ImpactDimension[]) {
		const value = profile[dimension];
		if (value.status === "yes") {
			const kind = IMPACT_DIMENSION_TO_KIND[dimension];
			if (!requiredKinds.includes(kind)) {
				requiredKinds.push(kind);
			}
		} else if (value.status === "unknown") {
			blockingDimensions.push(dimension);
		}
	}
	return {
		requiredKinds,
		blockingDimensions,
		complete: blockingDimensions.length === 0,
	};
}
