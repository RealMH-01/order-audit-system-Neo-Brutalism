from app.services.audit_engine import (
    AuditEngineService,
    _CUSTOM_RULES_REVIEW_RESULT_SCHEMA_TEXT,
)


def _main_audit_user_prompt() -> str:
    messages = AuditEngineService().build_audit_prompt(
        po_text="[Sheet1!A1] PO No.: PO-001",
        target_text="[Sheet1!F9] Invoice No.: INV-001",
        system_prompt_override="system rules",
    )
    return next(message["content"] for message in messages if message["role"] == "user")


def test_main_audit_prompt_contains_location_hints():
    assert "location_hints" in _main_audit_user_prompt()


def test_main_audit_prompt_warns_against_fabrication():
    user_prompt = _main_audit_user_prompt()

    assert "严禁伪造未在输入中出现过的坐标" in user_prompt
    assert "不要猜" in user_prompt


def test_custom_rules_schema_contains_location_hints_constraints():
    assert "location_hints" in _CUSTOM_RULES_REVIEW_RESULT_SCHEMA_TEXT
    assert "严禁伪造未在输入中出现过的坐标" in _CUSTOM_RULES_REVIEW_RESULT_SCHEMA_TEXT


def test_cross_check_prompt_unchanged_or_does_not_include_new_schema():
    messages = AuditEngineService().build_cross_check_prompt(
        po_text="[Sheet1!A1] PO No.: PO-001",
        target_text="[Sheet1!F9] Invoice No.: INV-001",
        current_result={"issues": []},
        system_prompt_override="system rules",
    )
    user_prompt = next(message["content"] for message in messages if message["role"] == "user")

    assert "严禁伪造未在输入中出现过的坐标" not in user_prompt
