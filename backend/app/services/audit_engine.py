"""审核引擎核心逻辑：规则构造、Prompt 构造、JSON 解析与结果校验。"""

from __future__ import annotations

import ast
import copy
import json
import logging
import re
from statistics import mean
from typing import Any

from app.errors import AppError
from app.models.schemas import FeatureStatus

logger = logging.getLogger(__name__)

_LOCATION_HINT_PATTERN = re.compile(
    r"""
    ^\s*
    (?:'?(?P<sheet>[^'!]+)'?\s*!\s*)?
    (?P<cell>[A-Za-z]+\d+)
    (?:\s*:\s*[A-Za-z]+\d+)?
    \s*$
    """,
    re.VERBOSE,
)


def _normalize_location_hints(raw) -> list[str]:
    """
    Normalize arbitrary LLM output into safe Sheet!Cell location hints.

    Invalid items are ignored so malformed model output cannot fail the whole
    audit parse.
    """

    if raw is None:
        return []

    if isinstance(raw, str):
        items = [piece for piece in re.split(r"[,，、\n]+", raw) if piece.strip()]
    elif isinstance(raw, list):
        items = []
        for item in raw:
            if isinstance(item, str):
                items.append(item)
            elif isinstance(item, dict):
                sheet = str(item.get("sheet") or "").strip()
                cell = str(item.get("cell") or "").strip()
                if sheet and cell:
                    items.append(f"{sheet}!{cell}")
    else:
        return []

    normalized: list[str] = []
    seen: set[str] = set()

    for item in items:
        match = _LOCATION_HINT_PATTERN.match(item)
        if not match:
            continue

        sheet = (match.group("sheet") or "").strip()
        cell = match.group("cell").upper()

        if not sheet:
            continue

        key = f"{sheet}!{cell}"
        if key not in seen:
            seen.add(key)
            normalized.append(key)

    return normalized


_LEVEL_ALIASES = {
    "RED": "RED",
    "红色·高风险": "RED",
    "红色高风险": "RED",
    "高风险": "RED",
    "YELLOW": "YELLOW",
    "黄色·疑点": "YELLOW",
    "黄色疑点": "YELLOW",
    "疑点": "YELLOW",
    "BLUE": "BLUE",
    "蓝色·提示": "BLUE",
    "蓝色提示": "BLUE",
    "提示": "BLUE",
}

_CORE_CONFLICT_KEYWORDS = (
    "单价不一致",
    "单价错误",
    "金额不一致",
    "金额错误",
    "总金额不一致",
    "数量不一致",
    "数量错误",
    "币种不一致",
    "币种冲突",
    "税额不一致",
    "合同号不一致",
    "订单号不一致",
    "po号不一致",
    "发票号不一致",
    "发票号码与合同号码不一致",
    "主体不一致",
    "主体明确冲突",
    "买方不一致",
    "卖方不一致",
)

_CORE_IDENTIFIER_FIELD_KEYWORDS = (
    "合同号",
    "合同编号",
    "contract no",
    "contract number",
    "发票号",
    "发票号码",
    "invoice no",
    "invoice number",
    "订单号",
    "订单编号",
    "order no",
    "order number",
    "po号",
    "po no",
    "po number",
    "采购订单号",
    "提单号",
    "提单编号",
    "bill of lading",
    "b/l",
    "bl no",
)

_CORE_IDENTIFIER_CONTEXT_KEYWORDS = (
    "核心编号",
    "核心业务编号",
    "关键编号",
    "刚性检查字段",
)

_CORE_IDENTIFIER_PROBLEM_KEYWORDS = (
    "缺失",
    "未显示",
    "未出现",
    "未填写",
    "未提供",
    "未列示",
    "不存在",
    "为空",
    "漏填",
    "没有",
    "不一致",
    "不匹配",
    "不相符",
    "不符",
    "冲突",
    "错误",
    "写错",
    "不同",
    "missing",
    "omitted",
    "absent",
    "not shown",
    "not present",
    "mismatch",
    "inconsistent",
    "conflict",
    "wrong",
)

_UNCERTAIN_CONFLICT_HINTS = (
    "无法确认",
    "可能",
    "疑似",
    "建议复核",
    "待确认",
    "需复核",
    "需要复核",
)

_STRONG_CORE_IDENTIFIER_PROBLEMS = (
    "缺失",
    "未显示",
    "未出现",
    "未填写",
    "未提供",
    "未列示",
    "不一致",
    "不匹配",
    "不相符",
    "不符",
    "冲突",
    "错误",
    "写错",
    "missing",
    "omitted",
    "absent",
    "not shown",
    "not present",
    "mismatch",
    "inconsistent",
    "conflict",
    "wrong",
)

