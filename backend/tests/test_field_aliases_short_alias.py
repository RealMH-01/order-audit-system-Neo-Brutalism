from app.services.evidence_locator.field_aliases import _alias_match


def test_two_char_alias_matches_short_target():
    assert _alias_match("单价", "单价不一致") is True
    assert _alias_match("单价", "单价") is True
    assert _alias_match("数量", "数量") is True


def test_two_char_alias_rejects_long_target():
    assert _alias_match("单价", "该订单单价不该超过市场价说明文档很长很长") is False


def test_amount_alias_matches_total_amount():
    assert _alias_match("金额", "总金额") is True


def test_po_alias_matches_po_no():
    assert _alias_match("PO", "PO No") is True


def test_one_char_alias_is_rejected():
    assert _alias_match("P", "PO No") is False
    assert _alias_match("单", "单价") is False


def test_empty_or_none_is_rejected():
    assert _alias_match("", "单价") is False
    assert _alias_match("单价", "") is False
    assert _alias_match(None, "单价") is False
    assert _alias_match("单价", None) is False
