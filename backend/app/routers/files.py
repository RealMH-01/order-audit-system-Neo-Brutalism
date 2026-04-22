from fastapi import APIRouter, Depends, File, UploadFile

from app.dependencies import get_current_user, get_file_parser_service
from app.models.schemas import (
    CurrentUser,
    FileCapability,
    FileDeleteResponse,
    FileUploadResponse,
)
from app.services.file_parser import FileParserService

router = APIRouter()


@router.get("/capabilities", response_model=FileCapability, summary="文件能力说明")
async def get_file_capabilities(
    service: FileParserService = Depends(get_file_parser_service),
) -> FileCapability:
    return service.get_capability()


@router.post("/upload", response_model=FileUploadResponse)
async def upload_file(
    upload: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
    service: FileParserService = Depends(get_file_parser_service),
) -> FileUploadResponse:
    file_record = await service.upload_file(current_user.id, upload)
    return FileUploadResponse(file=file_record, message="文件上传成功。")


@router.post("/{file_id}/replace", response_model=FileUploadResponse)
async def replace_file(
    file_id: str,
    upload: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
    service: FileParserService = Depends(get_file_parser_service),
) -> FileUploadResponse:
    file_record = await service.replace_file(current_user.id, file_id, upload)
    return FileUploadResponse(file=file_record, message="文件替换成功。")


@router.delete("/{file_id}", response_model=FileDeleteResponse)
async def delete_file(
    file_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: FileParserService = Depends(get_file_parser_service),
) -> FileDeleteResponse:
    service.delete_file(current_user.id, file_id)
    return FileDeleteResponse(file_id=file_id, message="文件已删除。")
