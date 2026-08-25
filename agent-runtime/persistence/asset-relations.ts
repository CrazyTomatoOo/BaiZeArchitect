import type { ReusableAssetDetail } from "./asset-store.js";
import type { ReusableAssetKind } from "./reusable-asset-kind.js";

export const ASSET_RELATION_TYPES = ["contains", "involves"] as const;

export type AssetRelationType = (typeof ASSET_RELATION_TYPES)[number];

export interface AssetRelationInput {
	toAssetId: number;
	type: AssetRelationType;
}

export interface AssetRelationRecord {
	id: number;
	fromAssetId: number;
	toAssetId: number;
	fromRevisionId: number;
	toRevisionId: number;
	type: AssetRelationType;
	createdAt: string;
}

export interface ResolvedAssetRelation {
	assetId: number;
	revisionId: number;
	type: AssetRelationType;
	title: string;
	kind: ReusableAssetKind;
}

export interface ResolvedAssetGraph {
	incoming: readonly ResolvedAssetRelation[];
	outgoing: readonly ResolvedAssetRelation[];
}
export interface AssetGraph {
	nodes: readonly { assetId: number; kind: ReusableAssetKind; title: string }[];
	edges: readonly { fromAssetId: number; toAssetId: number; type: AssetRelationType }[];
}
export interface AssetRelationExport {
	fromTitle: string;
	fromKind: ReusableAssetKind;
	toTitle: string;
	toKind: ReusableAssetKind;
	type: AssetRelationType;
}

export interface ReusableAssetExportBundle {
	assets: readonly ReusableAssetDetail[];
	relations: readonly AssetRelationExport[];
}
export class AssetRelationValidationError extends Error {
	constructor(readonly issues: readonly { toAssetId?: number; type?: string; reason: string }[]) {
		super("Asset relation validation failed");
	}
}

const RELATION_KIND_PAIRS: Record<string, true> = {
	"scenario->usecase:contains": true,
	"usecase->function:contains": true,
	"function->api:contains": true,
	"function->data:contains": true,
	"design->architecture:contains": true,
	"scenario->stakeholder:involves": true,
	"usecase->stakeholder:involves": true,
};

export function isAssetRelationType(value: unknown): value is AssetRelationType {
	return typeof value === "string" && (ASSET_RELATION_TYPES as readonly string[]).includes(value);
}

export function isValidAssetRelation(
	fromKind: ReusableAssetKind,
	toKind: ReusableAssetKind,
	type: AssetRelationType,
): boolean {
	return RELATION_KIND_PAIRS[`${fromKind}->${toKind}:${type}`] === true;
}
