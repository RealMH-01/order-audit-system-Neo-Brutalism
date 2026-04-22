"""提供开发阶段使用的内存态运行数据存储。"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any


@dataclass
class RuntimeStore:
    """在未完成远程数据库联调前，为接口主链路提供最小可用存储。"""

    users_by_id: dict[str, dict[str, Any]] = field(default_factory=dict)
    user_ids_by_email: dict[str, str] = field(default_factory=dict)
    tokens: dict[str, str] = field(default_factory=dict)
    profiles: dict[str, dict[str, Any]] = field(default_factory=dict)
    system_rule: dict[str, Any] | None = None
    templates: dict[str, dict[str, Any]] = field(default_factory=dict)
    files: dict[str, dict[str, Any]] = field(default_factory=dict)
    audit_tasks: dict[str, dict[str, Any]] = field(default_factory=dict)
    audit_history: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    wizard_sessions: dict[str, dict[str, Any]] = field(default_factory=dict)


@lru_cache
def get_runtime_store() -> RuntimeStore:
    """返回全局复用的内存态存储。"""

    return RuntimeStore()
