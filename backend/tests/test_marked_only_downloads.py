import io
import sys
import zipfile
from pathlib import Path

import pytest
from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.errors import AppError
from app.models.schemas import CurrentUser
from app.routers.audit import _build_report_download_response
from app.services.audit_orchestrator import AuditOrchestratorService
from app.services.file_parser import FileParserService
from app.services.llm_client import LLMClientService
from app.services.report_generator import ReportGeneratorService
from app.services.runtime_store import RuntimeStore
from app.services.token_utils import TokenUtilityService


def _save_workbook(path: Path) -> Path:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Sheet1"
    sheet["F9"] = "HR-EXP250401"
    workbook.save(path)
    return path


def _issue(file_id: str = "xlsx-1", file_name: str = "CI-HR-EXP2504001.xlsx") -> dict:
    return {
        "id": "R-01",
        "level": "RED",
        "field_name": "invoice_no",
        "finding": "发票号不一致",
        "suggestion": "请核对原始单据",
        "confidence": 0.98,
        "file_id": file_id,
        "mark_status": "marked",
        "mark_reason_code": "MARKED",
        "locations": [
            {
                "file_id": file_id,
                "file_name": file_name,
                "sheet": "Sheet1",
                "cell": "F9",
                "confidence": 0.98,
            }
        ],
    }


def _audit_result(issues: list[dict]) -> dict:
    return {"confidence": 0.91, "summary": {"red": len(issues), "yellow": 0, "blue": 0}, "issues": issues}


def _context(source: Path, *, include_po: bool = True) -> dict:
    uploaded_files = []
    original_xlsx_paths = {"xlsx-1": str(source)}
    if include_po:
        po_path = source.with_name("PO-HR-EXP2504001.xlsx")
        _save_workbook(po_path)
        uploaded_files.append(
            {
                "id": "po-1",
                "filename": po_path.name,
                "extension": "xlsx",
                "original_xlsx_path": str(po_path),
            }
        )
        original_xlsx_paths["po-1"] = str(po_path)
    uploaded_files.append(
        {
            "id": "xlsx-1",
            "filename": source.name,
            "extension": "xlsx",
            "original_xlsx_path": str(source),
        }
    )
    return {"uploaded_files": uploaded_files, "original_xlsx_paths": original_xlsx_paths}


def _service(store: RuntimeStore | None = None, repo=None) -> AuditOrchestratorService:
    settings = Settings()
    runtime_store = store or RuntimeStore()
    return AuditOrchestratorService(
        settings,
        FileParserService(settings, runtime_store),
        LLMClientService(settings),
        ReportGeneratorService(),
        TokenUtilityService(),
        runtime_store,
        repo=repo,
    )


def _user() -> CurrentUser:
    return CurrentUser(id="user-1", email="user@example.com")


def _zip_names(file_obj: io.BytesIO) -> list[str]:
    with zipfile.ZipFile(file_obj) as zip_file:
        return zip_file.namelist()


def test_generate_marked_only_zip_returns_zip_with_only_marked_workbooks(tmp_path):
    source = _save_workbook(tmp_path / "CI-HR-EXP2504001.xlsx")

    marked_zip = ReportGeneratorService().generate_marked_only_zip(
        "task-marked-1",
        _audit_result([_issue(file_name=source.name)]),
        _context(source),
    )

    names = _zip_names(marked_zip)
    assert len(names) == 1
    assert names[0].startswith("标记版/审核标记版-CI-HR-EXP2504001-")
    assert names[0].endswith(".xlsx")
    assert not any("审核详情版-" in name for name in names)
    assert "任务信息.txt" not in names
    assert "manifest.json" not in names
    assert not any("PO-HR-EXP2504001" in name for name in names)


def test_marked_download_response_uses_zip_media_type_and_filenames(tmp_path):
    source = _save_workbook(tmp_path / "CI-HR-EXP2504001.xlsx")
    report_bundle = ReportGeneratorService().generate_report_bundle(
        "task-marked-2",
        _audit_result([_issue(file_name=source.name)]),
        _context(source),
    )
    store = RuntimeStore()
    store.audit_tasks["task-marked-2"] = {
        "user_id": "user-1",
        "status": "completed",
        "target_files": [{"file_id": "xlsx-1"}],
        "original_xlsx_paths": {"xlsx-1": str(source)},
        "report_bundle": report_bundle,
    }

    file_obj, filename, media_type = _service(store).get_report_download(_user(), "task-marked-2", "marked")

    assert media_type == "application/zip"
    assert filename.startswith("审核标记版-")
    assert filename.endswith(".zip")
    assert _zip_names(file_obj) == [
        name
        for name in _zip_names(report_bundle["marked_report"])
        if name.startswith("标记版/审核标记版-") and name.endswith(".xlsx")
    ]