_PO_UNIT_PRICE_ABSENCE_PATTERNS = (
    r"PO\s*(?:中|里)?\s*(?:虽)?(?:未|没有|并未)(?:明确)?(?:列出|显示|标注|提供|写明)\s*(?:任何)?单价",
    r"PO\s*(?:虽)?\s*(?:未|没有|并未)(?:明确)?(?:列出|显示|标注|提供|写明)\s*(?:任何)?单价",
    r"PO\s*(?:中|里)?\s*(?:看不到|无)\s*(?:任何)?单价",
)

_DYNAMIC_SYSTEM_RULE_NOTICE = "系统硬规则由数据库动态加载，请通过管理员后台查看。"


def _rule_sort_order(rule: dict) -> int:
    value = rule.get("sort_order")
    if value is None:
        return 0
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def build_audit_system_prompt(rules: list[dict]) -> str:
    """根据系统硬规则列表构造完整的 system prompt。

    rules: 来自 system_hard_rules 表的记录列表，每项至少包含
           title、content、sort_order 三个字段。

    返回值：拼装好的完整 system prompt 字符串。
    """

    if not rules:
        raise AppError(
            "系统硬规则未配置，无法发起审核任务，请联系管理员。",
            status_code=500,
        )

    sorted_rules = sorted(rules, key=_rule_sort_order)
    sections = ["你是一个专业的智能单据审核引擎。请严格遵守以下系统硬规则："]
    for index, rule in enumerate(sorted_rules, start=1):
        title = str(rule.get("title") or "").strip()
        content = str(rule.get("content") or "").strip()
        sections.append(f"{index}. 【{title}】\n{content}")
    return "\n\n".join(sections).rstrip()


_CUSTOM_RULES_REVIEW_INSTRUCTION_TEXT = """
You are reviewing and revising an existing audit result according to user-defined custom rules.

Apply the custom rules with high priority, but do not break these protected rules:
1. The explicit baseline document remains the primary baseline; it may be a PO, contract, order, or another uploaded reference document.
2. Contract number, invoice number, and order number mismatches stay high-priority.
3. PO number and contract number cannot be merged into one concept.
4. Numeric ambiguity must remain RED.
5. The output must remain valid JSON and every issue must include confidence.
6. Do not state that a PO field is missing unless the PO text proves it is absent; if uncertain, use “未能确认”.
7. Unit-price, amount, quantity, currency, and core identifier issues are protected categories and must not swallow each other.

If custom rules require reclassification, regenerate the full result object instead of patching fragments.
You must return a full JSON object with recalculated summary, issue ids, and confidence values.
8. All user-facing text (finding, suggestion) must be in Simplified Chinese. Keep original field names and values untranslated.
9. Be deterministic and do not introduce speculative findings.
""".strip()

CUSTOM_RULES_REVIEW_INSTRUCTION_TEXT = _CUSTOM_RULES_REVIEW_INSTRUCTION_TEXT

_AUDIT_RESULT_SCHEMA_TEXT = """
Return a JSON object with this exact shape. Do not output anything outside the JSON.

{
  "summary": {"red": 0, "yellow": 0, "blue": 0, "total": 0},
  "issues": [
    {
      "id": "R-01",
      "level": "RED|YELLOW|BLUE",
      "field_name": "字段中文名称",
      "finding": "具体发现的问题描述（中文）",
      "your_value": "目标单据上的值，无法确认则写未能确认",
      "source_value": "基准单据/PO 中的值，无法确认则写未能确认",
      "source": "数据来源说明，例如 PO、合同、Invoice、装箱单等",
      "field_location": "字段位置或行项目说明（人类可读），可省略",
      "location_hints": ["Sheet1!F9"],
      "suggestion": "中文修正建议",
      "confidence": 0.0
    }
  ],
  "confidence": 0.0
}

Coordinate rules（必须遵守）:
- 用户输入中，每个非空 Excel 单元格都以 "[SheetName!Cell] label: value" 的形式列出。
  当某个 issue 引用某个值时，你必须从该输入中抄出对应的 "SheetName!Cell"
  放进 location_hints 数组。
- 严禁伪造未在输入中出现过的坐标。如果你不确定某个 issue 对应哪个具体单元格，
  请输出 location_hints: []，不要猜。
- 对“字段缺失/为空”类问题：如果输入里能识别出该字段标签及其相邻空白单元格，
  输出那个空白单元格的坐标；不要因为值为空就直接输出 []。
- 如果该 issue 是建议性、跨文件、纯流程类问题，且无对应单元格，
  输出 location_hints: []。
- field_location 仍可填人类可读描述，例如 "发票第 3 行"；
  但标记坐标依赖 location_hints，而不是 field_location。

Output requirements:
- 所有 finding 与 suggestion 必须使用简体中文。
- 保留原始字段名、数字、币种与 Incoterms。
- 编号按严重程度：R-01, Y-01, B-01。
- 不要输出 JSON 以外的任何文本。
""".strip()

