"""审核引擎核心逻辑：规则构造、Prompt 构造、JSON 解析与结果校验。"""

from __future__ import annotations

import ast
import json
import re
from statistics import mean
from typing import Any

from app.models.schemas import FeatureStatus

_SYSTEM_PROMPT = """
You are a professional export-document audit engine.

Your job is to compare the target document against the PO supplied by the user.
Unless the user explicitly says otherwise, the PO is always the primary source of truth.

You must follow these non-negotiable rules:
1. Use the PO as the baseline for all key checks.
2. Output only JSON. Do not add prose outside the JSON object.
3. Every issue must include confidence between 0.0 and 1.0.
4. RED means a hard mismatch, a missing critical field, or a risk that must not be downgraded.
5. YELLOW means suspicious, explainable, or review-required inconsistency.
6. BLUE means low-risk reminder, formatting notice, or non-blocking observation.
7. Contract number, invoice number, and order number are high-priority identifiers.
8. PO number and contract number are not the same concept and must never be treated as interchangeable.
9. Numeric ambiguity caused by formatting, separators, or conflicting number expressions must be marked RED.
10. Do not invent values. If evidence is insufficient, keep the issue factual and lower confidence rather than guessing.
11. When company affiliates are provided, you may downgrade only party-name discrepancies that clearly match the affiliate list and business role context.
12. Never use affiliate logic to downgrade core identifier, quantity, amount, currency, or critical date mismatches.
""".strip()

SYSTEM_PROMPT_TEXT = _SYSTEM_PROMPT

_CUSTOM_RULES_REVIEW_SYSTEM_PROMPT = """
You are reviewing and revising an existing audit result according to user-defined custom rules.

Apply the custom rules with high priority, but do not break these protected rules:
1. The PO remains the primary baseline.
2. Contract number, invoice number, and order number mismatches stay high-priority.
3. PO number and contract number cannot be merged into one concept.
4. Numeric ambiguity must remain RED.
5. The output must remain valid JSON and every issue must include confidence.

If custom rules require reclassification, regenerate the full result object instead of patching fragments.
You must return a full JSON object with recalculated summary, issue ids, and confidence values.
""".strip()

CUSTOM_RULES_REVIEW_SYSTEM_PROMPT = _CUSTOM_RULES_REVIEW_SYSTEM_PROMPT

_DEFAULT_DISPLAY_RULE_TEXT = """
1. 审核时一切以 PO 为准，除非用户明确声明某项字段应按其他基准处理。
2. RED 表示刚性错误、关键字段缺失、数字表达歧义或不能降级的高风险问题。
3. YELLOW 表示可解释但需要人工确认的差异，例如单位换算、集团关联公司主体差异、参考单据不一致等。
4. BLUE 表示提醒类或低风险说明，不应掩盖真实错误。
5. 合同号、Invoice No.、订单号属于高优先级刚性字段；PO 号与合同号不是同一概念。
6. 贸易术语要区分实质性变化与书写差异；数字逻辑需校验数量、单价、总价、箱数、重量等是否自洽。
7. 所有输出必须是结构化 JSON，且每条问题都必须带 confidence。
""".strip()

DEFAULT_DISPLAY_RULE_TEXT = _DEFAULT_DISPLAY_RULE_TEXT
DEFAULT_PROMPT_RULE_TEXT = SYSTEM_PROMPT_TEXT

_OUTPUT_FORMAT_RULES = """
Return a JSON object with this shape:
{
  "summary": {"red": 0, "yellow": 0, "blue": 0, "total": 0},
  "issues": [
    {
      "id": "issue-001",
      "level": "RED|YELLOW|BLUE",
      "field_name": "field_or_area",
      "finding": "what is wrong",
      "suggestion": "what to verify or correct",
      "confidence": 0.0
    }
  ],
  "confidence": 0.0
}
""".strip()

