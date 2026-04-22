"""提供文件上传、替换、删除和预览解析的最小闭环。"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.config import Settings
from app.errors import AppError
from app.models.schemas import FeatureStatus, FileCapability, FileRecord
from app.services.runtime_store import RuntimeStore


class FileParserService:
    """管理文件暂存与最小预览解析，不在本轮实现复杂 OCR。"""

    def __init__(self, settings: Settings, store: RuntimeStore) -> None:
        self.settings = settings
        self.store = store
        self.max_files_per_user = 10

    def get_capability(self) -> FileCapability:
        return FileCapability(
            supported_types=["pdf", "docx", "xlsx", "png", "jpg", "jpeg", "txt"],
            features=[
                FeatureStatus(
                    name="文件上传入口",
                    ready=True,
                    note="已提供内存态文件上传、替换和删除最小闭环。",
                ),
                FeatureStatus(
                    name="复杂解析与 OCR",
                    ready=False,
                    note="本轮不实现复杂 OCR，只提供预览解析和类型识别。",
                ),
            ],
        )

    async def upload_file(self, user_id: str, file: UploadFile) -> FileRecord:
        """上传文件并保存到内存态存储。"""

        self._ensure_user_file_limit(user_id)
        file_record = await self.parse_file(file)
        self.store.files[file_record.id] = {**file_record.model_dump(), "user_id": user_id}
        return file_record

    async def replace_file(self, user_id: str, file_id: str, file: UploadFile) -> FileRecord:
        """替换已有文件内容并保留原 file_id。"""

        existing = self._get_user_file_data(user_id, file_id)
        new_record = await self.parse_file(file, file_id=file_id)
        self.store.files[file_id] = {
            **new_record.model_dump(),
            "user_id": user_id,
            "created_from": existing["filename"],
        }
        return new_record

    def delete_file(self, user_id: str, file_id: str) -> None:
        """删除当前用户的一个暂存文件。"""

        self._get_user_file_data(user_id, file_id)
        del self.store.files[file_id]

    def get_user_file(self, user_id: str, file_id: str) -> dict[str, object]:
        """读取当前用户的文件原始记录。"""

        return self._get_user_file_data(user_id, file_id)

    async def parse_file(self, file: UploadFile, file_id: str | None = None) -> FileRecord:
        """对上传文件执行最小预览解析。"""

        content = await file.read()
        if not content:
            raise AppError("上传失败，文件内容不能为空。", status_code=400)

        filename = file.filename or "unnamed-file"
        extension = Path(filename).suffix.lower().lstrip(".")
        detected_type = self._detect_type(filename, extension)
        preview_text = self._build_preview_text(content, detected_type)

        return FileRecord(
            id=file_id or str(uuid4()),
            filename=filename,
            content_type=file.content_type or "application/octet-stream",
            size_bytes=len(content),
            detected_type=detected_type,
            preview_text=preview_text,
            uploaded_at=datetime.now(timezone.utc),
        )

    def _ensure_user_file_limit(self, user_id: str) -> None:
        file_count = sum(1 for item in self.store.files.values() if item.get("user_id") == user_id)
        if file_count >= self.max_files_per_user:
            raise AppError("单个用户最多暂存 10 个文件，请先删除不需要的文件。", status_code=400)

    def _get_user_file_data(self, user_id: str, file_id: str) -> dict[str, object]:
        file_data = self.store.files.get(file_id)
        if not file_data or file_data.get("user_id") != user_id:
            raise AppError("未找到指定文件，或你无权访问该文件。", status_code=404)
        return file_data

    @staticmethod
    def _detect_type(filename: str, extension: str) -> str:
        name = filename.lower()
        if "po" in name:
            return "po"
        if "invoice" in name:
            return "invoice"
        if "packing" in name:
            return "packing_list"
        if "shipping" in name or "si" in name:
            return "shipping_instruction"
        if extension in {"pdf", "docx", "xlsx", "png", "jpg", "jpeg", "txt"}:
            return extension
        return "other"

    @staticmethod
    def _build_preview_text(content: bytes, detected_type: str) -> str:
        if detected_type in {"png", "jpg", "jpeg"}:
            return "图片文件已接收，本轮仅提供基础预览占位。"

        preview = content[:200].decode("utf-8", errors="ignore").strip()
        if preview:
            return preview
        return "文件已接收，但当前预览内容不可直接解码。"
