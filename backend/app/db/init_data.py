from dataclasses import dataclass


@dataclass(frozen=True)
class BootstrapDataPlan:
    """Describes future seed data responsibilities without executing them."""

    templates_enabled: bool = False
    demo_rules_enabled: bool = False
    note: str = "初始化数据方案将在后续轮次接入。"

