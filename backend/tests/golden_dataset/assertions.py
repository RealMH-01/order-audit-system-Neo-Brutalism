from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


LEVELS = ("red", "yellow", "blue")


@dataclass
class CaseAssertionResult:
    case_id: str
    status: str
    tested_rules: list[str]
    expected_summary: dict[str, int]
    actual_summary: dict[str, int]
    missing_expected_issues: list[dict[str, Any]] = field(default_factory=list)
    forbidden_issues: list[dict[str, Any]] = field(default_factory=list)
    summary_failures: list[str] = field(default_factory=list)
    actual_issues: list[dict[str, Any]] = field(default_factory=list)
    error_message: str | None = None
    task_id: str | None = None
    last_progress: dict[str, Any] | None = None

    @property
    def passed(self) -> bool:
        return self.status == "PASS"


def compare_result(
    *,
    expected: dict[str, Any],
    actual: dict[str, Any],
    task_id: str | None = None,
) -> CaseAssertionResult:
    case_id = str(expected.get("case_id", "unknown_case"))
    actual_summary = normalize_summary(actual.get("summary") or {})
    expected_summary = expected.get("expected_summary") or {}
    issues = actual.get("issues") or []
    if not isinstance(issues, list):
        issues = []

    summary_failures = check_summary(actual_summary, expected_summary)
    missing_expected = [
        item
        for item in expected.get("expected_issues", [])
        if not expected_issue_matched(item, issues)
    ]
    forbidden = find_forbidden_issues(expected.get("must_not_contain", []), issues)

    status = "PASS" if not summary_failures and not missing_expected and not forbidden else "FAIL"
    return CaseAssertionResult(
        case_id=case_id,
        status=status,
        tested_rules=list(expected.get("tested_rules") or []),
        expected_summary=dict(expected_summary),
        actual_summary=actual_summary,
        missing_expected_issues=missing_expected,
        forbidden_issues=forbidden,
        summary_failures=summary_failures,
        actual_issues=issues,
        task_id=task_id or actual.get("task_id"),
    )


def error_result(
    *,
    expected: dict[str, Any],
    message: str,
    task_id: str | None = None,
    last_progress: dict[str, Any] | None = None,
) -> CaseAssertionResult:
    return CaseAssertionResult(
        case_id=str(expected.get("case_id", "unknown_case")),
        status="ERROR",
        tested_rules=list(expected.get("tested_rules") or []),
        expected_summary=dict(expected.get("expected_summary") or {}),
        actual_summary={"red": 0, "yellow": 0, "blue": 0},
        error_message=message,
        task_id=task_id,
        last_progress=last_progress,
    )


def normalize_summary(summary: dict[str, Any]) -> dict[str, int]:
    normalized: dict[str, int] = {}
    for level in LEVELS:
        value = summary.get(level, summary.get(level.upper(), 0))
        try:
            normalized[level] = int(value)
        except (TypeError, ValueError):
            normalized[level] = 0
    return normalized


def check_summary(actual: dict[str, int], expected_summary: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    for level in LEVELS:
        actual_value = actual.get(level, 0)
        min_value = int(expected_summary.get(f"{level}_min", 0))
        max_value = int(expected_summary.get(f"{level}_max", 999999))
        if actual_value < min_value or actual_value > max_value:
            failures.append(f"{level.upper()} 实际 {actual_value}，期望区间 {min_value}-{max_value}")
    return failures


def expected_issue_matched(expected_issue: dict[str, Any], actual_issues: list[dict[str, Any]]) -> bool:
    expected_level = str(expected_issue.get("expected_level", "")).upper()
    field_keywords = as_keywords(expected_issue.get("expected_field_name_keywords"))
    content_keywords = as_keywords(expected_issue.get("must_contain_keywords"))

    for issue in actual_issues:
        if str(issue.get("level", "")).upper() != expected_level:
            continue
        combined = issue_text(issue)
        if field_keywords and not contains_any(combined, field_keywords):
            continue
        if content_keywords and not contains_any(combined, content_keywords):
            continue
        return True
    return False


def find_forbidden_issues(
    must_not_contain: list[dict[str, Any]],
    actual_issues: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for rule in must_not_contain:
        level = str(rule.get("level", "")).upper()
        keywords = as_keywords(rule.get("field_name_keywords"))
        for issue in actual_issues:
            if str(issue.get("level", "")).upper() != level:
                continue
            field_name = str(issue.get("field_name", ""))
            if contains_any(field_name, keywords):
                found.append({"must_not": rule, "actual_issue": issue})
    return found


def issue_text(issue: dict[str, Any]) -> str:
    parts = [
        issue.get("field_name", ""),
        issue.get("finding", ""),
        issue.get("message", ""),
        issue.get("suggestion", ""),
        issue.get("document_label", ""),
    ]
    return " ".join(str(part) for part in parts if part is not None)


def contains_any(text: str, keywords: list[str]) -> bool:
    lowered = text.lower()
    return any(keyword.lower() in lowered for keyword in keywords)


def as_keywords(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    return [str(item) for item in value if str(item)]
