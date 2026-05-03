from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import requests


API_PREFIX = "/api"
TERMINAL_STATUSES = {"completed", "failed", "cancelled"}


class GoldenDatasetApiError(RuntimeError):
    """Raised when the golden dataset runner cannot complete an API call."""


class GoldenDatasetAuditTimeout(GoldenDatasetApiError):
    """Raised when audit progress does not reach a terminal status in time."""

    def __init__(self, message: str, last_progress: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.last_progress = last_progress or {}


@dataclass(frozen=True)
class ApiClientConfig:
    base_url: str
    timeout_seconds: int
    poll_interval_seconds: int
    poll_max_seconds: int


class GoldenDatasetApiClient:
    def __init__(
        self,
        config: ApiClientConfig,
        log: Callable[[str], None],
        token: str | None = None,
    ) -> None:
        self.config = config
        self.log = log
        self.session = requests.Session()
        self.token = token

    def close(self) -> None:
        self.session.close()

    def set_token(self, token: str) -> None:
        self.token = token

    def login(self, email: str, password: str) -> str:
        response = self.session.post(
            self._url("/auth/login"),
            json={"email": email, "password": password},
            timeout=self.config.timeout_seconds,
        )
        payload = self._json_or_raise(response, "登录")
        token = payload.get("access_token")
        if not token:
            raise GoldenDatasetApiError("登录响应缺少 access_token")
        self.token = str(token)
        return self.token

    def upload_file(self, path: Path) -> str:
        self._require_token()
        with path.open("rb") as handle:
            response = self.session.post(
                self._url("/files/upload"),
                headers=self._auth_headers(),
                files={"upload": (path.name, handle, self._guess_content_type(path))},
                timeout=self.config.timeout_seconds,
            )
        payload = self._json_or_raise(response, f"上传文件 {path.name}")
        file_id = (payload.get("file") or {}).get("id")
        if not file_id:
            raise GoldenDatasetApiError(f"上传文件 {path.name} 的响应缺少 file.id")
        return str(file_id)

    def start_audit(self, po_file_id: str, target_file_ids: list[str]) -> str:
        self._require_token()
        body = {
            "po_file_id": po_file_id,
            "target_files": [{"file_id": file_id} for file_id in target_file_ids],
            "prev_ticket_files": [],
            "deep_think": False,
        }
        response = self.session.post(
            self._url("/audit/start"),
            headers={**self._auth_headers(), "Content-Type": "application/json"},
            json=body,
            timeout=self.config.timeout_seconds,
        )
        payload = self._json_or_raise(response, "启动审核")
        task_id = payload.get("task_id")
        if not task_id:
            raise GoldenDatasetApiError("启动审核响应缺少 task_id")
        return str(task_id)

    def wait_for_audit(self, task_id: str) -> dict[str, Any]:
        self._require_token()
        deadline = time.monotonic() + self.config.poll_max_seconds
        reconnects = 0
        last_progress: dict[str, Any] | None = None

        while time.monotonic() < deadline:
            try:
                for event in self._read_progress_stream(task_id, deadline):
                    last_progress = event
                    status = str(event.get("status", "")).lower()
                    progress = event.get("progress_percent", "")
                    message = event.get("message", "")
                    self.log(f"任务 {task_id} 进度：status={status} progress={progress} message={message}")
                    if status in TERMINAL_STATUSES:
                        return event
                reconnects += 1
            except (requests.RequestException, json.JSONDecodeError) as exc:
                reconnects += 1
                self.log(f"任务 {task_id} SSE 连接中断，准备第 {reconnects}/3 次重连：{exc}")

            if reconnects > 3:
                raise GoldenDatasetApiError(
                    f"任务 {task_id} SSE 连接中断超过 3 次，最后进度：{last_progress or {}}"
                )
            time.sleep(min(self.config.poll_interval_seconds, max(deadline - time.monotonic(), 0)))

        raise GoldenDatasetAuditTimeout(
            f"任务 {task_id} 在 {self.config.poll_max_seconds} 秒内未完成",
            last_progress=last_progress,
        )

    def get_result(self, task_id: str) -> dict[str, Any]:
        self._require_token()
        response = self.session.get(
            self._url(f"/audit/result/{task_id}"),
            headers=self._auth_headers(),
            timeout=self.config.timeout_seconds,
        )
        return self._json_or_raise(response, "获取审核结果")

    def _read_progress_stream(self, task_id: str, deadline: float):
        remaining = max(deadline - time.monotonic(), 1)
        read_timeout = max(min(self.config.timeout_seconds, remaining), 1)
        with self.session.get(
            self._url(f"/audit/progress/{task_id}"),
            headers=self._auth_headers(),
            stream=True,
            timeout=(self.config.timeout_seconds, read_timeout),
        ) as response:
            if response.status_code >= 400:
                self._json_or_raise(response, "读取审核进度")
            for raw_line in response.iter_lines(decode_unicode=True):
                if time.monotonic() >= deadline:
                    return
                if not raw_line:
                    continue
                line = raw_line.strip()
                if not line.startswith("data:"):
                    continue
                data = line[len("data:") :].strip()
                if data:
                    yield json.loads(data)

    def _json_or_raise(self, response: requests.Response, action: str) -> dict[str, Any]:
        try:
            payload = response.json()
        except ValueError as exc:
            raise GoldenDatasetApiError(
                f"{action}失败：HTTP {response.status_code}，响应不是 JSON：{response.text[:500]}"
            ) from exc
        if response.status_code >= 400:
            raise GoldenDatasetApiError(f"{action}失败：HTTP {response.status_code}：{payload}")
        if not isinstance(payload, dict):
            raise GoldenDatasetApiError(f"{action}失败：响应 JSON 不是对象：{payload}")
        return payload

    def _url(self, path: str) -> str:
        root = self.config.base_url.rstrip("/")
        clean_path = path if path.startswith("/") else f"/{path}"
        return f"{root}{API_PREFIX}{clean_path}"

    def _auth_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._require_token()}"}

    def _require_token(self) -> str:
        if not self.token:
            raise GoldenDatasetApiError("缺少 access_token，请先登录")
        return self.token

    @staticmethod
    def _guess_content_type(path: Path) -> str:
        suffix = path.suffix.lower()
        if suffix == ".xlsx":
            return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        if suffix == ".docx":
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        if suffix == ".pdf":
            return "application/pdf"
        return "application/octet-stream"