def test_marked_route_content_disposition_uses_zip_fallback_and_utf8_filename():
    class DummyService:
        def get_report_download(self, current_user, task_id, report_type):
            return io.BytesIO(b"zip"), "审核标记版-HR-EXP250401-20260429-1555.zip", "application/zip"

    response = _build_report_download_response(_user(), DummyService(), "task-marked-3", "marked")

    assert response.media_type == "application/zip"
    content_disposition = response.headers["content-disposition"]
    assert 'filename="audit_marked.zip"' in content_disposition
    assert "filename*=UTF-8''" in content_disposition
    assert content_disposition.endswith(".zip")


@pytest.mark.parametrize(
    ("task", "files", "expected_reason"),
    [
        (
            {"target_files": [{"file_id": "pdf-1"}], "original_xlsx_paths": {}},
            {"pdf-1": {"filename": "报关单.pdf", "extension": "pdf"}},
            "ONLY_UNSUPPORTED_FILES",
        ),
        (
            {"target_files": [{"file_id": "xlsx-1"}], "original_xlsx_paths": {"xlsx-1": "missing.xlsx"}},
            {"xlsx-1": {"filename": "发票.xlsx", "extension": "xlsx"}},
            "NO_MARKED_WORKBOOK",
        ),
    ],
)
def test_marked_download_raises_409_for_unavailable_current_task(task, files, expected_reason):
    store = RuntimeStore()
    store.files.update(files)
    store.audit_tasks["task-no-marked"] = {
        "user_id": "user-1",
        "status": "completed",
        "report_bundle": {"detailed_report": io.BytesIO(b"xlsx"), "report_zip": io.BytesIO(b"zip"), "filenames": {}},
        **task,
    }

    with pytest.raises(AppError) as exc_info:
        _service(store).get_report_download(_user(), "task-no-marked", "marked")

    assert exc_info.value.status_code == 409
    assert exc_info.value.reason_code == expected_reason
    assert exc_info.value.message["reason_code"] == expected_reason


def test_generate_marked_only_zip_raises_409_without_empty_zip_for_all_pdf():
    context = {"uploaded_files": [{"id": "pdf-1", "filename": "报关单.pdf", "extension": "pdf"}]}

    with pytest.raises(AppError) as exc_info:
        ReportGeneratorService().generate_marked_only_zip("task-pdf", _audit_result([]), context)

    assert exc_info.value.status_code == 409
    assert exc_info.value.reason_code == "ONLY_UNSUPPORTED_FILES"


class _HistoryRepo:
    def __init__(self, data: bytes | None, report_paths: dict | None = None) -> None:
        self.data = data
        self.report_paths = report_paths or {"marked": "user-1/task-history/marked.xlsx"}

    def get_audit_history_by_task_id(self, user_id: str, task_id: str):
        return {"task_id": task_id, "report_paths": self.report_paths}

    def download_report_file(self, bucket: str, path: str):
        return self.data


def test_legacy_history_marked_download_rejects_old_summary_xlsx():
    old_summary = ReportGeneratorService().generate_marked_report("task-history", _audit_result([])).getvalue()

    with pytest.raises(AppError) as exc_info:
        _service(repo=_HistoryRepo(old_summary)).get_report_download(_user(), "task-history", "marked")

    assert exc_info.value.status_code == 409
    assert exc_info.value.reason_code == "LEGACY_TASK_NO_MARKED_WORKBOOK"


def test_history_marked_download_wraps_persisted_marked_workbook_path():
    service = _service(
        repo=_HistoryRepo(
            b"xlsx-bytes",
            {"marked": "user-1/task-history/审核标记版-CI-HR-EXP2504001-20260429-1555.xlsx"},
        )
    )

    file_obj, filename, media_type = service.get_report_download(_user(), "task-history", "marked")

    assert media_type == "application/zip"
    assert filename.endswith(".zip")
    assert _zip_names(file_obj) == ["标记版/审核标记版-CI-HR-EXP2504001-20260429-1555.xlsx"]


def test_history_marked_download_without_marked_artifacts_raises_409():
    with pytest.raises(AppError) as exc_info:
        _service(repo=_HistoryRepo(None, {"detailed": "user-1/task-history/detailed.xlsx"})).get_report_download(
            _user(),
            "task-history",
            "marked",
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.reason_code == "LEGACY_TASK_NO_MARKED_WORKBOOK"