_CUSTOM_RULES_REVIEW_RESULT_SCHEMA_TEXT = """
Return a JSON object with this exact shape:
Each issue object must include location_hints: a string array of "SheetName!Cell" coordinates copied only from real coordinates present in the input.
{
  "summary": {"red": 0, "yellow": 0, "blue": 0, "total": 0},
  "issues": [
    {
      "id": "R-01",
      "level": "RED|YELLOW|BLUE",
      "field_name": "字段中文名称",
      "finding": "具体发现的问题描述",
      "your_value": "目标单据上的值，无法确认则写未能确认",
      "source_value": "基准单据/PO/数据源中的值，无法确认则写未能确认",
      "source": "数据来源说明，例如 PO、合同、订单、Invoice、装箱单等",
      "field_location": "字段位置或行项目说明，无法确认可省略",
      "location_hints": ["Sheet1!F9"],
      "suggestion": "中文修正建议",
      "confidence": 0.0
    }
  ],
  "confidence": 0.0
}

Output requirements:
- your_value and source_value should preserve the raw values from the documents as much as possible.
- If a value cannot be confirmed, write “未能确认”.
- All user-facing text must be Simplified Chinese.
- Preserve original field names, numbers, currency codes, and Incoterms.
- Number issues by severity: R-01, Y-01, B-01.
- "location_hints" must be a string array. For every issue that corresponds to a
  specific Excel cell, provide at least one entry pointing to the cell that needs
  marking, formatted as "SheetName!Cell" (e.g., "Sheet1!F9").
- Only use real SheetName!Cell coordinates that appeared in the input. 严禁伪造未在输入中出现过的坐标。
  If you are uncertain which specific cell applies, output location_hints: []，不要猜。
- For "missing field" or "empty value" issues: if the document text or extracted
  table context clearly identifies the field label and its adjacent empty cell,
  output the coordinate of that empty cell. Do NOT output [] merely because the
  value itself is empty.
- Output [] only when the issue is advisory, relates to external documents/process
  recommendations, is a cross-file or pure process issue, or no specific cell can
  be determined from the provided text.
- field_location is a human-readable description only and is not the primary basis
  for marking coordinates; marking depends on location_hints.
- Do not output any text outside the JSON object.
""".strip()

DEFAULT_DISPLAY_RULE_TEXT = _DYNAMIC_SYSTEM_RULE_NOTICE
DEFAULT_PROMPT_RULE_TEXT = _DYNAMIC_SYSTEM_RULE_NOTICE

def build_default_display_text() -> str:
    """返回系统规则摘要文本。"""

    # TODO(第 3 轮): 改为读取 system_hard_rules 后展示。
    return DEFAULT_DISPLAY_RULE_TEXT


def build_default_prompt_text() -> str:
    """返回系统规则完整 prompt 文本。"""

    # TODO(第 3 轮): 改为读取 system_hard_rules 后展示。
    return DEFAULT_PROMPT_RULE_TEXT


def _normalize_text_block(value: str | None) -> str:
    """清理文本块，避免把空白内容拼进 Prompt。"""

    return (value or "").strip()


def _stringify_json(data: dict[str, Any] | list[Any] | str | None) -> str:
    """把结构化对象转换成适合放进 Prompt 的 JSON 文本。"""

    if data is None:
        return ""
    if isinstance(data, str):
        return data.strip()
    return json.dumps(data, ensure_ascii=False, indent=2)


def _build_affiliate_rule(company_affiliates: list[str] | None) -> str:
    """根据集团关联公司上下文生成附加规则。"""

    affiliates = [item.strip() for item in (company_affiliates or []) if item and item.strip()]
    if not affiliates:
        return ""

    affiliate_list = ", ".join(affiliates)
    return f"""
Affiliate-company handling:
- The following names or role labels may refer to the same corporate group or approved related parties: {affiliate_list}.
- If a party-name difference is clearly explained by this affiliate list and the business role still makes sense, you may downgrade that party discrepancy from RED to YELLOW.
- Do not use affiliate logic to downgrade mismatches involving contract number, invoice number, order number, quantity, amount, currency, or other rigid identifiers.
- Write all finding and suggestion text in Simplified Chinese.
""".strip()


