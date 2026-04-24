from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.dependencies import get_audit_orchestrator_service, get_current_user
from app.models.schemas import (
    AuditCapability,
    AuditCancelResponse,
    AuditHistoryDetailResponse,
    AuditHistoryListResponse,
    AuditReportResponse,
    AuditResultResponse,
    AuditStartRequest,
    AuditStartResponse,
    CurrentUser,
)
from app.services.audit_orchestrator import AuditOrchestratorService

router = APIRouter()


def _build_report_download_response(
    current_user: CurrentUser,
    service: AuditOrchestratorService,
    task_id: str,
    report_type: str,
) -> StreamingResponse:
    file_obj, filename, media_type = service.get_report_download(current_user, task_id, report_type)
    return StreamingResponse(
        file_obj,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/capabilities", response_model=AuditCapability, summary="审核能力说明")
async def get_audit_capabilities(
    service: AuditOrchestratorService = Depends(get_audit_orchestrator_service),
) -> AuditCapability:
    return service.get_capability()


@router.post("/start", response_model=AuditStartResponse)
async def start_audit(
    payload: AuditStartRequest,
    current_user: CurrentUser = Depends(get_current_user),
    service: AuditOrchestratorService = Depends(get_audit_orchestrator_service),
) -> AuditStartResponse:
    return service.start_audit(current_user, payload)


@router.get("/progress/{task_id}")
async def get_audit_progress(
    task_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: AuditOrchestratorService = Depends(get_audit_orchestrator_service),
):
    return StreamingResponse(
        service.progress_stream(current_user, task_id),
        media_type="text/event-stream",
    )


@router.post("/cancel/{task_id}", response_model=AuditCancelResponse)
async def cancel_audit(
    task_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: AuditOrchestratorService = Depends(get_audit_orchestrator_service),
) -> AuditCancelResponse:
    return service.cancel_task(current_user, task_id)


@router.get("/result/{task_id}", response_model=AuditResultResponse)
async def get_audit_result(
    task_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: AuditOrchestratorService = Depends(get_audit_orchestrator_service),
) -> AuditResultResponse:
    return service.get_result(current_user, task_id)


@router.get("/report/{task_id}", response_model=AuditReportResponse)
async def get_audit_report(
    task_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: AuditOrchestratorService = Depends(get_audit_orchestrator_service),
) -> AuditReportResponse:
    return service.get_report_placeholder(current_user, task_id)


@router.get("/tasks/{task_id}/reports/marked")
async def download_marked_report(
    task_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: AuditOrchestratorService = Depends(get_audit_orchestrator_service),
) -> StreamingResponse:
    return _build_report_download_response(current_user, service, task_id, "marked")


@router.get("/tasks/{task_id}/reports/detailed")
async def download_detailed_report(
    task_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: AuditOrchestratorService = Depends(get_audit_orchestrator_service),
) -> StreamingResponse:
    return _build_report_download_response(current_user, service, task_id, "detailed")


@router.get("/tasks/{task_id}/reports/zip")
async def download_report_zip(
    task_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: AuditOrchestratorService = Depends(get_audit_orchestrator_service),
) -> StreamingResponse:
    return _build_report_download_response(current_user, service, task_id, "zip")


@router.get("/history", response_model=AuditHistoryListResponse)
async def get_audit_history(
    current_user: CurrentUser = Depends(get_current_user),
    service: AuditOrchestratorService = Depends(get_audit_orchestrator_service),
) -> AuditHistoryListResponse:
    return service.get_history(current_user)


@router.get("/history/{history_id}", response_model=AuditHistoryDetailResponse)
async def get_audit_history_detail(
    history_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: AuditOrchestratorService = Depends(get_audit_orchestrator_service),
) -> AuditHistoryDetailResponse:
    return service.get_history_detail(current_user, history_id)
