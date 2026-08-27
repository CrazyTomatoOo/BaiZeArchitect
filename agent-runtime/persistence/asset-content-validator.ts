/**
 * asset-content-validator.ts — Kind-specific content validators with structured errors.
 *
 * Replaces the boolean-only `isStructuredAssetContentValid` with validators that
 * return typed errors with JSON Pointer paths for field-level error display.
 *
 * Error format: { type: string, path: string, message: string }
 * Path format: RFC 6901 JSON Pointer (e.g. "/domains/0/scenarios/1/variants/0/actors")
 */
export interface AssetValidationError {
	type: string;
	path: string;
	message: string;
}

export class AssetContentValidationError extends Error {
	constructor(readonly errors: readonly AssetValidationError[]) {
		super("Asset content validation failed");
		this.name = "AssetContentValidationError";
	}
}

export interface AssetContentValidator {
	validate(kind: string, content: unknown): readonly AssetValidationError[];
}

/** RFC 6901 JSON Pointer path builder. */
export function pointer(...segments: readonly (string | number)[]): string {
	return "/" + segments.map((s) => String(s).replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
}

type Validator = (content: unknown) => readonly AssetValidationError[];

const validators: Record<string, Validator> = {
	api: validateApi,
	data: validateData,
	architecture: validateArchitecture,
	"scenario-variant": validateScenarioVariant,
	"function-point": validateFunctionPoint,
	"scenario-domain": validateOrgNode,
	scenario: validateOrgNode,
	"function-domain": validateOrgNode,
	"function-item": validateOrgNode,
};

export function isAssetContentValidationSupported(kind: string): boolean {
	return validators[kind] !== undefined;
}

export function validateAssetContent(kind: string, content: unknown): readonly AssetValidationError[] {
	const validator = validators[kind];
	if (!validator) return [];
	return validator(content);
}

// --- OpenAPI (api) — 9 error types ---

function validateApi(content: unknown): readonly AssetValidationError[] {
	const errors: AssetValidationError[] = [];
	if (typeof content !== "object" || content === null || Array.isArray(content)) {
		return [{ type: "invalid_content", path: "", message: "Content must be an object" }];
	}
	const record = content as Record<string, unknown>;
	if (record.openapi !== "3.1.0") errors.push({ type: "invalid_openapi_version", path: pointer("openapi"), message: "openapi must be \"3.1.0\"" });
	if (typeof record.info !== "object" || record.info === null) {
		errors.push({ type: "missing_info", path: pointer("info"), message: "info is required and must be an object" });
	} else {
		const info = record.info as Record<string, unknown>;
		if (typeof info.title !== "string" || info.title.length === 0) errors.push({ type: "missing_info", path: pointer("info", "title"), message: "info.title is required" });
		if (typeof info.version !== "string" || info.version.length === 0) errors.push({ type: "missing_info", path: pointer("info", "version"), message: "info.version is required" });
	}
	if (typeof record.paths !== "object" || record.paths === null || Object.keys(record.paths).length === 0) {
		errors.push({ type: "empty_paths", path: pointer("paths"), message: "paths must have at least one entry" });
	} else {
		const paths = record.paths as Record<string, unknown>;
		const operationIds = new Set<string>();
		const methodSet = new Set(["get", "post", "put", "delete", "patch"]);
		for (const [pathKey, pathItem] of Object.entries(paths)) {
			if (typeof pathItem !== "object" || pathItem === null) continue;
			const item = pathItem as Record<string, unknown>;
			for (const method of methodSet) {
				if (!(method in item)) continue;
				const op = item[method] as Record<string, unknown>;
				if (typeof op !== "object" || op === null) continue;
				if (typeof op.summary !== "string" || op.summary.length === 0) {
					errors.push({ type: "missing_summary", path: pointer("paths", pathKey, method, "summary"), message: "operation summary is required" });
				}
				if (typeof op.responses !== "object" || op.responses === null || Object.keys(op.responses).length === 0) {
					errors.push({ type: "missing_response", path: pointer("paths", pathKey, method, "responses"), message: "operation must have at least one response" });
				}
				if (typeof op.operationId === "string") {
					if (operationIds.has(op.operationId)) {
						errors.push({ type: "duplicate_operation_id", path: pointer("paths", pathKey, method, "operationId"), message: `duplicate operationId: ${op.operationId}` });
					}
					operationIds.add(op.operationId);
				}
				if (Array.isArray(op.parameters)) {
					for (let i = 0; i < op.parameters.length; i++) {
						const param = op.parameters[i] as Record<string, unknown>;
						if (typeof param !== "object" || param === null) {
							errors.push({ type: "invalid_parameter", path: pointer("paths", pathKey, method, "parameters", i), message: "parameter must be an object" });
							continue;
						}
						if (typeof param.name !== "string" || param.name.length === 0) errors.push({ type: "invalid_parameter", path: pointer("paths", pathKey, method, "parameters", i, "name"), message: "parameter name is required" });
						if (typeof param.in !== "string" || !["query", "header", "path", "cookie"].includes(param.in)) errors.push({ type: "invalid_parameter", path: pointer("paths", pathKey, method, "parameters", i, "in"), message: "parameter in must be query/header/path/cookie" });
					}
				}
			}
			for (const method of Object.keys(item)) {
				if (!methodSet.has(method) && method !== "summary" && method !== "description") {
					// Check for duplicate operations at same path
				}
			}
		}
	}
	// Check duplicate operations (same method+path already handled by object keys; check operationId cross-path done above)
	if (record.components !== undefined && typeof record.components === "object" && record.components !== null) {
		const components = record.components as Record<string, unknown>;
		if (components.schemas !== undefined && (typeof components.schemas !== "object" || components.schemas === null)) {
			errors.push({ type: "invalid_schema_ref", path: pointer("components", "schemas"), message: "components.schemas must be an object" });
		}
		if (components.securitySchemes !== undefined && (typeof components.securitySchemes !== "object" || components.securitySchemes === null)) {
			errors.push({ type: "invalid_security_ref", path: pointer("components", "securitySchemes"), message: "components.securitySchemes must be an object" });
		}
	}
	if (record.security !== undefined && !Array.isArray(record.security)) {
		errors.push({ type: "invalid_security_ref", path: pointer("security"), message: "security must be an array" });
	}
	return errors;
}

// --- Data catalog (data) — 16 error types ---

const LOGICAL_TYPES = ["string", "text", "integer", "decimal", "boolean", "date", "datetime", "time", "uuid", "binary", "json", "enum"];
const CARDINALITIES = ["one-to-one", "one-to-many", "many-to-one", "many-to-many"];

function validateData(content: unknown): readonly AssetValidationError[] {
	const errors: AssetValidationError[] = [];
	if (typeof content !== "object" || content === null || Array.isArray(content)) {
		return [{ type: "invalid_content", path: "", message: "Content must be an object" }];
	}
	const record = content as Record<string, unknown>;
	const entities = record.entities;
	if (!Array.isArray(entities) || entities.length === 0) {
		errors.push({ type: "empty_entities", path: pointer("entities"), message: "entities must have at least one entry" });
		return errors;
	}
	const entityIdSet = new Set<string>();
	const entityNameMap = new Map<string, string>();
	const entityIdToFieldIds = new Map<string, Set<string>>();
	for (let i = 0; i < entities.length; i++) {
		const entity = entities[i] as Record<string, unknown>;
		if (typeof entity !== "object" || entity === null) {
			errors.push({ type: "invalid_entity", path: pointer("entities", i), message: "entity must be an object" });
			continue;
		}
		if (typeof entity.entityId !== "string" || entity.entityId.length === 0) {
			errors.push({ type: "missing_entity_id", path: pointer("entities", i, "entityId"), message: "entityId is required" });
		} else if (entityIdSet.has(entity.entityId)) {
			errors.push({ type: "duplicate_entity_id", path: pointer("entities", i, "entityId"), message: `duplicate entityId: ${entity.entityId}` });
		}
		entityIdSet.add(entity.entityId as string);
		if (typeof entity.name !== "string" || entity.name.length === 0) {
			errors.push({ type: "missing_entity_name", path: pointer("entities", i, "name"), message: "entity name is required" });
		}
		if (entityNameMap.has(entity.name as string)) {
			errors.push({ type: "duplicate_entity_name", path: pointer("entities", i, "name"), message: `duplicate entity name: ${entity.name}` });
		}
		entityNameMap.set(entity.name as string, entity.entityId as string);
		if (!Array.isArray(entity.fields) || entity.fields.length === 0) {
			errors.push({ type: "empty_fields", path: pointer("entities", i, "fields"), message: "entity must have at least one field" });
			entityIdToFieldIds.set(entity.entityId as string, new Set());
			continue;
		}
		const fieldIdSet = new Set<string>();
		for (let j = 0; j < entity.fields.length; j++) {
			const field = entity.fields[j] as Record<string, unknown>;
			if (typeof field.fieldId !== "string" || field.fieldId.length === 0) {
				errors.push({ type: "missing_field_id", path: pointer("entities", i, "fields", j, "fieldId"), message: "fieldId is required" });
			} else if (fieldIdSet.has(field.fieldId)) {
				errors.push({ type: "duplicate_field_id", path: pointer("entities", i, "fields", j, "fieldId"), message: `duplicate fieldId: ${field.fieldId}` });
			}
			fieldIdSet.add(field.fieldId as string);
			if (typeof field.name !== "string" || field.name.length === 0) {
				errors.push({ type: "missing_field_name", path: pointer("entities", i, "fields", j, "name"), message: "field name is required" });
			}
			if (typeof field.type !== "string" || !LOGICAL_TYPES.includes(field.type)) {
				errors.push({ type: "invalid_logical_type", path: pointer("entities", i, "fields", j, "type"), message: `invalid logicalType: ${field.type}` });
			}
			if (field.type === "enum" && (!Array.isArray(field.enumValues) || field.enumValues.length === 0)) {
				errors.push({ type: "enum_values_required", path: pointer("entities", i, "fields", j, "enumValues"), message: "enum type requires enumValues" });
			}
			if (field.type !== "enum" && field.enumValues !== undefined) {
				errors.push({ type: "enum_values_forbidden", path: pointer("entities", i, "fields", j, "enumValues"), message: "non-enum type must not have enumValues" });
			}
		}
		entityIdToFieldIds.set(entity.entityId as string, fieldIdSet);
		if (!Array.isArray(entity.primaryKey) || entity.primaryKey.length === 0) {
			errors.push({ type: "missing_primary_key", path: pointer("entities", i, "primaryKey"), message: "primaryKey is required and must not be empty" });
		} else {
			for (let k = 0; k < entity.primaryKey.length; k++) {
				const fk = entity.primaryKey[k] as string;
				if (!fieldIdSet.has(fk)) {
					errors.push({ type: "invalid_primary_key_ref", path: pointer("entities", i, "primaryKey", k), message: `primaryKey fieldId not found: ${fk}` });
				}
			}
		}
		if (Array.isArray(entity.uniqueKeys)) {
			for (let k = 0; k < entity.uniqueKeys.length; k++) {
				const uk = entity.uniqueKeys[k];
				if (!Array.isArray(uk) || uk.length === 0) {
					errors.push({ type: "invalid_unique_key", path: pointer("entities", i, "uniqueKeys", k), message: "uniqueKey must be a non-empty array" });
				}
			}
		}
	}
	const relations = record.relations;
	if (Array.isArray(relations)) {
		const relNames = new Set<string>();
		for (let i = 0; i < relations.length; i++) {
			const rel = relations[i] as Record<string, unknown>;
			if (typeof rel !== "object" || rel === null) {
				errors.push({ type: "invalid_relation", path: pointer("relations", i), message: "relation must be an object" });
				continue;
			}
		if (typeof rel.fromEntityId !== "string" || !entityIdSet.has(rel.fromEntityId)) {
			errors.push({ type: "invalid_reference", path: pointer("relations", i, "fromEntityId"), message: `fromEntityId not found: ${rel.fromEntityId}` });
		}
		if (!Array.isArray(rel.fromFieldIds) || rel.fromFieldIds.length === 0) {
			errors.push({ type: "invalid_reference", path: pointer("relations", i, "fromFieldIds"), message: "fromFieldIds must be a non-empty array" });
		} else if (typeof rel.fromEntityId === "string") {
			const fields = entityIdToFieldIds.get(rel.fromEntityId);
			if (fields) {
				for (let k = 0; k < rel.fromFieldIds.length; k++) {
					if (!fields.has(rel.fromFieldIds[k] as string)) {
						errors.push({ type: "invalid_reference", path: pointer("relations", i, "fromFieldIds", k), message: `fromFieldId not found in source entity: ${rel.fromFieldIds[k]}` });
					}
				}
			}
		}
		if (typeof rel.toEntityId !== "string" || !entityIdSet.has(rel.toEntityId)) {
			errors.push({ type: "invalid_reference", path: pointer("relations", i, "toEntityId"), message: `toEntityId not found: ${rel.toEntityId}` });
		}
		if (Array.isArray(rel.toFieldIds) && typeof rel.toEntityId === "string") {
			const fields = entityIdToFieldIds.get(rel.toEntityId);
			if (fields) {
				for (let k = 0; k < rel.toFieldIds.length; k++) {
					if (!fields.has(rel.toFieldIds[k] as string)) {
						errors.push({ type: "invalid_reference", path: pointer("relations", i, "toFieldIds", k), message: `toFieldId not found in target entity: ${rel.toFieldIds[k]}` });
					}
				}
			}
		}
		if (Array.isArray(rel.toFieldIds) && Array.isArray(rel.fromFieldIds) && rel.toFieldIds.length !== rel.fromFieldIds.length) {
			errors.push({ type: "composite_key_mismatch", path: pointer("relations", i), message: "fromFieldIds and toFieldIds must have the same length" });
		}
			if (typeof rel.cardinality !== "string" || !CARDINALITIES.includes(rel.cardinality)) {
				errors.push({ type: "invalid_cardinality", path: pointer("relations", i, "cardinality"), message: `invalid cardinality: ${rel.cardinality}` });
			}
			if (typeof rel.name === "string") {
				if (relNames.has(rel.name)) {
					errors.push({ type: "duplicate_relation_name", path: pointer("relations", i, "name"), message: `duplicate relation name: ${rel.name}` });
				}
				relNames.add(rel.name);
			}
		}
	}
	return errors;
}

// --- Architecture (architecture) — 14 error types ---

const RELATION_TYPES = ["sync-call", "async-event", "data-flow", "dependency"];

function validateArchitecture(content: unknown): readonly AssetValidationError[] {
	const errors: AssetValidationError[] = [];
	if (typeof content !== "object" || content === null || Array.isArray(content)) {
		return [{ type: "invalid_content", path: "", message: "Content must be an object" }];
	}
	const record = content as Record<string, unknown>;
	const components = record.components;
	if (!Array.isArray(components) || components.length === 0) {
		errors.push({ type: "empty_components", path: pointer("components"), message: "components must have at least one entry" });
		return errors;
	}
	const componentIdSet = new Set<string>();
	for (let i = 0; i < components.length; i++) {
		const comp = components[i] as Record<string, unknown>;
		if (typeof comp.componentId !== "string" || comp.componentId.length === 0) {
			errors.push({ type: "missing_component_id", path: pointer("components", i, "componentId"), message: "componentId is required" });
		} else if (componentIdSet.has(comp.componentId)) {
			errors.push({ type: "duplicate_component_id", path: pointer("components", i, "componentId"), message: `duplicate componentId: ${comp.componentId}` });
		}
		componentIdSet.add(comp.componentId as string);
		if (typeof comp.name !== "string" || comp.name.length === 0) {
			errors.push({ type: "missing_component_name", path: pointer("components", i, "name"), message: "component name is required" });
		}
		if (typeof comp.responsibility !== "string" || comp.responsibility.length === 0) {
			errors.push({ type: "missing_responsibility", path: pointer("components", i, "responsibility"), message: "component responsibility is required" });
		}
	}
	const relationships = record.relationships;
	if (Array.isArray(relationships)) {
		const relIdSet = new Set<string>();
		for (let i = 0; i < relationships.length; i++) {
			const rel = relationships[i] as Record<string, unknown>;
			if (typeof rel.relationshipId !== "string" || rel.relationshipId.length === 0) {
				errors.push({ type: "missing_relationship_id", path: pointer("relationships", i, "relationshipId"), message: "relationshipId is required" });
			} else if (relIdSet.has(rel.relationshipId)) {
				errors.push({ type: "duplicate_relationship_id", path: pointer("relationships", i, "relationshipId"), message: `duplicate relationshipId: ${rel.relationshipId}` });
			}
			relIdSet.add(rel.relationshipId as string);
			if (typeof rel.fromComponentId !== "string" || !componentIdSet.has(rel.fromComponentId)) {
				errors.push({ type: "invalid_reference", path: pointer("relationships", i, "fromComponentId"), message: `fromComponentId not found: ${rel.fromComponentId}` });
			}
			if (typeof rel.toComponentId !== "string" || !componentIdSet.has(rel.toComponentId)) {
				errors.push({ type: "invalid_reference", path: pointer("relationships", i, "toComponentId"), message: `toComponentId not found: ${rel.toComponentId}` });
			}
			if (rel.fromComponentId === rel.toComponentId) {
				errors.push({ type: "self_reference", path: pointer("relationships", i), message: "relationship cannot reference itself" });
			}
			if (typeof rel.type === "string" && !RELATION_TYPES.includes(rel.type)) {
				errors.push({ type: "invalid_relation_type", path: pointer("relationships", i, "type"), message: `invalid relationship type: ${rel.type}` });
			}
		}
	}
	if (record.layout !== undefined) {
		if (typeof record.layout !== "object" || record.layout === null) {
			errors.push({ type: "invalid_layout_key", path: pointer("layout"), message: "layout must be an object" });
		} else {
			const layout = record.layout as Record<string, unknown>;
			if (layout.componentPositions !== undefined && !Array.isArray(layout.componentPositions)) {
				errors.push({ type: "invalid_layout_key", path: pointer("layout", "componentPositions"), message: "componentPositions must be an array" });
			}
			if (layout.relationshipWaypoints !== undefined && !Array.isArray(layout.relationshipWaypoints)) {
				errors.push({ type: "invalid_layout_key", path: pointer("layout", "relationshipWaypoints"), message: "relationshipWaypoints must be an array" });
			}
			if (layout.boundaries !== undefined && !Array.isArray(layout.boundaries)) {
				errors.push({ type: "invalid_layout_key", path: pointer("layout", "boundaries"), message: "boundaries must be an array" });
			}
		}
	}
	if (!Array.isArray(record.constraints) && record.constraints !== undefined) {
		errors.push({ type: "invalid_constraints", path: pointer("constraints"), message: "constraints must be an array" });
	}
	if (!Array.isArray(record.nonFunctionalRequirements) || record.nonFunctionalRequirements.length === 0) {
		errors.push({ type: "empty_nfr", path: pointer("nonFunctionalRequirements"), message: "nonFunctionalRequirements must have at least one entry" });
	}
	return errors;
}

// --- Hierarchy tree validators ---

function validateOrgNode(content: unknown): readonly AssetValidationError[] {
	const errors: AssetValidationError[] = [];
	if (typeof content !== "object" || content === null || Array.isArray(content)) {
		return [{ type: "invalid_content", path: "", message: "Content must be an object" }];
	}
	const record = content as Record<string, unknown>;
	if (typeof record.nodeId !== "string" || record.nodeId.length === 0) {
		errors.push({ type: "missing_node_id", path: pointer("nodeId"), message: "nodeId is required" });
	}
	if (typeof record.title !== "string" || record.title.length === 0) {
		errors.push({ type: "missing_title", path: pointer("title"), message: "title is required" });
	}
	return errors;
}

function validateScenarioVariant(content: unknown): readonly AssetValidationError[] {
	const errors: AssetValidationError[] = [...validateOrgNode(content)];
	if (typeof content !== "object" || content === null || Array.isArray(content)) return errors;
	const record = content as Record<string, unknown>;
	if (!Array.isArray(record.actors) || record.actors.length === 0) {
		errors.push({ type: "missing_actors", path: pointer("actors"), message: "actors must have at least one entry" });
	}
	if (!Array.isArray(record.mainFlow) || record.mainFlow.length === 0) {
		errors.push({ type: "missing_main_flow", path: pointer("mainFlow"), message: "mainFlow must have at least one entry" });
	}
	if (typeof record.trigger !== "string" || record.trigger.length === 0) {
		errors.push({ type: "missing_trigger", path: pointer("trigger"), message: "trigger is required" });
	}
	if (typeof record.expectedOutcome !== "string" || record.expectedOutcome.length === 0) {
		errors.push({ type: "missing_expected_outcome", path: pointer("expectedOutcome"), message: "expectedOutcome is required" });
	}
	return errors;
}

function validateFunctionPoint(content: unknown): readonly AssetValidationError[] {
	const errors: AssetValidationError[] = [];
	if (typeof content !== "object" || content === null || Array.isArray(content)) {
		return [{ type: "invalid_content", path: "", message: "Content must be an object" }];
	}
	const record = content as Record<string, unknown>;
	if (typeof record.nodeId !== "string" || record.nodeId.length === 0) {
		errors.push({ type: "missing_node_id", path: pointer("nodeId"), message: "nodeId is required" });
	}
	if (typeof record.name !== "string" || record.name.length === 0) {
		errors.push({ type: "missing_name", path: pointer("name"), message: "name is required" });
	}
	if (typeof record.responsibility !== "string" || record.responsibility.length === 0) {
		errors.push({ type: "missing_responsibility", path: pointer("responsibility"), message: "responsibility is required" });
	}
	if (!Array.isArray(record.acceptanceCriteria) || record.acceptanceCriteria.length === 0) {
		errors.push({ type: "missing_acceptance_criteria", path: pointer("acceptanceCriteria"), message: "acceptanceCriteria must have at least one entry" });
	}
	return errors;
}
