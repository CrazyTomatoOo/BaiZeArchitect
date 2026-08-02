# /// script
# requires-python = ">=3.12"
# ///
# ─── How to run ───
# uv run scripts/validate_m0.py

from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from collections.abc import Mapping
from typing import Final, TypeAlias

JsonValue: TypeAlias = None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]

ROOT: Final = Path(__file__).resolve().parents[1]
SCHEMAS: Final = (ROOT / "schemas" / "requirement-spec.schema.json", ROOT / "schemas" / "architecture-spec.schema.json", ROOT / "schemas" / "decision-record.schema.json", ROOT / "schemas" / "code-evidence.schema.json")
CASES_FILE: Final = ROOT / "examples" / "m0" / "cases.json"
ARTIFACTS_DIR: Final = ROOT / "examples" / "m0" / "artifacts"
MIN_CASES: Final = 5
MIN_EVIDENCE_PER_CASE: Final = 2
MIN_DECISION_CASES: Final = 3
MIN_ARTIFACT_CASES: Final = 2


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    path: str
    message: str


@dataclass(frozen=True, slots=True)
class Evidence:
    repository_id: str
    commit_sha: str
    file_path: str
    symbol: str
    line_start: int
    line_end: int
    claim: str


@dataclass(frozen=True, slots=True)
class M0Case:
    case_id: str
    evidence: tuple[Evidence, ...]
    decision_candidate: str


def main(argv: tuple[str, ...] = tuple(sys.argv[1:])) -> int:
    if argv == ("--help",):
        print("Usage: uv run scripts/validate_m0.py")
        print("       uv run scripts/validate_m0.py --repo-root pilot-backend=/path/to/repo")
        print("Validate the M0 technical validation baseline assets.")
        return 0
    repo_roots: dict[str, Path] = {}
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--repo-root" and index + 1 < len(argv):
            index += 1
            issue = add_repo_root(repo_roots, argv[index])
        elif arg.startswith("--repo-root="):
            issue = add_repo_root(repo_roots, arg.removeprefix("--repo-root="))
        else:
            print(f"unknown argument: {arg}", file=sys.stderr)
            return 2
        if issue:
            print(f"invalid --repo-root: {issue}", file=sys.stderr)
            return 2
        index += 1

    issues = [*validate_schema_files(), *validate_cases_file(repo_roots), *validate_artifacts()]
    if issues:
        print("M0 validation failed")
        for issue in issues:
            print(f"- {issue.path}: {issue.message}")
        return 1
    print("M0 validation passed")
    print(f"- schemas: {len(SCHEMAS)}")
    print(f"- cases: {MIN_CASES}")
    print(f"- artifact cases: {MIN_ARTIFACT_CASES}")
    print(f"- minimum evidence per case: {MIN_EVIDENCE_PER_CASE}")
    return 0


def add_repo_root(repo_roots: dict[str, Path], mapping: str) -> str:
    repository_id, separator, raw_path = mapping.partition("=")
    if not repository_id or not separator or not raw_path:
        return "expected repositoryId=/absolute/or/relative/path"
    repo_roots[repository_id] = Path(raw_path).expanduser().resolve()
    return ""


def validate_schema_files() -> tuple[ValidationIssue, ...]:
    issues: list[ValidationIssue] = []
    for schema_path in SCHEMAS:
        if not schema_path.exists():
            issues.append(ValidationIssue(str(schema_path), "schema file is missing"))
            continue
        loaded = load_json(schema_path)
        match loaded:
            case dict() as schema:
                title = schema.get("title")
                if not isinstance(title, str) or not title:
                    issues.append(ValidationIssue(str(schema_path), "schema title is required"))
            case _:
                issues.append(ValidationIssue(str(schema_path), "schema root must be an object"))
    return tuple(issues)


