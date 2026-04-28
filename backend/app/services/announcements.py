"""Service layer for system announcements.

This module only serves the announcement APIs. It does not read from rule
change logs and does not feed announcements into the audit flow.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.db.repository import SupabaseRepository
from app.errors import AppError
from app.models.schemas import (
    AnnouncementAdminResponse,
    AnnouncementCreateRequest,
    AnnouncementPublicResponse,
    AnnouncementUpdateRequest,
    CurrentUser,
)

ALLOWED_CATEGORIES = {
    "platform_rule",
    "feature",
    "important",
    "maintenance",
    "other",
}
UPDATE_FIELDS = ("title", "content", "category", "is_published")


class AnnouncementService:
    """Coordinate announcement validation, publish rules, and persistence."""

    def __init__(self, repo: SupabaseRepository | None) -> None:
        self.repo = repo

    def list_published_announcements(self, *, limit: int = 50) -> list[AnnouncementPublicResponse]:
        repo = self._require_repo()
        safe_limit = max(1, min(int(limit), 100))
        return [
            self._to_public_response(row)
            for row in repo.list_published_announcements(limit=safe_limit)
        ]

    def list_admin_announcements(self, *, limit: int = 100) -> list[AnnouncementAdminResponse]:
        repo = self._require_repo()
        safe_limit = max(1, min(int(limit), 200))
        return [
            self._to_admin_response(row)
            for row in repo.list_admin_announcements(limit=safe_limit)
        ]

    def create_announcement(
        self,
        current_user: CurrentUser,
        payload: AnnouncementCreateRequest,
    ) -> AnnouncementAdminResponse:
        repo = self._require_repo()
        title = self._require_non_empty_text(payload.title, "title")
        content = self._require_non_empty_text(payload.content, "content")
        category = self._require_category(payload.category)
        is_published = self._require_bool(payload.is_published, "is_published")
        now = self._now() if is_published else None

        created = repo.create_announcement(
            {
                "title": title,
                "content": content,
                "category": category,
                "is_published": is_published,
                "published_at": now,
                "created_by": current_user.id,
                "updated_by": current_user.id,
            }
        )
        return self._to_admin_response(created)

    def update_announcement(
        self,
        current_user: CurrentUser,
        announcement_id: str,
        payload: AnnouncementUpdateRequest,
    ) -> AnnouncementAdminResponse:
        repo = self._require_repo()
        existing = repo.get_announcement(announcement_id)
        if existing is None:
            raise AppError("Announcement not found.", status_code=404)

        requested = payload.model_dump(exclude_unset=True)
        updates: dict[str, Any] = {}
        for field_name in UPDATE_FIELDS:
            if field_name not in requested:
                continue
            value = requested[field_name]
            if field_name in ("title", "content"):
                value = self._require_non_empty_text(value, field_name)
            elif field_name == "category":
                value = self._require_category(value)
            elif field_name == "is_published":
                value = self._require_bool(value, field_name)
            updates[field_name] = value

        if not updates:
            raise AppError("Please provide at least one announcement field to update.", status_code=400)

        will_publish = updates.get("is_published") is True
        was_published = bool(existing.get("is_published", False))
        if will_publish and not was_published and not existing.get("published_at"):
            updates["published_at"] = self._now()

        updates["updated_by"] = current_user.id
        updated = repo.update_announcement(announcement_id, updates)
        return self._to_admin_response(updated)

    def _require_repo(self) -> SupabaseRepository:
        if self.repo is None:
            raise AppError("Supabase is not configured.", status_code=500)
        return self.repo

    @staticmethod
    def _require_non_empty_text(value: Any, field_name: str) -> str:
        if not isinstance(value, str):
            raise AppError(f"{field_name} must be a string.", status_code=400)
        stripped = value.strip()
        if not stripped:
            raise AppError(f"{field_name} cannot be blank.", status_code=400)
        return stripped

    @staticmethod
    def _require_category(value: Any) -> str:
        if not isinstance(value, str):
            raise AppError("category must be a string.", status_code=400)
        if value not in ALLOWED_CATEGORIES:
            allowed = ", ".join(sorted(ALLOWED_CATEGORIES))
            raise AppError(f"category must be one of: {allowed}.", status_code=400)
        return value

    @staticmethod
    def _require_bool(value: Any, field_name: str) -> bool:
        if not isinstance(value, bool):
            raise AppError(f"{field_name} must be a boolean.", status_code=400)
        return value

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    @staticmethod
    def _to_public_response(row: dict[str, Any]) -> AnnouncementPublicResponse:
        return AnnouncementPublicResponse(
            id=str(row["id"]),
            title=str(row["title"]),
            content=str(row["content"]),
            category=row["category"],
            published_at=row.get("published_at"),
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )

    @staticmethod
    def _to_admin_response(row: dict[str, Any]) -> AnnouncementAdminResponse:
        return AnnouncementAdminResponse(
            id=str(row["id"]),
            title=str(row["title"]),
            content=str(row["content"]),
            category=row["category"],
            is_published=bool(row.get("is_published", False)),
            published_at=row.get("published_at"),
            created_by=str(row["created_by"]) if row.get("created_by") else None,
            updated_by=str(row["updated_by"]) if row.get("updated_by") else None,
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )
