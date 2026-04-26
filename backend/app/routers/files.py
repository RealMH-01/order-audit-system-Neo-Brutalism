from fastapi import APIRouter, Body, Depends, File, UploadFile

from app.dependencies import get_current_user, get_file_parser_service
from app.models.schemas import (
    CurrentUser,
    FileBulkDeleteRequest,
    FileBulkDeleteResponse,
    FileCapability,
    FileDeleteResponse,
    FileListResponse,
    FileUploadResponse,
)
from app.services.file_parser import FileParserService

router = APIRouter()


@router.get("/capabilities", response_model=FileCapability, summary="文件能力说明")
async def get_file_capabilities(
    service: FileParserService = Depends(get_file_parser_service),
) -> FileCapability:
    return service.get_capability()


@router.get("/mine", response_model=FileListResponse)
async def list_my_files(
    current_user: CurrentUser = Depends(get_current_user),
    service: FileParserService = Depends(get_file_parser_service),
) -> FileListResponse:
    return FileListResponse(files=service.list_user_files(current_user.id))


@router.delete("/mine", response_model=FileBulkDeleteResponse)
async def delete_my_files(
    payload: FileBulkDeleteRequest | None = Body(default=None),
    current_user: CurrentUser = Depends(get_current_user),
    service: FileParserService = Depends(get_file_parser_service),
) -> FileBulkDeleteResponse:
    if payload and payload.file_ids is not None:
        file_ids = payload.file_ids
    else:
        file_ids = [file.id for file in service.list_user_files(current_user.id)]
    deleted_count = service.delete_files_by_ids(current_user.id, file_ids)
    return FileBulkDeleteResponse(deleted_count=deleted_count)


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
