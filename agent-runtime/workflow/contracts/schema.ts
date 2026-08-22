import { Compile } from "typebox/compile";
import type {
	WorkflowContractCatalog,
	WorkflowContractIdentity,
} from "./loader.js";

export interface WorkflowSchemaValidator {
	check(value: unknown): boolean;
	errors(value: unknown): readonly unknown[];
}

export function compileWorkflowSchema(
	contracts: WorkflowContractCatalog,
	identity: Extract<
		WorkflowContractIdentity,
		"plan-proposal/v1" | "artifact-content/v1" | "model-config/v1"
	>,
): WorkflowSchemaValidator {
	const validator = Compile(contracts.get(identity).content);
	return {
		check(value) {
			return validator.Check(value);
		},
		errors(value) {
			return [...validator.Errors(value)];
		},
	};
}