_LEVEL_DEFINITIONS = """
Severity rules:
- RED: hard mismatch, critical omission, impossible numeric logic, or ambiguous number formatting.
- YELLOW: likely mismatch that may be explainable and requires manual confirmation.
- BLUE: informational reminder, low-risk note, or formatting observation.
""".strip()

_NON_NEGOTIABLE_RULES = """
Non-negotiable audit rules:
- Treat the PO as the source of truth.
- Contract number, Invoice No., and order number are rigid checks.
- PO number and contract number are different fields.
- If a number is ambiguous because of separators, decimal notation, or conflicting representations, mark it RED.
- Check quantity * unit price = amount when the document provides those values.
- Check totals, carton counts, gross/net weight, and volume for internal consistency when available.
- Distinguish substantive Incoterm change from harmless writing differences such as spacing or capitalization.
- Unit conversion may be YELLOW only when the underlying quantity appears plausibly reconcilable and the document gives enough context.
""".strip()

_TARGET_TYPE_RULES: dict[str, str] = {
    "invoice": """
Document-specific focus for invoice:
- Compare invoice number, contract reference, PO reference, item descriptions, quantities, unit prices, total amount, currency, and payer/payee parties.
- Missing or inconsistent invoice number is high priority.
""".strip(),
    "packing_list": """
Document-specific focus for packing list:
- Compare package count, packing method, carton marks, gross weight, net weight, volume, and quantity breakdown.
- Weight/volume contradictions should trigger RED or YELLOW depending on whether the contradiction is definite.
""".strip(),
    "shipping_instruction": """
Document-specific focus for shipping instruction:
- Compare shipper, consignee, notify party, ports, Incoterm, cargo description, marks, package count, and booking-related references.
- Port or consignee changes that alter execution meaning are substantive and should not be treated as harmless wording differences.
""".strip(),
    "bill_of_lading": """
Document-specific focus for bill of lading:
- Compare shipper, consignee, notify party, vessel or voyage, ports, marks, package count, gross weight, and cargo description.
- Bill number, consignee, notify party, and port discrepancies should be treated as high-impact shipping risks.
""".strip(),
    "certificate_of_origin": """
Document-specific focus for certificate of origin:
- Compare exporter, consignee, goods description, quantity, weight, origin declaration, and certificate references against the PO and supporting documents.
- Origin statement conflicts or certificate reference mismatches should be highlighted clearly.
""".strip(),
    "customs_declaration": """
Document-specific focus for customs declaration:
- Compare importer or exporter details, HS-related description, quantity, weight, declared value, currency, and declaration references.
- Quantity, amount, and declaration reference mismatches should be treated as material.
""".strip(),
    "letter_of_credit": """
Document-specific focus for letter of credit:
- Compare applicant, beneficiary, issuing bank, amount, currency, shipment deadlines, presentation terms, and required document references.
- Expiry, amount, beneficiary, and presentation-condition mismatches should be called out explicitly.
""".strip(),
    "generic": """
Document-specific focus:
- Audit all key identifiers, parties, product details, quantities, amounts, dates, transport terms, and special instructions visible in the document.
""".strip(),
}


def build_default_display_text() -> str:
    """返回系统规则摘要文本。"""

    return DEFAULT_DISPLAY_RULE_TEXT