class AuditEngineService:
    """审核引擎核心服务，负责构造 Prompt 并解析模型结果。"""

    def get_features(self) -> list[FeatureStatus]:
        """返回当前审核引擎的能力说明。"""

        return [
            FeatureStatus(
                name="审核 Prompt 构造",
                ready=True,
                note="已实现系统规则、动态规则和多上下文内容拼接。",
            ),
            FeatureStatus(
                name="JSON 结果解析与兜底修复",
                ready=True,
                note="已支持直接 JSON、代码块 JSON、首个 JSON 对象提取与常见格式修复。",
            ),
            FeatureStatus(
                name="完整审核编排联调",
                ready=False,
                note="本轮仅落地审核引擎本身，不做完整编排和真实模型调用联调。",
            ),
        ]

    def _build_audit_rules(
        self,
        *,
        target_type: str | None,
        has_prev_ticket: bool,
        has_template: bool,
        company_affiliates: list[str] | None = None,
        audit_rules_text: str | None = None,
    ) -> str:
        """按上下文动态拼接审核规则文本。"""

        sections = [
            _normalize_text_block(audit_rules_text),
        ]

        affiliate_rule = _build_affiliate_rule(company_affiliates)
        if affiliate_rule:
            sections.append(affiliate_rule)

        if has_prev_ticket:
            sections.append(
                """
Previous-ticket comparison:
- Use the previous ticket only as secondary evidence.
- If the target document differs from both the PO and the previous ticket on recurring fields, raise attention.
- The previous ticket must not override the explicit baseline document.
""".strip()
            )

        if has_template:
            sections.append(
                """
Template comparison:
- Use the template as a completeness and formatting reference.
- If the template conflicts with the explicit baseline document on a core business fact, the baseline document still wins.
- Missing fields expected by the template may become YELLOW or BLUE depending on business impact.
""".strip()
            )

        sections.append(_AUDIT_RESULT_SCHEMA_TEXT)
        sections.append("Return the complete audit result as a valid JSON object.")
        return "\n\n".join(section for section in sections if section.strip())

    def build_audit_prompt(
        self,
        *,
        po_text: str,
        target_text: str,
        target_type: str | None = None,
        prev_ticket_text: str | None = None,
        template_text: str | None = None,
        reference_texts: list[str] | None = None,
        company_affiliates: list[str] | None = None,
        deep_think: bool = False,
        system_prompt_override: str | None = None,
        audit_rules_text: str | None = None,
        evidence_block: str = "",
    ) -> list[dict[str, str]]:
        """构造可直接给 LLM 客户端消费的审核消息列表。"""

        rules_text = self._build_audit_rules(
            target_type=target_type,
            has_prev_ticket=bool(_normalize_text_block(prev_ticket_text)),
            has_template=bool(_normalize_text_block(template_text)),
            company_affiliates=company_affiliates,
            audit_rules_text=audit_rules_text,
        )

        system_prompt = _normalize_text_block(system_prompt_override)
        if not system_prompt:
            raise AppError(
                "系统硬规则未配置，无法发起审核任务，请联系管理员。",
                status_code=500,
            )
        deep_think_instruction = (
            "Deep-think mode is enabled. Reason carefully, but still return only the final JSON object. All finding and suggestion text must be in Simplified Chinese."
            if deep_think
            else "Use standard reasoning depth. Return only the final JSON object. All finding and suggestion text must be in Simplified Chinese."
        )

        sections = [
            f"Target document type: {_normalize_text_block(target_type) or 'generic'}",
            deep_think_instruction,
            "Audit rules:",
            rules_text,
        ]
        if _normalize_text_block(evidence_block):
            sections.extend(["系统预提取关键字段:", _normalize_text_block(evidence_block)])
        sections.extend(
            [
                "PO text:",
                _normalize_text_block(po_text) or "[PO text is empty]",
                "Target document text:",
                _normalize_text_block(target_text) or "[Target document text is empty]",
            ]
        )

        if _normalize_text_block(prev_ticket_text):
            sections.extend(["Previous ticket text:", _normalize_text_block(prev_ticket_text)])
        if _normalize_text_block(template_text):
            sections.extend(["Template text:", _normalize_text_block(template_text)])
        if reference_texts:
            reference_blocks = [
                f"Reference #{index}:\n{_normalize_text_block(text)}"
                for index, text in enumerate(reference_texts, start=1)
                if _normalize_text_block(text)
            ]
            if reference_blocks:
                sections.extend(["Other reference texts:", "\n\n".join(reference_blocks)])

        user_prompt = "\n\n".join(section for section in sections if section.strip())
        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

    def build_custom_rules_review_prompt(
        self,
        *,
        original_result: dict[str, Any] | str,
        custom_rules: list[str] | str,
        po_text: str,
        target_text: str,
        target_type: str | None = None,
    ) -> list[dict[str, str]]:
        """构造自定义规则复审 Prompt。"""

        if isinstance(custom_rules, str):
            custom_rules_text = custom_rules.strip()
        else:
            custom_rules_text = "\n".join(f"- {rule}" for rule in custom_rules if rule and rule.strip())

        user_prompt = "\n\n".join(
            [
                f"Target document type: {_normalize_text_block(target_type) or 'generic'}",
                "User custom rules:",
                custom_rules_text or "[No custom rules provided]",
                "PO text:",
                _normalize_text_block(po_text) or "[PO text is empty]",
                "Target document text:",
                _normalize_text_block(target_text) or "[Target document text is empty]",
                "Current audit result JSON:",
                _stringify_json(original_result) or "{}",
                _CUSTOM_RULES_REVIEW_RESULT_SCHEMA_TEXT,
            ]
        )
        return [
            {"role": "system", "content": _CUSTOM_RULES_REVIEW_INSTRUCTION_TEXT},
            {"role": "user", "content": user_prompt},
        ]

    def build_cross_check_prompt(
        self,
        *,
        po_text: str,
        target_text: str,
        current_result: dict[str, Any] | str,
        prev_ticket_text: str | None = None,
        template_text: str | None = None,
        reference_texts: list[str] | None = None,
        target_type: str | None = None,
        system_prompt_override: str | None = None,
    ) -> list[dict[str, str]]:
        """构造交叉比对 Prompt，用于二次核验已有审核结果。"""

        sections = [
            "Re-check the current audit result against all available references.",
            f"Target document type: {_normalize_text_block(target_type) or 'generic'}",
            "PO text:",
            _normalize_text_block(po_text) or "[PO text is empty]",
            "Target document text:",
            _normalize_text_block(target_text) or "[Target document text is empty]",
            "Current audit result JSON:",
            _stringify_json(current_result) or "{}",
        ]

        if _normalize_text_block(prev_ticket_text):
            sections.extend(
                [
                    "Previous ticket text:",
                    _normalize_text_block(prev_ticket_text),
                ]
            )
        if _normalize_text_block(template_text):
            sections.extend(
                [
                    "Template text:",
                    _normalize_text_block(template_text),
                ]
            )
        if reference_texts:
            reference_blocks = [
                f"Reference #{index}:\n{_normalize_text_block(text)}"
                for index, text in enumerate(reference_texts, start=1)
                if _normalize_text_block(text)
            ]
            if reference_blocks:
                sections.extend(["Other references:", "\n\n".join(reference_blocks)])

        sections.extend(
            [
                """
Cross-check instructions:
- Keep valid existing issues.
- Add missing issues if the current result omitted a material problem.
- Remove or downgrade issues only when the evidence clearly supports the revision.
- Do not remove a core identifier issue just because an amount or unit-price issue already exists.
- Do not state that PO unit price or another PO field is absent unless the provided PO text proves it is absent; use “未能确认” when uncertain.
- Return a full JSON object, not a patch.
""".strip(),
                "Return the complete audit result as a valid JSON object.",
            ]
        )

        system_prompt = _normalize_text_block(system_prompt_override)
        if not system_prompt:
            raise AppError(
                "系统硬规则未配置，无法发起审核任务，请联系管理员。",
                status_code=500,
            )

        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "\n\n".join(section for section in sections if section.strip())},
        ]

    def parse_audit_result(self, raw_content: str | dict[str, Any] | list[Any]) -> dict[str, Any]:
        """解析模型返回内容，并输出结构稳定的审核结果。"""

        if isinstance(raw_content, dict):
            return self._validate_audit_result(raw_content)
        if isinstance(raw_content, list):
            return self._validate_audit_result({"issues": raw_content})

        text = (raw_content or "").strip()
        if not text:
            return self._validate_audit_result({})

        candidates = [
            text,
            *self._extract_code_block_candidates(text),
            *self._extract_json_object_candidates(text),
        ]

        for candidate in candidates:
            parsed = self._try_parse_json_candidate(candidate)
            if parsed is not None:
                return self._validate_audit_result(parsed)

        repaired = self._repair_common_json_issues(text)
        for candidate in [repaired, *self._extract_json_object_candidates(repaired)]:
            parsed = self._try_parse_json_candidate(candidate)
            if parsed is not None:
                return self._validate_audit_result(parsed)

        return self._validate_audit_result(
            {
                "issues": [
                    {
                        "level": "YELLOW",
                        "field_name": "model_output",
                        "finding": "模型返回内容无法被解析为合法 JSON。",
                        "suggestion": "检查模型输出格式，确保返回单个 JSON 对象。",
                        "confidence": 0.5,
                    }
                ]
            }
        )

    def _validate_audit_result(self, raw_result: dict[str, Any] | list[Any] | None) -> dict[str, Any]:
        """校验并修正审核结果结构，补齐兜底字段。"""

        if raw_result is None:
            raw_result = {}
        if isinstance(raw_result, list):
            raw_result = {"issues": raw_result}
        if not isinstance(raw_result, dict):
            raw_result = {}

        raw_issues = raw_result.get("issues")
        if not isinstance(raw_issues, list):
            raw_issues = []

        normalized_issues: list[dict[str, Any]] = []
        level_counts = {"RED": 0, "YELLOW": 0, "BLUE": 0}

        for index, raw_issue in enumerate(raw_issues, start=1):
            if not isinstance(raw_issue, dict):
                raw_issue = {"finding": str(raw_issue)}

            field_name = str(
                raw_issue.get("field_name")
                or raw_issue.get("field")
                or raw_issue.get("fieldName")
                or "unspecified_field"
            ).strip() or "unspecified_field"
            level = self._normalize_issue_level(
                raw_issue.get("level") or "YELLOW",
                index=index,
                field_name=field_name,
            )
            confidence = self._clamp_confidence(raw_issue.get("confidence", 0.5))
            finding_raw = (
                raw_issue.get("finding")
                or raw_issue.get("message")
                or raw_issue.get("issue")
                or ""
            )
            finding = str(finding_raw).strip()

            if not finding:
                fallback_parts: list[str] = []
                if raw_issue.get("field_name"):
                    fallback_parts.append(f"字段「{raw_issue['field_name']}」")
                sv = str(raw_issue.get("source_value") or "").strip()
                yv = str(raw_issue.get("your_value") or "").strip()
                if sv and yv and sv != yv:
                    fallback_parts.append(f"基准值为 {sv}，目标值为 {yv}，两者不一致")
                elif sv:
                    fallback_parts.append(f"基准值为 {sv}")
                elif yv:
                    fallback_parts.append(f"目标值为 {yv}")
                sug = str(raw_issue.get("suggestion") or raw_issue.get("recommended_action") or "").strip()
                if sug and not fallback_parts:
                    fallback_parts.append(sug)
                if fallback_parts:
                    finding = "，".join(fallback_parts) + "。"
                else:
                    finding = "模型返回了不完整的问题描述。"
            suggestion = str(
                raw_issue.get("suggestion")
                or raw_issue.get("recommended_action")
                or self._default_suggestion_for_level(level)
            ).strip()
            finding = self._sanitize_evidence_wording(finding)
            suggestion = self._sanitize_evidence_wording(suggestion)
            field_name, finding, suggestion = self._retitle_unit_price_issue(
                raw_issue,
                field_name,
                finding,
                suggestion,
            )
            field_name = self._normalize_issue_field_name(field_name, finding, suggestion)
            issue_id = str(raw_issue.get("id") or f"issue-{index:03d}").strip()
            if self._is_core_conflict_issue(raw_issue, field_name, finding, suggestion):
                level = "RED"

            normalized_issue = {
                "id": issue_id,
                "level": level,
                "field_name": field_name,
                "finding": finding,
                "suggestion": suggestion,
                "confidence": confidence,
                "raw_llm_issue": copy.deepcopy(raw_issue),
            }

            for optional_key in (
                "source_excerpt",
                "matched_po_value",
                "observed_value",
                "reason",
                "your_value",
                "source_value",
                "source",
                "field_location",
                "location_hints",
            ):
                value = raw_issue.get(optional_key)
                if value not in (None, ""):
                    normalized_issue[optional_key] = value

            location_hints = _normalize_location_hints(raw_issue.get("location_hints"))
            if not location_hints:
                legacy_location = raw_issue.get("field_location")
                if isinstance(legacy_location, str) and "!" in legacy_location:
                    location_hints = _normalize_location_hints(legacy_location)
            normalized_issue["location_hints"] = location_hints

            normalized_issues.append(normalized_issue)
            level_counts[level] += 1

        normalized_summary = {
            "red": level_counts["RED"],
            "yellow": level_counts["YELLOW"],
            "blue": level_counts["BLUE"],
        }
        normalized_summary["total"] = len(normalized_issues)

        overall_confidence = self._clamp_confidence(
            raw_result.get(
                "confidence",
                mean(issue["confidence"] for issue in normalized_issues) if normalized_issues else 0.5,
            )
        )

        notes = raw_result.get("notes")
        if not isinstance(notes, list):
            notes = []

        return {
            "summary": normalized_summary,
            "issues": normalized_issues,
            "confidence": overall_confidence,
            "notes": [str(item).strip() for item in notes if str(item).strip()],
        }

    @staticmethod
    def _extract_code_block_candidates(text: str) -> list[str]:
        """提取 Markdown 代码块中的候选 JSON。"""

        return re.findall(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.IGNORECASE)

    @staticmethod
    def _extract_json_object_candidates(text: str) -> list[str]:
        """提取文本中的首层 JSON 对象或数组片段。"""

        candidates: list[str] = []

        for opening, closing in (("{", "}"), ("[", "]")):
            depth = 0
            start_index: int | None = None
            in_string = False
            escape = False

            for index, char in enumerate(text):
                if in_string:
                    if escape:
                        escape = False
                    elif char == "\\":
                        escape = True
                    elif char == '"':
                        in_string = False
                    continue

                if char == '"':
                    in_string = True
                    continue

                if char == opening:
                    if depth == 0:
                        start_index = index
                    depth += 1
                elif char == closing and depth > 0:
                    depth -= 1
                    if depth == 0 and start_index is not None:
                        candidates.append(text[start_index : index + 1])
                        break

        return candidates

    def _try_parse_json_candidate(self, candidate: str) -> dict[str, Any] | list[Any] | None:
        """尝试把候选文本解析成 JSON 或 Python 字面量对象。"""

        snippet = candidate.strip()
        if not snippet:
            return None

        try:
            return json.loads(snippet)
        except json.JSONDecodeError:
            pass

        repaired = self._repair_common_json_issues(snippet)
        try:
            return json.loads(repaired)
        except json.JSONDecodeError:
            pass

        try:
            literal = ast.literal_eval(repaired)
        except (ValueError, SyntaxError):
            return None

        if isinstance(literal, (dict, list)):
            return literal
        return None

    @staticmethod
    def _repair_common_json_issues(text: str) -> str:
        """修正常见的轻微 JSON 格式问题。"""

        repaired = text.strip()
        repaired = re.sub(r"([\[{,:\s])\u201c", r'\1"', repaired)
        repaired = re.sub(r"\u201d([\]},:\s])", r'"\1', repaired)
        repaired = re.sub(r"^(\s*)\u201c", r'\1"', repaired, flags=re.MULTILINE)
        repaired = re.sub(r"\u201d(\s*)$", r'"\1', repaired, flags=re.MULTILINE)
        repaired = re.sub(r"([\[{,:\s])\u2018", r"\1'", repaired)
        repaired = re.sub(r"\u2019([\]},:\s])", r"'\1", repaired)
        repaired = re.sub(r",(\s*[}\]])", r"\1", repaired)
        repaired = re.sub(r"^\s*json\s*", "", repaired, flags=re.IGNORECASE)
        repaired = re.sub(r"//.*?$", "", repaired, flags=re.MULTILINE)
        return repaired.strip()

    @staticmethod
    def _normalize_issue_level(value: Any, *, index: int, field_name: str) -> str:
        raw_level = str(value or "YELLOW").strip()
        compact_level = re.sub(r"[\s_\-:：/|]+", "", raw_level).upper()
        normalized = _LEVEL_ALIASES.get(raw_level.upper()) or _LEVEL_ALIASES.get(compact_level)
        if normalized is not None:
            return normalized

        logger.warning(
            "Issue #%d has non-standard level '%s', remapped to YELLOW. field_name=%s",
            index,
            raw_level,
            field_name,
        )
        return "YELLOW"

    @staticmethod
    def _sanitize_evidence_wording(text: str) -> str:
        sanitized = text
        for pattern in _PO_UNIT_PRICE_ABSENCE_PATTERNS:
            sanitized = re.sub(
                pattern,
                "未能确认 PO 单价",
                sanitized,
                flags=re.IGNORECASE,
            )
        return sanitized

    @staticmethod
    def _normalize_issue_field_name(field_name: str, finding: str, suggestion: str) -> str:
        text = f"{field_name} {finding} {suggestion}".lower()
        if "单价" in text and any(keyword in text for keyword in ("不一致", "错误", "不匹配", "不符")):
            return "单价不一致"
        if "数量" in text and any(keyword in text for keyword in ("不一致", "错误", "不匹配", "不符")):
            return "数量不一致"
        if any(keyword in text for keyword in ("总金额不一致", "总金额错误", "金额不一致", "金额错误")):
            return "总金额不一致"
        return field_name

    @classmethod
    def _retitle_unit_price_issue(
        cls,
        raw_issue: dict[str, Any],
        field_name: str,
        finding: str,
        suggestion: str,
    ) -> tuple[str, str, str]:
        """Prefer explicit unit-price mismatch when both sides provide unit-price evidence."""

        text_parts = [
            field_name,
            finding,
            suggestion,
            str(raw_issue.get("your_value", "")),
            str(raw_issue.get("source_value", "")),
            str(raw_issue.get("matched_po_value", "")),
            str(raw_issue.get("observed_value", "")),
            str(raw_issue.get("source_excerpt", "")),
            str(raw_issue.get("reason", "")),
        ]
        text = " ".join(part for part in text_parts if part).lower()
        if "单价" not in text and "unit price" not in text:
            return field_name, finding, suggestion
        if any(
            marker in text
            for marker in ("推算单价", "隐含单价", "反推单价", "implied unit price", "calculated unit price")
        ):
            return field_name, finding, suggestion
        if not cls._has_explicit_unit_price_pair(raw_issue, text):
            return field_name, finding, suggestion

        source_value = cls._clean_comparison_value(
            raw_issue.get("source_value") or raw_issue.get("matched_po_value")
        ) or cls._extract_unit_price_value_from_text(text, baseline=True)
        your_value = cls._clean_comparison_value(
            raw_issue.get("your_value") or raw_issue.get("observed_value")
        ) or cls._extract_unit_price_value_from_text(text, baseline=False)
        if source_value and your_value and source_value != your_value:
            return "单价不一致", finding, suggestion

        if cls._contains_baseline_and_target_unit_price_evidence(text) and cls._contains_amount_math_evidence(text):
            return "单价不一致", finding, suggestion

        return field_name, finding, suggestion

    @staticmethod
    def _clean_comparison_value(value: Any) -> str:
        text = str(value or "").strip()
        if not text or text == "未能确认":
            return ""
        return text

    @classmethod
    def _has_explicit_unit_price_pair(cls, raw_issue: dict[str, Any], text: str) -> bool:
        source_value = cls._clean_comparison_value(
            raw_issue.get("source_value") or raw_issue.get("matched_po_value")
        )
        your_value = cls._clean_comparison_value(
            raw_issue.get("your_value") or raw_issue.get("observed_value")
        )
        if source_value and your_value and cls._looks_numeric(source_value) and cls._looks_numeric(your_value):
            return True
        return cls._contains_baseline_and_target_unit_price_evidence(text)

    @staticmethod
    def _contains_baseline_and_target_unit_price_evidence(text: str) -> bool:
        baseline_pattern = r"(?:po|基准单据|基准|合同|订单)[^。；;\n]{0,40}(?:unit price|单价)[^。；;\n]{0,40}\d"
        target_pattern = r"(?:invoice|发票|目标单据|目标)[^。；;\n]{0,40}(?:unit price|单价)[^。；;\n]{0,40}\d"
        return bool(re.search(baseline_pattern, text, flags=re.IGNORECASE)) and bool(
            re.search(target_pattern, text, flags=re.IGNORECASE)
        )

    @staticmethod
    def _contains_amount_math_evidence(text: str) -> bool:
        return any(keyword in text for keyword in ("计算金额", "计算为", "应为", "quantity", "数量")) and any(
            keyword in text for keyword in ("总金额", "total value", "amount", "金额")
        )

    @staticmethod
    def _extract_unit_price_value_from_text(text: str, *, baseline: bool) -> str:
        anchors = (
            r"(?:po|基准单据|基准|合同|订单)"
            if baseline
            else r"(?:invoice|发票|目标单据|目标)"
        )
        pattern = rf"{anchors}[^。；;\n]{{0,60}}(?:unit price|单价)[^\d。；;\n]{{0,20}}(\d[\d,]*(?:\.\d+)?)"
        match = re.search(pattern, text, flags=re.IGNORECASE)
        return match.group(1) if match else ""

    @staticmethod
    def _looks_numeric(value: str) -> bool:
        return bool(re.search(r"\d", value))

    @staticmethod
    def _is_core_conflict_issue(
        raw_issue: dict[str, Any],
        field_name: str,
        finding: str,
        suggestion: str,
    ) -> bool:
        text = " ".join(
            str(value)
            for value in (
                field_name,
                raw_issue.get("title", ""),
                finding,
                suggestion,
                raw_issue.get("description", ""),
                raw_issue.get("evidence", ""),
                raw_issue.get("source_excerpt", ""),
                raw_issue.get("your_value", ""),
                raw_issue.get("source_value", ""),
                raw_issue.get("source", ""),
                raw_issue.get("field_location", ""),
            )
            if value not in (None, "")
        ).lower()
        if any(keyword in text for keyword in _CORE_CONFLICT_KEYWORDS):
            return True

        has_core_identifier = any(keyword in text for keyword in _CORE_IDENTIFIER_FIELD_KEYWORDS)
        has_contextual_identifier = any(keyword in text for keyword in _CORE_IDENTIFIER_CONTEXT_KEYWORDS) and "编号" in text
        has_identifier_problem = any(keyword in text for keyword in _CORE_IDENTIFIER_PROBLEM_KEYWORDS)
        has_strong_identifier_problem = any(keyword in text for keyword in _STRONG_CORE_IDENTIFIER_PROBLEMS)
        if (has_core_identifier or has_contextual_identifier) and has_strong_identifier_problem:
            return True
        if any(hint in text for hint in _UNCERTAIN_CONFLICT_HINTS):
            return False
        return (has_core_identifier or has_contextual_identifier) and has_identifier_problem

    @staticmethod
    def _safe_int(value: Any, default: int = 0) -> int:
        """把任意输入尽量转换成 int。"""

        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _clamp_confidence(value: Any) -> float:
        """把置信度限制在 0.0 到 1.0。"""

        try:
            confidence = float(value)
        except (TypeError, ValueError):
            confidence = 0.5
        return max(0.0, min(1.0, confidence))

    @staticmethod
    def _default_suggestion_for_level(level: str) -> str:
        """根据问题级别生成兜底建议。"""

        if level == "RED":
            return "请优先核对原始单据并修正后再继续流转。"
        if level == "BLUE":
            return "可作为提醒项记录，无需立即阻断流程。"
        return "请人工复核该字段，并确认是否需要修正。"
