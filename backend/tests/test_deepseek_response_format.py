import asyncio
import inspect
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.config import Settings
from app.errors import AppError
from app.services import llm_client as llm_client_module
from app.services.audit_orchestrator import AuditOrchestratorService
from app.services.llm_client import LLMClientService


def _settings(**overrides):
    return Settings(_env_file=None, **overrides)


def _make_orchestrator(settings: Settings) -> AuditOrchestratorService:
    token_utils = MagicMock()
    token_utils.get_safe_token_limit.return_value = 4096
    return AuditOrchestratorService(
        settings=settings,
        file_parser=MagicMock(),
        llm_client=MagicMock(),
        report_generator=MagicMock(),
        token_utils=token_utils,
        store=MagicMock(),
        repo=None,
    )


def _response(content):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content),
            )
        ]
    )


def _install_fake_openai(monkeypatch, outcomes):
    calls = []

    class FakeCompletions:
        def create(self, **kwargs):
            calls.append(kwargs)
            outcome = outcomes.pop(0)
            if isinstance(outcome, BaseException):
                raise outcome
            return _response(outcome)

    class FakeOpenAI:
        def __init__(self, **kwargs):
            self.init_kwargs = kwargs
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setattr(llm_client_module, "OpenAI", FakeOpenAI)
    return calls


def _call_deepseek(client: LLMClientService, **kwargs):
    return asyncio.run(
        client.call_llm(
            [{"role": "user", "content": "Return JSON."}],
            provider="deepseek",
            requested_model="deepseek-v4-flash",
            api_key="test-key",
            **kwargs,
        )
    )


def test_response_format_disabled_by_default(monkeypatch):
    monkeypatch.delenv("ENABLE_RESPONSE_FORMAT", raising=False)
    settings = _settings()
    orchestrator = _make_orchestrator(settings)

    assert settings.enable_response_format is False
    assert orchestrator._build_deepseek_response_format("deepseek") is None


def test_deepseek_response_format_enabled():
    orchestrator = _make_orchestrator(_settings(enable_response_format=True))

    assert orchestrator._build_deepseek_response_format("deepseek") == {"type": "json_object"}


def test_non_deepseek_response_format_disabled():
    orchestrator = _make_orchestrator(_settings(enable_response_format=True))

    assert orchestrator._build_deepseek_response_format("openai") is None
    assert orchestrator._build_deepseek_response_format("zhipu") is None
    assert orchestrator._build_deepseek_response_format("") is None
    assert orchestrator._build_deepseek_response_format(None) is None


def test_call_llm_without_response_format_keeps_original_kwargs(monkeypatch):
    calls = _install_fake_openai(monkeypatch, ['{"issues": []}'])
    client = LLMClientService(_settings())

    result = _call_deepseek(client, response_format=None)

    assert result == '{"issues": []}'
    assert "response_format" not in calls[0]


def test_deepseek_response_format_passed_to_client(monkeypatch):
    calls = _install_fake_openai(monkeypatch, ['{"issues": []}'])
    client = LLMClientService(_settings())

    result = _call_deepseek(client, response_format={"type": "json_object"})

    assert result == '{"issues": []}'
    assert calls[0]["response_format"] == {"type": "json_object"}


def test_response_format_error_retries_without_response_format(monkeypatch):
    calls = _install_fake_openai(
        monkeypatch,
        [Exception("response_format json_object is not supported"), '{"issues": []}'],
    )
    client = LLMClientService(_settings())

    result = _call_deepseek(client, response_format={"type": "json_object"})

    assert result == '{"issues": []}'
    assert calls[0]["response_format"] == {"type": "json_object"}
    assert "response_format" not in calls[1]
    assert len(calls) == 2


def test_empty_content_retries_without_response_format(monkeypatch):
    calls = _install_fake_openai(monkeypatch, ["", '{"issues": []}'])
    client = LLMClientService(_settings())

    result = _call_deepseek(client, response_format={"type": "json_object"})

    assert result == '{"issues": []}'
    assert calls[0]["response_format"] == {"type": "json_object"}
    assert "response_format" not in calls[1]
    assert len(calls) == 2


def test_non_response_format_error_does_not_retry(monkeypatch):
    calls = _install_fake_openai(monkeypatch, [Exception("401 invalid api key")])
    client = LLMClientService(_settings())

    with pytest.raises(AppError) as exc_info:
        _call_deepseek(client, response_format={"type": "json_object"})

    assert exc_info.value.status_code == 401
    assert len(calls) == 1
    assert calls[0]["response_format"] == {"type": "json_object"}


def test_default_disabled_single_target_audit_passes_none_response_format():
    settings = _settings(enable_response_format=False)
    service = _make_orchestrator(settings)
    service.llm_client.call_llm = AsyncMock(return_value='{"issues": []}')
    service._get_profile = MagicMock(return_value={"deepseek_api_key": "test-key"})
    service._ensure_runtime_file = MagicMock(
        return_value={
            "id": "target-file",
            "filename": "invoice.xlsx",
            "extension": "xlsx",
            "text": "target text",
            "needs_ocr": False,
        }
    )
    service._resolve_doc_type = MagicMock(return_value="invoice")
    service._collect_previous_ticket_text = MagicMock(return_value="")
    service._require_profile_api_key = MagicMock(return_value="test-key")
    service._llm_text_for_record = MagicMock(side_effect=lambda _task, record: str(record.get("text") or ""))
    service._prepare_text_context = MagicMock(side_effect=lambda text, _model, _budget: (text, False))
    service._log_diag_text = MagicMock()
    service._build_evidence_block = MagicMock(return_value="")
    service.audit_engine = MagicMock()
    service.audit_engine.build_audit_prompt.return_value = [{"role": "user", "content": "Return JSON."}]
    service.audit_engine.parse_audit_result.return_value = {"issues": []}
    service._store_raw_llm_issues = MagicMock()
    service._post_process_force_downgrade = MagicMock(side_effect=lambda result, _affiliates: result)
    service._post_process_evidence_and_identifiers = MagicMock(side_effect=lambda result, **_kwargs: result)
    service._attach_document_context = MagicMock(side_effect=lambda result, *_args: result)
    service._resolve_issue_locations_for_result = MagicMock(side_effect=lambda result, _task: result)

    asyncio.run(
        service._run_single_target_audit(
            user_id="user-1",
            index=0,
            target_item={"file_id": "target-file", "document_type": "invoice"},
            task={"po_file_id": "po-file"},
            po_record={"id": "po-file", "text": "po text"},
            prev_records=[],
            template_record=None,
            reference_records=[],
            selected_model="deepseek-v4-flash",
            primary_provider="deepseek",
            target_count=1,
            deep_think=False,
            custom_rules=[],
            audit_rules_text="",
            system_prompt="system",
            company_affiliates=[],
            should_cancel=None,
            progress_callback=None,
        )
    )

    assert service.llm_client.call_llm.await_args.kwargs["response_format"] is None


def test_image_call_not_changed():
    signature = inspect.signature(LLMClientService.call_llm_with_image)

    assert "response_format" not in signature.parameters