def build_default_prompt_text() -> str:
    """返回系统规则完整 prompt 文本。"""

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
""".strip()


def _get_target_type_rule(target_type: str | None) -> str:
    """返回按单据类型附加的审核规则。"""

    normalized = (target_type or "generic").strip().lower().replace(" ", "_")
    return _TARGET_TYPE_RULES.get(normalized, _TARGET_TYPE_RULES["generic"])


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
    ) -> str:
        """按上下文动态拼接审核规则文本。"""

        sections = [
            _LEVEL_DEFINITIONS,
            _NON_NEGOTIABLE_RULES,
            _get_target_type_rule(target_type),
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
- The previous ticket must not override the PO.
""".strip()
            )

        if has_template:
            sections.append(
                """
Template comparison:
- Use the template as a completeness and formatting reference.
- If the template conflicts with the PO on a core business fact, the PO still wins.
- Missing fields expected by the template may become YELLOW or BLUE depending on business impact.
""".strip()
            )

        sections.append(_OUTPUT_FORMAT_RULES)
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
    ) -> list[dict[str, str]]:
        """构造可直接给 LLM 客户端消费的审核消息列表。"""

        rules_text = self._build_audit_rules(
            target_type=target_type,
            has_prev_ticket=bool(_normalize_text_block(prev_ticket_text)),
            has_template=bool(_normalize_text_block(template_text)),
            company_affiliates=company_affiliates,
        )

        system_prompt = _normalize_text_block(system_prompt_override) or _SYSTEM_PROMPT
        deep_think_instruction = (
            "Deep-think mode is enabled. Reason carefully, but still return only the final JSON object."
            if deep_think
            else "Use standard reasoning depth. Return only the final JSON object."
        )

        sections = [
            f"Target document type: {_normalize_text_block(target_type) or 'generic'}",
            deep_think_instruction,
            "Audit rules:",
            rules_text,
            "PO text:",
            _normalize_text_block(po_text) or "[PO text is empty]",
            "Target document text:",
            _normalize_text_block(target_text) or "[Target document text is empty]",
        ]

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
                _OUTPUT_FORMAT_RULES,
            ]
        )
        return [
            {"role": "system", "content": _CUSTOM_RULES_REVIEW_SYSTEM_PROMPT},
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
- Return a full JSON object, not a patch.
""".strip(),
                _OUTPUT_FORMAT_RULES,
            ]
        )

        return [
            {"role": "system", "content": _SYSTEM_PROMPT},
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

            level = str(raw_issue.get("level") or "YELLOW").upper().strip()
            if level not in level_counts:
                level = "YELLOW"

            confidence = self._clamp_confidence(raw_issue.get("confidence", 0.5))
            field_name = str(
                raw_issue.get("field_name")
                or raw_issue.get("field")
                or raw_issue.get("fieldName")
                or "unspecified_field"
            ).strip() or "unspecified_field"
            finding = str(
                raw_issue.get("finding")
                or raw_issue.get("message")
                or raw_issue.get("issue")
                or "模型返回了不完整的问题描述。"
            ).strip()
            suggestion = str(
                raw_issue.get("suggestion")
                or raw_issue.get("recommended_action")
                or self._default_suggestion_for_level(level)
            ).strip()
            issue_id = str(raw_issue.get("id") or f"issue-{index:03d}").strip()

            normalized_issue = {
                "id": issue_id,
                "level": level,
                "field_name": field_name,
                "finding": finding,
                "suggestion": suggestion,
                "confidence": confidence,
            }

            for optional_key in ("source_excerpt", "matched_po_value", "observed_value", "reason"):
                value = raw_issue.get(optional_key)
                if value not in (None, ""):
                    normalized_issue[optional_key] = value

            normalized_issues.append(normalized_issue)
            level_counts[level] += 1

        summary = raw_result.get("summary")
        if not isinstance(summary, dict):
            summary = {}

        normalized_summary = {
            "red": self._safe_int(summary.get("red"), default=level_counts["RED"]),
            "yellow": self._safe_int(summary.get("yellow"), default=level_counts["YELLOW"]),
            "blue": self._safe_int(summary.get("blue"), default=level_counts["BLUE"]),
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
        repaired = repaired.replace("“", '"').replace("”", '"')
        repaired = repaired.replace("‘", "'").replace("’", "'")
        repaired = re.sub(r",(\s*[}\]])", r"\1", repaired)
        repaired = re.sub(r"^\s*json\s*", "", repaired, flags=re.IGNORECASE)
        repaired = re.sub(r"//.*?$", "", repaired, flags=re.MULTILINE)
        return repaired.strip()

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
