"""YAML-backed document type classifier."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import re
from typing import Any

import yaml

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "document_types.yaml"
REQUIRED_RULE_FIELDS = frozenset(
    {
        "type",
        "label",
        "filename_keywords",
        "content_keywords",
        "content_match_threshold",
    }
)


def reload_rules() -> None:
    """Clear cached document type rules so the next call reloads YAML."""

    _load_rules.cache_clear()


def classify_by_filename(filename: str) -> str | None:
    """Classify a document by filename using configured keywords and regexes."""

    if not filename:
        return None

    original = str(filename)
    stem = Path(original).stem
    keyword_candidates = [
        original,
        original.lower(),
        _normalize_filename_text(original).lower(),
        _normalize_filename_text(stem).lower(),
    ]
    regex_candidates = [original, stem]

    for rule in _load_rules():
        for keyword in rule["filename_keywords"]:
            keyword_text = str(keyword)
            if _is_ascii(keyword_text):
                if any(keyword_text.lower() in candidate for candidate in keyword_candidates):
                    return str(rule["type"])
            elif keyword_text in original:
                return str(rule["type"])

        for pattern in rule.get("filename_regex", []):
            if any(re.search(str(pattern), candidate, re.IGNORECASE) for candidate in regex_candidates):
                return str(rule["type"])

    return None


def classify_by_content(text: str) -> str | None:
    """Classify a document by counting distinct content keyword hits."""

    if not text:
        return None

    original = str(text)
    lowered = original.lower()

    for rule in _load_rules():
        matched_keywords = set()
        for keyword in rule["content_keywords"]:
            keyword_text = str(keyword)
            if _is_ascii(keyword_text):
                matched = keyword_text.lower() in lowered
            else:
                matched = keyword_text in original

            if matched:
                matched_keywords.add(keyword_text)

        if len(matched_keywords) >= rule["content_match_threshold"]:
            return str(rule["type"])

    return None


def detect_document_type(filename: str, text: str = "") -> str:
    """Detect a document type, preferring filename matches over content."""

    return classify_by_filename(filename) or classify_by_content(text) or "other"


@lru_cache(maxsize=1)
def _load_rules() -> list[dict[str, Any]]:
    if not CONFIG_PATH.exists():
        raise RuntimeError(f"Document type config file not found: {CONFIG_PATH}")

    try:
        with CONFIG_PATH.open("r", encoding="utf-8") as config_file:
            data = yaml.safe_load(config_file)
    except yaml.YAMLError as exc:
        raise RuntimeError(f"Document type YAML format error in {CONFIG_PATH}: {exc}") from exc
    except OSError as exc:
        raise RuntimeError(f"Unable to read document type config {CONFIG_PATH}: {exc}") from exc

    return _validate_config(data)


def _validate_config(data: Any) -> list[dict[str, Any]]:
    if not isinstance(data, dict) or "document_types" not in data:
        raise RuntimeError("Document type config must contain top-level 'document_types'.")

    rules = data["document_types"]
    if not isinstance(rules, list) or not rules:
        raise RuntimeError("Document type config 'document_types' must be a non-empty list.")

    validated_rules = []
    for index, rule in enumerate(rules):
        if not isinstance(rule, dict):
            raise RuntimeError(f"Document type rule at index {index} must be a mapping.")

        rule_type = rule.get("type", f"index {index}")
        missing_fields = REQUIRED_RULE_FIELDS - set(rule)
        if missing_fields:
            fields = ", ".join(sorted(missing_fields))
            raise RuntimeError(f"Document type rule '{rule_type}' is missing required fields: {fields}.")

        if not isinstance(rule["type"], str) or not rule["type"].strip():
            raise RuntimeError(f"Document type rule '{rule_type}' has invalid type.")
        if not isinstance(rule["label"], str) or not rule["label"].strip():
            raise RuntimeError(f"Document type rule '{rule_type}' has invalid label.")
        if not _is_string_list(rule["filename_keywords"]):
            raise RuntimeError(f"Document type rule '{rule_type}' filename_keywords must be a list of strings.")
        if not _is_string_list(rule["content_keywords"]):
            raise RuntimeError(f"Document type rule '{rule_type}' content_keywords must be a list of strings.")
        if "filename_regex" in rule and not _is_string_list(rule["filename_regex"]):
            raise RuntimeError(f"Document type rule '{rule_type}' filename_regex must be a list of strings.")
        if type(rule["content_match_threshold"]) is not int or rule["content_match_threshold"] <= 0:
            raise RuntimeError(f"Document type rule '{rule_type}' content_match_threshold must be a positive integer.")

        normalized_rule = dict(rule)
        normalized_rule.setdefault("filename_regex", [])
        validated_rules.append(normalized_rule)

    return validated_rules


def _is_string_list(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def _is_ascii(value: str) -> bool:
    return value.isascii()


def _normalize_filename_text(value: str) -> str:
    return re.sub(r"[-\s]+", "_", value)
