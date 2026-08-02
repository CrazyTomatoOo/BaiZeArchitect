# /// script
# requires-python = ">=3.12"
# ///
# ─── How to run ───
# uv run scripts/validate_m0_package.py

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final, TypeAlias

JsonValue: TypeAlias = None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]

ROOT: Final = Path(__file__).resolve().parents[1]
MANIFEST: Final = ROOT / "examples" / "m0" / "design-package" / "manifest.json"
MIN_TRACEABILITY_ITEMS: Final = 2


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    path: str
    message: str


def main(argv: tuple[str, ...] = tuple(sys.argv[1:])) -> int:
    if argv == ("--help",):
        print("Usage: uv run scripts/validate_m0_package.py")
        print("Validate the M0 Design Package manifest and traceability matrix.")
        return 0
    if argv:
        print(f"unknown argument: {argv[0]}", file=sys.stderr)
        return 2

    issues = validate_package()
    if issues:
        print("M0 package validation failed")
        for issue in issues:
            print(f"- {issue.path}: {issue.message}")
        return 1
    print("M0 package validation passed")
    print(f"- manifest: {MANIFEST.relative_to(ROOT)}")
    print(f"- minimum traceability items: {MIN_TRACEABILITY_ITEMS}")
    return 0


def validate_package() -> tuple[ValidationIssue, ...]:
    if not MANIFEST.exists():
        return (ValidationIssue(str(MANIFEST), "manifest is missing"),)

    loaded = load_json(MANIFEST)
    match loaded:
        case {
            "packageId": str() as package_id,
            "repositoryBaselines": list() as repositories,
            "schemaRefs": list() as schemas,
            "artifactRefs": list() as artifacts,
            "traceabilityMatrix": str() as traceability_matrix,
            "validationCommands": list() as validation_commands,
        }:
            issues = [*validate_refs("schemaRefs", schemas), *validate_refs("artifactRefs", artifacts)]
            issues.extend(validate_traceability(traceability_matrix))
            if not package_id:
                issues.append(ValidationIssue(str(MANIFEST), "packageId is required"))
            if not repositories:
                issues.append(ValidationIssue(str(MANIFEST), "repositoryBaselines must not be empty"))
            if len(validation_commands) < 2:
                issues.append(ValidationIssue(str(MANIFEST), "both M0 validation commands must be listed"))
            return tuple(issues)
        case _:
            return (ValidationIssue(str(MANIFEST), "manifest shape is invalid"),)


def validate_refs(field_name: str, refs: list[JsonValue]) -> tuple[ValidationIssue, ...]:
    issues: list[ValidationIssue] = []
    for index, ref in enumerate(refs):
        path = f"manifest.{field_name}[{index}]"
        match ref:
            case str() as ref_path:
                if not (ROOT / ref_path).exists():
                    issues.append(ValidationIssue(path, f"referenced path does not exist: {ref_path}"))
            case _:
                issues.append(ValidationIssue(path, "reference must be a string path"))
    return tuple(issues)


def validate_traceability(traceability_matrix: str) -> tuple[ValidationIssue, ...]:
    matrix_path = ROOT / traceability_matrix
    if not matrix_path.exists():
        return (ValidationIssue("manifest.traceabilityMatrix", f"referenced path does not exist: {traceability_matrix}"),)

    loaded = load_json(matrix_path)
    match loaded:
        case {"items": list() as items}:
            issues: list[ValidationIssue] = []
            if len(items) < MIN_TRACEABILITY_ITEMS:
                issues.append(ValidationIssue(str(matrix_path), f"at least {MIN_TRACEABILITY_ITEMS} traceability items are required"))
            for index, item in enumerate(items):
                issues.extend(validate_traceability_item(index, item))
            return tuple(issues)
        case _:
            return (ValidationIssue(str(matrix_path), "traceability matrix must contain items array"),)


def validate_traceability_item(index: int, item: JsonValue) -> tuple[ValidationIssue, ...]:
    path = f"traceability.items[{index}]"
    match item:
        case {
            "caseId": str() as case_id,
            "requirement": str() as requirement,
            "architectureComponents": list() as components,
            "decisionRefs": list() as decisions,
            "evidenceRefs": list() as evidence,
        }:
            issues: list[ValidationIssue] = []
            if not case_id or not requirement:
                issues.append(ValidationIssue(path, "caseId and requirement are required"))
            if not components:
                issues.append(ValidationIssue(path, "architectureComponents must not be empty"))
            if not decisions:
                issues.append(ValidationIssue(path, "decisionRefs must not be empty"))
            if len(evidence) < 2:
                issues.append(ValidationIssue(path, "at least two evidenceRefs are required"))
            return tuple(issues)
        case _:
            return (ValidationIssue(path, "traceability item shape is invalid"),)


def load_json(path: Path) -> JsonValue:
    with path.open("r", encoding="utf-8") as file:
        loaded = json.load(file)
    return parse_json_value(loaded)


def parse_json_value(value: JsonValue) -> JsonValue:
    return value


if __name__ == "__main__":
    raise SystemExit(main())