def validate_cases_file(repo_roots: Mapping[str, Path]) -> tuple[ValidationIssue, ...]:
    if not CASES_FILE.exists():
        return (ValidationIssue(str(CASES_FILE), "cases file is missing"),)

    loaded = load_json(CASES_FILE)
    match loaded:
        case {"cases": list() as raw_cases}:
            parsed = parse_cases(raw_cases)
        case _:
            return (ValidationIssue(str(CASES_FILE), "root must contain cases array"),)

    issues: list[ValidationIssue] = []
    cases = [case for case in parsed if isinstance(case, M0Case)]
    issues.extend(issue for issue in parsed if isinstance(issue, ValidationIssue))

    if len(cases) < MIN_CASES:
        issues.append(ValidationIssue(str(CASES_FILE), f"at least {MIN_CASES} cases are required"))

    decision_cases = 0
    for case in cases:
        if len(case.evidence) < MIN_EVIDENCE_PER_CASE:
            issues.append(ValidationIssue(str(case.case_id), "at least two code evidence entries are required"))
        if case.decision_candidate:
            decision_cases += 1
        issues.extend(validate_evidence(case, repo_roots))

    if decision_cases < MIN_DECISION_CASES:
        issues.append(ValidationIssue(str(CASES_FILE), f"at least {MIN_DECISION_CASES} cases need decision candidates"))

    return tuple(issues)


def parse_cases(raw_cases: list[JsonValue]) -> tuple[M0Case | ValidationIssue, ...]:
    parsed: list[M0Case | ValidationIssue] = []
    for index, raw_case in enumerate(raw_cases):
        path = f"cases[{index}]"
        match raw_case:
            case {
                "caseId": str() as case_id,
                "expectedCapabilities": list() as capabilities,
                "decisionCandidate": str() as decision_candidate,
            }:
                parsed.append(
                    M0Case(
                        case_id=case_id,
                        evidence=parse_evidence(path, capabilities),
                        decision_candidate=decision_candidate,
                    )
                )
            case _:
                parsed.append(ValidationIssue(path, "caseId, expectedCapabilities and decisionCandidate are required"))
    return tuple(parsed)


def parse_evidence(path: str, capabilities: list[JsonValue]) -> tuple[Evidence, ...]:
    evidence_items: list[Evidence] = []
    for capability_index, capability in enumerate(capabilities):
        capability_path = f"{path}.expectedCapabilities[{capability_index}]"
        match capability:
            case {"evidence": list() as raw_evidence}:
                evidence_items.extend(parse_evidence_entries(capability_path, raw_evidence))
            case _:
                continue
    return tuple(evidence_items)


def parse_evidence_entries(path: str, raw_evidence: list[JsonValue]) -> tuple[Evidence, ...]:
    evidence_items: list[Evidence] = []
    for evidence_index, raw_item in enumerate(raw_evidence):
        match raw_item:
            case {
                "repositoryId": str() as repository_id,
                "commitSha": str() as commit_sha,
                "filePath": str() as file_path,
                "symbol": str() as symbol,
                "lineStart": int() as line_start,
                "lineEnd": int() as line_end,
                "claim": str() as claim,
            }:
                evidence_items.append(
                    Evidence(repository_id=repository_id, commit_sha=commit_sha, file_path=file_path, symbol=symbol, line_start=line_start, line_end=line_end, claim=claim)
                )
            case _:
                print(f"warning: skipped invalid evidence shape at {path}.evidence[{evidence_index}]", file=sys.stderr)
    return tuple(evidence_items)


