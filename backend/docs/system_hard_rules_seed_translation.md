# 系统硬规则中文种子翻译对照

本附录用于审查 `008_seed_system_hard_rules_chinese.sql` 中的系统硬规则中文化种子内容。英文原文片段来自 `backend/docs/legacy_system_prompt_reference.md`，中文 content 列仅摘录每条规则首句或首个核心句。

| code | 中文 title | 英文原文片段（来自 legacy 文档） | 中文 content（首句） |
| --- | --- | --- | --- |
| output_json_only | 仅输出JSON | Output only JSON. Do not add prose outside the JSON object. / Return a JSON object with this exact shape. / Every issue must include confidence between 0.0 and 1.0. | 审核结果必须只输出 JSON 对象，不得在 JSON 对象外添加任何说明文字。 |
| simplified_chinese | 中文输出 | All user-facing text in your output (field_name, finding, suggestion, source, field_location) MUST be in Simplified Chinese. / Preserve original field names, numbers, currency codes, and Incoterms. | 所有用户可见输出字段，包括 field_name、finding、suggestion、source、field_location 等，必须使用简体中文。 |
| fixed_risk_levels | 风险等级 | RED means a clear core-field mismatch, a missing critical identifier, or a material risk that must not be downgraded. / YELLOW means suspicious, explainable, or review-required inconsistency. / BLUE means low-risk reminder, formatting notice, or non-blocking observation. | 严重度只能使用 RED、YELLOW、BLUE。 |
| evidence_only | 证据优先 | Audit conclusions must be based on explicit evidence in the uploaded documents. Do not guess, fabricate, or reverse-infer a value when an explicit field is available. / If evidence is ambiguous or insufficient, lower the confidence score rather than fabricating a finding. | 审核结论必须基于上传单据中的明确证据，不得猜测、编造，或在已有明确字段时反向推断数值。 |
| missing_field_wording | 缺失措辞 | Never state that a field is absent unless you have verified that it does not appear in the relevant document text. If uncertain, write “未能确认” instead of “未列出/未显示/没有”. | 只有在已经核验相关单据文本且确认字段确实未出现时，才可表述字段缺失。 |
| stable_results | 结果稳定 | Be deterministic: given the same inputs, produce the same output. Do not introduce variation or speculative findings. | 审核必须具有确定性：相同输入应产生相同输出，不得引入随机变化、推测性发现或无证据的变体表达。 |
| merge_duplicates | 合并重复 | Each distinct problem should appear exactly once. / Do not report the same discrepancy more than once even if it appears in multiple contexts. / Do not merge issues across protected categories. | 每个独立问题只能出现一次；同一字段存在多个相关子问题时，应合并为一条问题，并在 finding 中完整描述。 |
| pre_extracted_fields | 预提取字段 | Use these pre-extracted fields as your STARTING POINT for comparison. / You MUST verify every pre-extracted value against the original document text. / Do not blindly trust pre-extracted values. They are code-extracted hints, not ground truth. | 当提供系统预提取关键字段时，应将其作为比对起点，先于全文扫描进行检查。 |
| unit_price_order | 单价顺序 | First extract Unit Price / 单价 from the baseline document / PO. / If both unit prices exist and their numeric values differ, output an independent RED issue. / If a unit price was obtained by Amount ÷ Quantity, label it as “推算单价”. | Unit Price 与 Amount 审核应先从基准单据或 PO 中提取 Unit Price；如果基准表格明确包含 Unit Price 字段，必须优先使用该显式值，不得跳过并先用 Amount 除以 Quantity 推算。 |
| core_identifier_rules | 核心标识符 | Contract No., Order No., PO No., Invoice No., B/L No. and similar core identifiers that are clearly missing or inconsistent must be output as independent RED issues. / PO No., Invoice No., and Contract No. are different fields and must not be treated as interchangeable. | Contract No.、Order No.、PO No.、Invoice No.、B/L No. 及类似核心标识符属于刚性检查项；明确缺失或不一致时，必须作为独立 RED 问题输出。 |
| business_field_severity | 业务字段风险 | Clear mismatches in amount, quantity, unit price, currency, and other core business fields are RED by default. / Do not mark every difference RED automatically. / Pure formatting or layout suggestions are BLUE. | Amount、Quantity、Unit Price、Currency 及其他核心业务字段的明确不一致默认应保持 RED。 |
| affiliate_downgrade | 关联降级 | When company affiliates are provided, you may downgrade only party-name discrepancies that clearly match the affiliate list and business role context. Never use affiliate logic to downgrade core identifier, quantity, amount, unit-price, currency, or critical date mismatches. | 当提供公司关联方信息时，只有在名称差异明确匹配关联方清单且符合业务角色上下文时，才可下调交易主体名称差异的严重度。 |
| invoice_focus | 发票关注 | Document-specific focus for invoice: Compare invoice number, contract reference, PO reference, item descriptions, quantities, unit prices, total amount, currency, and payer/payee parties. | 审核 Invoice 时，应比对 Invoice No.、Contract No. 或合同引用、PO No. 或订单引用、货品描述、Quantity、Unit Price、Total Amount、Currency 以及付款方和收款方。 |
| packing_list_focus | 装箱单关注 | Document-specific focus for packing list: Compare package count, packing method, carton marks, gross weight, net weight, volume, and quantity breakdown. | 审核 packing list 时，应比对包装件数、包装方式、箱唛、毛重、净重、体积以及 Quantity 明细。 |
| shipping_instruction_focus | 托书关注 | Document-specific focus for shipping instruction: Compare shipper, consignee, notify party, ports, Incoterm, cargo description, marks, package count, and booking-related references. | 审核 shipping instruction 时，应比对 shipper、consignee、notify party、港口、Incoterm、货物描述、唛头、包装件数以及订舱相关引用。 |
| bill_of_lading_focus | 提单关注 | Document-specific focus for bill of lading: Compare shipper, consignee, notify party, vessel or voyage, ports, marks, package count, gross weight, and cargo description. | 审核 bill of lading 时，应比对 shipper、consignee、notify party、船名或航次、港口、唛头、包装件数、毛重和货物描述。 |
| certificate_origin_focus | 原产地证关注 | Document-specific focus for certificate of origin: Compare exporter, consignee, goods description, quantity, weight, origin declaration, and certificate references against the PO and supporting documents. | 审核 certificate of origin 时，应将 exporter、consignee、货物描述、Quantity、重量、原产地声明以及证书引用与 PO 和支持单据进行比对。 |
| customs_declaration_focus | 报关单关注 | Document-specific focus for customs declaration: Compare importer or exporter details, HS-related description, quantity, weight, declared value, currency, and declaration references. | 审核 customs declaration 时，应比对 importer 或 exporter 信息、HS 相关描述、Quantity、重量、申报价值、Currency 以及申报引用。 |
| letter_credit_focus | 信用证关注 | Document-specific focus for letter of credit: Compare applicant, beneficiary, issuing bank, amount, currency, shipment deadlines, presentation terms, and required document references. | 审核 letter of credit 时，应比对 applicant、beneficiary、issuing bank、Amount、Currency、装运期限、交单条款以及所需单据引用。 |
| generic_document_focus | 通用单据关注 | Document-specific focus: Audit all key identifiers, parties, product details, quantities, amounts, dates, transport terms, and special instructions visible in the document. | 审核 generic 单据时，应检查文档中可见的所有关键标识符、交易主体、产品详情、Quantity、Amount、日期、运输条款和特殊指示，并按明确证据逐项判断。 |

## 既有 code 冲突时的人工复核说明

本次 migration 使用 `ON CONFLICT (code) DO NOTHING`，不会覆盖生产库中已经存在的系统硬规则。

因此，如果生产库已存在以下 code，本次 migration 中对应的新版中文内容不会自动写入：

- evidence_only
- simplified_chinese
- fixed_risk_levels
- merge_duplicates
- stable_results

迁移执行后，管理员需要在 `/admin/system-rules` 中人工检查这些既有规则的 content 是否已经覆盖本文件对应语义。

如既有规则内容较短或不完整，建议管理员在后台手动编辑这些规则，而不是通过 migration 覆盖，以避免误覆盖已有人工维护内容。

重点检查：
- simplified_chinese 是否明确要求用户可见字段使用简体中文，并保留原始字段名、数值、Currency、Incoterm；
- fixed_risk_levels 是否完整定义 RED、YELLOW、BLUE；
- evidence_only 是否明确禁止猜测、编造、反向推断；
- merge_duplicates 是否明确禁止重复报告，并说明不得跨受保护类别合并；
- stable_results 是否明确相同输入应产生稳定输出。
