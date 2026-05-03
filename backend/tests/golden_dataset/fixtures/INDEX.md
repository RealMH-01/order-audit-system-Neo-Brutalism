# 外贸单据 AI 审核系统 Golden Dataset 第一阶段

本目录包含 30 个 case。每个 case 均包含 CI、PL、PO、托书、expected.json 和 README.md。

| Case | 标题 | 测试规则 | RED | YELLOW | BLUE |
|---|---|---|---:|---:|---:|
| case_01_clean | 干净基线 | stable_results | 0-0 | 0-0 | 0-0 |
| case_02_po_no_mismatch | PO号不一致 | core_identifier_rules | 1-2 | 0-1 | 0-3 |
| case_03_invoice_no_missing_digit | 发票号末尾少一位 | fuzzy_id_matching | 1-2 | 0-1 | 0-3 |
| case_04_unit_price_mismatch | 单价不一致 | unit_price_order | 1-2 | 0-1 | 0-3 |
| case_05_amount_mismatch | 金额不一致 | business_field_severity | 1-2 | 0-1 | 0-3 |
| case_06_invoice_no_blank | 发票号为空 | invoice_focus | 1-2 | 0-1 | 0-3 |
| case_07_pl_gross_less_than_net | 装箱单毛重小于净重 | packing_list_focus | 1-2 | 0-1 | 0-3 |
| case_08_bl_scope_skipped | 提单规则范围跳过 | bill_of_lading_focus | 0-0 | 0-0 | 0-1 |
| case_09_si_port_mismatch | 托书港口不一致 | shipping_instruction_focus | 1-2 | 0-1 | 0-3 |
| case_10_customs_scope_skipped | 报关单规则范围跳过 | customs_declaration_focus | 0-0 | 0-0 | 0-1 |
| case_11_co_scope_skipped | 原产地证规则范围跳过 | certificate_origin_focus | 0-0 | 0-0 | 0-1 |
| case_12_lc_scope_skipped | 信用证规则范围跳过 | letter_credit_focus | 0-0 | 0-0 | 0-1 |
| case_13_contract_no_blank | 合同号明确为空 | missing_field_wording | 1-2 | 0-1 | 0-3 |
| case_14_invoice_date_mismatch | 日期不一致 | priority_fields | 1-2 | 0-1 | 0-3 |
| case_15_clear_quantity_conflict | 明确数量冲突 | evidence_only, business_field_severity | 1-2 | 0-1 | 0-3 |
| case_16_stable_clean_repeat | 稳定性复测基线 | stable_results | 0-0 | 0-0 | 0-1 |
| case_17_po_no_and_unit_price | PO号不一致 + 单价不一致 | core_identifier_rules, unit_price_order | 2-4 | 0-1 | 0-3 |
| case_18_amount_and_quantity | 金额不一致 + 数量不一致 | business_field_severity, priority_fields | 2-4 | 0-1 | 0-3 |
| case_19_invoice_blank_and_pl_weight | 发票号为空 + PL 毛净重矛盾 | invoice_focus, packing_list_focus | 2-4 | 0-1 | 0-3 |
| case_20_si_port_and_date | 托书港口不一致 + 日期不一致 | shipping_instruction_focus, priority_fields | 2-4 | 0-1 | 0-3 |
| case_21_fuzzy_po_and_currency | PO号少位 + 币种不一致 | fuzzy_id_matching, business_field_severity | 2-4 | 0-1 | 0-3 |
| case_22_affiliate_and_amount | 关联公司名称差异 + 金额不一致 | affiliate_downgrade, business_field_severity | 1-3 | 0-2 | 0-3 |
| case_23_product_and_po_no | 货品不一致 + PO号不一致 | invoice_focus, core_identifier_rules | 2-4 | 0-1 | 0-3 |
| case_24_invoice_no_and_contract_blank | 发票号不一致 + 合同号为空 | core_identifier_rules, missing_field_wording | 2-4 | 0-1 | 0-3 |
| case_25_invoice_no_equals_contract_no | 发票号等于合同号 | invoice_no_equals_contract_no | 0-0 | 0-0 | 0-1 |
| case_26_affiliate_downgrade | 关联公司名称差异降级 | affiliate_downgrade | 0-0 | 0-1 | 0-2 |
| case_27_format_spaces | 格式空格不规范但合规 | evidence_only | 0-0 | 0-0 | 0-2 |
| case_28_contract_no_missing_zero | 合同号少一个 0 | fuzzy_id_matching | 1-2 | 0-1 | 0-3 |
| case_29_po_no_case_diff | PO号末尾大小写不同 | fuzzy_id_matching, core_identifier_rules | 1-2 | 0-1 | 0-3 |
| case_30_po_no_zero_letter_o | PO号数字 0 写成字母 O | fuzzy_id_matching, core_identifier_rules | 1-2 | 0-1 | 0-3 |

## 跳过规则说明
- bill_of_lading_focus：本系统当前测试输入不上传 B/L，case_08 仅保留范围说明。
- customs_declaration_focus：本系统当前测试输入不上传报关单，case_10 仅保留范围说明。
- certificate_origin_focus：本系统当前测试输入不上传原产地证，case_11 仅保留范围说明。
- letter_credit_focus：本系统当前测试输入不上传信用证，case_12 仅保留范围说明。
- stable_results：不单独构造业务雷，由 case_01 与 case_16 的干净输入复测覆盖。