def validate_evidence(case: M0Case, repo_roots: Mapping[str, Path]) -> tuple[ValidationIssue, ...]:
    issues: list[ValidationIssue] = []
    for index, evidence in enumerate(case.evidence):
        path = f"{case.case_id}.evidence[{index}]"
        repository_path = repo_roots.get(evidence.repository_id, ROOT / evidence.repository_id)
        evidence_path = repository_path / evidence.file_path
        if evidence.line_end < evidence.line_start:
            issues.append(ValidationIssue(path, "lineEnd must be greater than or equal to lineStart"))
        if not evidence.repository_id:
            issues.append(ValidationIssue(path, "repositoryId is required"))
        if len(evidence.commit_sha) < 7:
            issues.append(ValidationIssue(path, "commitSha must contain at least 7 characters"))
        if not evidence.file_path:
            issues.append(ValidationIssue(path, "filePath is required"))
        if not evidence.symbol:
            issues.append(ValidationIssue(path, "symbol is required"))
        if not evidence.claim:
            issues.append(ValidationIssue(path, "claim is required"))
        if not repository_path.exists():
            issues.append(ValidationIssue(path, f"repository path does not exist: {repository_path}"))
            continue
        if not commit_exists(repository_path, evidence.commit_sha):
            issues.append(ValidationIssue(path, f"commit does not exist in repository: {evidence.commit_sha}"))
        if not evidence_path.exists():
            issues.append(ValidationIssue(path, f"evidence file does not exist: {evidence.file_path}"))
            continue
        lines = evidence_path.read_text(encoding="utf-8").splitlines()
        if evidence.line_end > len(lines):
            issues.append(ValidationIssue(path, f"lineEnd exceeds file length: {len(lines)}"))
            continue
        selected_lines = lines[evidence.line_start - 1 : evidence.line_end]
        if not symbol_appears_in_lines(evidence.symbol, selected_lines):
            issues.append(ValidationIssue(path, f"symbol is not present in selected evidence lines: {evidence.symbol}"))
    return tuple(issues)


def validate_artifacts() -> tuple[ValidationIssue, ...]:
    if not ARTIFACTS_DIR.exists():
        return (ValidationIssue(str(ARTIFACTS_DIR), "artifact directory is missing"),)
    artifact_paths = sorted(ARTIFACTS_DIR.glob("M0-*.json"))
    issues: list[ValidationIssue] = []
    if len(artifact_paths) < MIN_ARTIFACT_CASES:
        issues.append(ValidationIssue(str(ARTIFACTS_DIR), f"at least {MIN_ARTIFACT_CASES} artifact cases are required"))
    for artifact_path in artifact_paths:
        loaded = load_json(artifact_path)
        match loaded:
            case {
                "caseId": str() as case_id,
                "requirementSpec": dict() as requirement_spec,
                "architectureSpec": {"evidenceRefs": list() as architecture_refs, "decisionCandidates": list() as decision_candidates},
                "decisionRecord": {"decisionId": str() as decision_id, "evidenceRefs": list() as decision_refs},
            }:
                if not requirement_spec.get("businessGoal"):
                    issues.append(ValidationIssue(str(artifact_path), "requirementSpec.businessGoal is required"))
                issues.extend(validate_artifact_refs(str(artifact_path), case_id, architecture_refs, decision_refs))
                if decision_id not in decision_candidates:
                    issues.append(ValidationIssue(str(artifact_path), "architectureSpec must reference decisionRecord.decisionId"))
            case _:
                issues.append(ValidationIssue(str(artifact_path), "artifact must contain caseId, requirementSpec, architectureSpec and decisionRecord"))
    return tuple(issues)


def validate_artifact_refs(path: str, case_id: str, architecture_refs: list[JsonValue], decision_refs: list[JsonValue]) -> tuple[ValidationIssue, ...]:
    issues: list[ValidationIssue] = []
    expected_prefix = f"{case_id}:evidence["
    for ref in [*architecture_refs, *decision_refs]:
        match ref:
            case str() as evidence_ref:
                if not evidence_ref.startswith(expected_prefix):
                    issues.append(ValidationIssue(path, f"evidence ref must belong to case: {evidence_ref}"))
            case _:
                issues.append(ValidationIssue(path, "evidence refs must be strings"))
    return tuple(issues)


def commit_exists(repository_path: Path, commit_sha: str) -> bool:
    result = subprocess.run(["git", "cat-file", "-e", f"{commit_sha}^{{commit}}"], cwd=repository_path, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    return result.returncode == 0


def symbol_appears_in_lines(symbol: str, lines: list[str]) -> bool:
    leaf_symbol = symbol.rsplit(".", maxsplit=1)[-1]
    underscore_symbol = symbol.replace(".", "_")
    selected_text = "\n".join(lines)
    return leaf_symbol in selected_text or underscore_symbol in selected_text


def load_json(path: Path) -> JsonValue:
    with path.open("r", encoding="utf-8") as file:
        loaded = json.load(file)
    return parse_json_value(loaded)


def parse_json_value(value: JsonValue) -> JsonValue:
    return value


if __name__ == "__main__":
    raise SystemExit(main())
