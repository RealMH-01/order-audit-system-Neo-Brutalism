import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.errors import AppError
from app.services import audit_orchestrator as audit_orchestrator_module
from app.services.audit_engine import build_audit_system_prompt
from app.services.audit_orchestrator import AuditOrchestratorService


_MISSING = object()


def make_rule(
    code: str,
    title: str,
    content: str,
    sort_order: int | None | object = _MISSING,
) -> dict:
    rule = {
        "id": f"{code}-id",
        "code": code,
        "title": title,
        "content": content,
    }
    if sort_order is not _MISSING:
        rule["sort_order"] = sort_order
    return rule


def title_position(prompt: str, title: str) -> int:
    return prompt.index(f"【{title}】")


def test_build_audit_system_prompt_empty_raises():
    with pytest.raises(AppError) as exc_info:
        build_audit_system_prompt([])

    assert exc_info.value.status_code == 500
    assert "系统硬规则未配置" in str(exc_info.value.message)


def test_build_audit_system_prompt_orders_by_sort_order():
    prompt = build_audit_system_prompt(
        [
            make_rule("rule_300", "三百规则", "300 content", 300),
            make_rule("rule_100", "一百规则", "100 content", 100),
            make_rule("rule_200", "二百规则", "200 content", 200),
        ]
    )

    assert title_position(prompt, "一百规则") < title_position(prompt, "二百规则")
    assert title_position(prompt, "二百规则") < title_position(prompt, "三百规则")
    assert "【一百规则】\n100 content" in prompt
    assert "【二百规则】\n200 content" in prompt
    assert "【三百规则】\n300 content" in prompt


def test_build_audit_system_prompt_handles_missing_sort_order():
    prompt = build_audit_system_prompt(
        [
            make_rule("rule_20", "二十规则", "20 content", 20),
            make_rule("rule_none", "空排序规则", "none content", None),
            make_rule("rule_missing", "缺失排序规则", "missing content"),
        ]
    )

    assert title_position(prompt, "空排序规则") < title_position(prompt, "二十规则")
    assert title_position(prompt, "缺失排序规则") < title_position(prompt, "二十规则")
    assert "【空排序规则】\nnone content" in prompt
    assert "【缺失排序规则】\nmissing content" in prompt


def test_audit_orchestrator_loads_rules_from_db():
    rules = [
        make_rule("rule_2", "规则二", "content 2", 20),
        make_rule("rule_1", "规则一", "content 1", 10),
    ]
    repo = Mock()
    repo.list_system_hard_rules.return_value = rules
    service = AuditOrchestratorService.__new__(AuditOrchestratorService)
    service.repo = repo

    prompt = service._load_audit_system_prompt("task-123")

    repo.list_system_hard_rules.assert_called_once_with(enabled_only=True)
    assert title_position(prompt, "规则一") < title_position(prompt, "规则二")
    assert "content 1" in prompt
    assert "content 2" in prompt


def test_audit_orchestrator_logs_rule_count(monkeypatch):
    rules = [
        make_rule("rule_a", "规则 A", "content A", 10),
        make_rule("rule_b", "规则 B", "content B", 20),
    ]
    repo = Mock()
    repo.list_system_hard_rules.return_value = rules
    service = AuditOrchestratorService.__new__(AuditOrchestratorService)
    service.repo = repo
    logger = Mock()
    monkeypatch.setattr(audit_orchestrator_module, "logger", logger)

    service._load_audit_system_prompt("task-456")

    logger.info.assert_called_once()
    args = logger.info.call_args.args
    assert "AUDIT_SYSTEM_PROMPT_LOADED" in args[0]
    assert args[1] == "task-456"
    assert args[2] == 2
    assert args[3] == ["rule_a-id", "rule_b-id"]
    assert args[4] == ["rule_a", "rule_b"]
