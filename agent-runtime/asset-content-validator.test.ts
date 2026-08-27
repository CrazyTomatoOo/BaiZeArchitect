import assert from "node:assert/strict";
import test from "node:test";
import { validateAssetContent, pointer } from "./persistence/asset-content-validator.ts";

test("validateAssetContent returns empty for unknown kind", () => {
	assert.deepEqual(validateAssetContent("unknown", {}), []);
});

test("api validator detects 9 error types with JSON Pointer paths", () => {
	const errors = validateAssetContent("api", {
		openapi: "2.0",
		info: {},
		paths: {},
		components: { schemas: "not-object", securitySchemes: "not-object" },
		security: "not-array",
	});
	assert.ok(errors.length >= 6);
	const types = errors.map((e) => e.type);
	assert.ok(types.includes("invalid_openapi_version"));
	assert.ok(types.includes("missing_info"));
	assert.ok(types.includes("empty_paths"));
	assert.ok(types.includes("invalid_schema_ref"));
	assert.ok(types.includes("invalid_security_ref"));
	const paths = errors.map((e) => e.path);
	assert.ok(paths.some((p) => p === pointer("openapi")));
	assert.ok(paths.some((p) => p === pointer("paths")));
});

test("api validator detects duplicate operationId and missing response", () => {
	const errors = validateAssetContent("api", {
		openapi: "3.1.0",
		info: { title: "T", version: "1" },
		paths: {
			"/a": {
				summary: "A",
				get: { summary: "G1", operationId: "dup", responses: {} },
			},
			"/b": {
				summary: "B",
				post: { summary: "P1", operationId: "dup", responses: { "200": { description: "OK" } } },
			},
		},
	});
	const types = errors.map((e) => e.type);
	assert.ok(types.includes("missing_response"));
	assert.ok(types.includes("duplicate_operation_id"));
});

test("api validator detects invalid parameter", () => {
	const errors = validateAssetContent("api", {
		openapi: "3.1.0",
		info: { title: "T", version: "1" },
		paths: {
			"/x": {
				summary: "X",
				get: {
					summary: "G",
					parameters: [{ name: "", in: "invalid" }],
					responses: { "200": { description: "OK" } },
				},
			},
		},
	});
	const types = errors.map((e) => e.type);
	assert.ok(types.includes("invalid_parameter"));
});

test("data catalog validator detects 16 error types with JSON Pointer paths", () => {
	const errors = validateAssetContent("data", {
		entities: [],
	});
	assert.ok(errors.some((e) => e.type === "empty_entities"));

	const errors2 = validateAssetContent("data", {
		entities: [
			{ entityId: "e1", name: "E", fields: [] },
			{ entityId: "e1", name: "E2", fields: [{ fieldId: "f1", name: "f", type: "string" }] },
		],
		relations: [
			{ fromEntityId: "missing", fromFieldIds: [], toEntityId: "e1", cardinality: "invalid" },
		],
	});
	const types = errors2.map((e) => e.type);
	assert.ok(types.includes("duplicate_entity_id"));
	assert.ok(types.includes("empty_fields"));
	assert.ok(types.includes("invalid_reference"));
	assert.ok(types.includes("invalid_cardinality"));
});

test("data catalog validator detects invalid logical type and enum constraint", () => {
	const errors = validateAssetContent("data", {
		entities: [
			{
				entityId: "e1",
				name: "E",
				fields: [
					{ fieldId: "f1", name: "f", type: "bogus" },
					{ fieldId: "f2", name: "f2", type: "enum" },
					{ fieldId: "f3", name: "f3", type: "string", enumValues: ["a"] },
				],
			},
		],
	});
	const types = errors.map((e) => e.type);
	assert.ok(types.includes("invalid_logical_type"));
	assert.ok(types.includes("enum_values_required"));
	assert.ok(types.includes("enum_values_forbidden"));
});

test("architecture validator detects 14 error types with JSON Pointer paths", () => {
	const errors = validateAssetContent("architecture", {
		components: [],
	});
	assert.ok(errors.some((e) => e.type === "empty_components"));

	const errors2 = validateAssetContent("architecture", {
		components: [
			{ componentId: "c1", name: "N", responsibility: "R" },
			{ componentId: "c1", name: "N2", responsibility: "R2" },
		],
		relationships: [
			{ relationshipId: "r1", fromComponentId: "c1", toComponentId: "c1", interaction: "call", type: "invalid" },
		],
		layout: "not-object",
		nonFunctionalRequirements: [],
	});
	const types = errors2.map((e) => e.type);
	assert.ok(types.includes("duplicate_component_id"));
	assert.ok(types.includes("self_reference"));
	assert.ok(types.includes("invalid_relation_type"));
	assert.ok(types.includes("invalid_layout_key"));
	assert.ok(types.includes("empty_nfr"));
});

test("hierarchy validators detect missing nodeId and title", () => {
	const errors = validateAssetContent("scenario-domain", { description: "no nodeId" });
	assert.ok(errors.some((e) => e.type === "missing_node_id"));
	assert.ok(errors.some((e) => e.type === "missing_title"));

	const variantErrors = validateAssetContent("scenario-variant", { nodeId: "v1", title: "V" });
	assert.ok(variantErrors.some((e) => e.type === "missing_actors"));
	assert.ok(variantErrors.some((e) => e.type === "missing_main_flow"));

	const pointErrors = validateAssetContent("function-point", { nodeId: "p1" });
	assert.ok(pointErrors.some((e) => e.type === "missing_name"));
	assert.ok(pointErrors.some((e) => e.type === "missing_responsibility"));
});

test("pointer escapes special characters per RFC 6901", () => {
	assert.equal(pointer("a", "b"), "/a/b");
	assert.equal(pointer("a/b"), "/a~1b");
	assert.equal(pointer("a~b"), "/a~0b");
});
