"""Field-name alias matching for evidence location."""

from __future__ import annotations

import re


FIELD_ALIASES = {
    "invoice_no": ["Invoice No.", "Invoice No", "发票号", "发票编号", "Inv. No.", "Inv No"],
    "contract_no": ["Contract No.", "合同号", "合同编号"],
    "po_no": ["PO No.", "PO No", "采购订单号", "订单号", "Order No."],
    "unit_price": ["Unit Price", "单价", "Unit Price, US$/KG", "Price"],
    "quantity": ["Quantity", "数量", "Qty", "KGS"],
    "total_amount": ["Total Value", "Total Amount", "总金额", "金额"],
}


def normalize_field_text(value: str | None) -> str:
    """Normalize labels for conservative field alias matching."""

    return re.sub(r"[\s\W_]+", "", str(value or "").lower(), flags=re.UNICODE)


def match_field(label: str | None, target_field: str | None) -> bool:
    """Match field labels case-insensitively after removing spaces and punctuation."""

    normalized_label = normalize_field_text(label)
    normalized_target = normalize_field_text(target_field)
    if not normalized_label or not normalized_target:
        return False

    if normalized_label == normalized_target:
        return True

    for canonical, aliases in FIELD_ALIASES.items():
        normalized_aliases = [normalize_field_text(item) for item in (canonical, *aliases)]
        target_matches_alias = any(
            alias and (alias == normalized_target or alias in normalized_target or normalized_target in alias)
            for alias in normalized_aliases
        )
        if not target_matches_alias:
            continue
        return any(
            alias and (alias == normalized_label or alias in normalized_label or normalized_label in alias)
            for alias in normalized_aliases
        )

    return normalized_label in normalized_target or normalized_target in normalized_label
