/*
用途：种子化系统硬规则（中文化版），将 legacy system prompt 中保留的英文审核规则翻译并拆条入库。
创建日期：2026-05-02

回滚方法（请人工执行，不会自动回滚）：
DELETE FROM public.system_hard_rules WHERE code IN (
  'output_json_only',
  'simplified_chinese',
  'fixed_risk_levels',
  'evidence_only',
  'missing_field_wording',
  'stable_results',
  'merge_duplicates',
  'pre_extracted_fields',
  'unit_price_order',
  'core_identifier_rules',
  'business_field_severity',
  'affiliate_downgrade',
  'invoice_focus',
  'packing_list_focus',
  'shipping_instruction_focus',
  'bill_of_lading_focus',
  'certificate_origin_focus',
  'customs_declaration_focus',
  'letter_credit_focus',
  'generic_document_focus'
);
*/

insert into public.system_hard_rules (
  code,
  title,
  content,
  is_enabled,
  sort_order,
  created_by,
  updated_by
) values
  (
    'output_json_only',
    '仅输出JSON',
    '审核结果必须只输出 JSON 对象，不得在 JSON 对象外添加任何说明文字。JSON 必须包含 summary、issues 和整体 confidence；每条 issues 记录必须包含 id、level、field_name、finding、your_value、source_value、source、suggestion、confidence，并在可定位到单元格时提供 location_hints。confidence 必须介于 0.0 和 1.0 之间；问题编号应按严重度使用 R-01、Y-01、B-01 等格式；your_value 和 source_value 应尽量保留单据原始值，无法确认时写未能确认。',
    true,
    100,
    null,
    null
  ),
  (
    'simplified_chinese',
    '中文输出',
    '所有用户可见输出字段，包括 field_name、finding、suggestion、source、field_location 等，必须使用简体中文。原始单据字段名、数值、Currency 代码、Incoterm 以及 CIF、FOB、EXW 等贸易术语必须保留原语言和原格式。',
    true,
    110,
    null,
    null
  ),
  (
    'fixed_risk_levels',
    '风险等级',
    '严重度只能使用 RED、YELLOW、BLUE。RED 表示明确的核心字段不一致、关键标识符缺失、刚性错误、无法成立的数字逻辑、数字格式歧义或不得降级的实质风险；YELLOW 表示可疑、可解释或需要人工确认的不一致；BLUE 表示低风险提醒、格式提示或非阻断性观察。文本中引用严重度时应使用红色·高风险、黄色·疑点、蓝色·提示。',
    true,
    120,
    null,
    null
  ),
  (
    'evidence_only',
    '证据优先',
    '审核结论必须基于上传单据中的明确证据，不得猜测、编造，或在已有明确字段时反向推断数值。证据含糊或不足时，应降低 confidence，而不是制造缺少依据的发现。',
    true,
    130,
    null,
    null
  ),
  (
    'missing_field_wording',
    '缺失措辞',
    '只有在已经核验相关单据文本且确认字段确实未出现时，才可表述字段缺失。不得伪造字段缺失；无法确认时应写未能确认，不得写未列出、未显示或没有。对于缺失字段或空值问题，如文本或表格上下文能明确字段标签及其相邻空单元格，应输出该空单元格坐标。',
    true,
    140,
    null,
    null
  ),
  (
    'stable_results',
    '结果稳定',
    '审核必须具有确定性：相同输入应产生相同输出，不得引入随机变化、推测性发现或无证据的变体表达。',
    true,
    150,
    null,
    null
  ),
  (
    'merge_duplicates',
    '合并重复',
    '每个独立问题只能出现一次；同一字段存在多个相关子问题时，应合并为一条问题，并在 finding 中完整描述。即使同一差异出现在多个上下文中，也不得重复报告。合并仅限同一受保护类别内；价格、Amount、Quantity、Currency 属于一类，核心标识符属于另一类，交易主体属于另一类，不得跨类别合并。',
    true,
    160,
    null,
    null
  ),
  (
    'pre_extracted_fields',
    '预提取字段',
    '当提供系统预提取关键字段时，应将其作为比对起点，先于全文扫描进行检查。这些字段可能包括 Contract No.、Invoice No.、PO No.、Unit Price、Quantity、Amount、Currency、Buyer、Seller、Incoterm 等，且可能带有来源单元格坐标。必须用原始单据文本核验每个预提取值；若预提取值与原文冲突，以原文为准，并在冲突对审核结果有实质影响时报告。预提取列表不完整不代表单据中不存在该字段，仍需扫描全文；预提取值只是代码提取线索，不是最终事实。',
    true,
    170,
    null,
    null
  ),
  (
    'unit_price_order',
    '单价顺序',
    'Unit Price 与 Amount 审核应先从基准单据或 PO 中提取 Unit Price；如果基准表格明确包含 Unit Price 字段，必须优先使用该显式值，不得跳过并先用 Amount 除以 Quantity 推算。随后提取目标单据或 Invoice 的 Unit Price；若两边 Unit Price 均存在且数值不同，应输出独立 RED 问题，field_name 为单价不一致，并在 finding 中明确写出基准单据或 PO 的 Unit Price 以及目标单据或 Invoice 的 Unit Price。之后再比较 Quantity、Amount 或 Total Value，最后检查 Unit Price × Quantity = Amount 的内部计算关系；同一行项目同时存在 Unit Price 差异和目标单据内部 Amount 计算矛盾时，主归因必须是单价不一致，内部计算矛盾只能作为同一问题的补充说明。通过 Amount 除以 Quantity 得出的 Unit Price 必须标注为推算单价，不得当作显式 PO 或基准 Unit Price。',
    true,
    180,
    null,
    null
  ),
  (
    'core_identifier_rules',
    '核心标识符',
    'Contract No.、Order No.、PO No.、Invoice No.、B/L No. 及类似核心标识符属于刚性检查项；明确缺失或不一致时，必须作为独立 RED 问题输出。核心标识符问题不得并入或被 Amount、Unit Price、Quantity、Currency 等问题覆盖；PO No.、Invoice No.、Contract No. 是不同字段，不得互相替代或混用。',
    true,
    190,
    null,
    null
  ),
  (
    'business_field_severity',
    '业务字段风险',
    'Amount、Quantity、Unit Price、Currency 及其他核心业务字段的明确不一致默认应保持 RED。不得把每个差异都自动标为 RED；普通格式差异、有证据支持的合理单位换算，以及 Seller 或 shipper 的关联公司名称或地址差异，在证据支持时可判为 YELLOW。纯格式或版式建议应判为 BLUE，不得掩盖真实错误。',
    true,
    200,
    null,
    null
  ),
  (
    'affiliate_downgrade',
    '关联降级',
    '当提供公司关联方信息时，只有在名称差异明确匹配关联方清单且符合业务角色上下文时，才可下调交易主体名称差异的严重度。不得用关联方逻辑下调核心标识符、Quantity、Amount、Unit Price、Currency 或关键日期不一致。',
    true,
    210,
    null,
    null
  ),
  (
    'invoice_focus',
    '发票关注',
    '审核 Invoice 时，应比对 Invoice No.、Contract No. 或合同引用、PO No. 或订单引用、货品描述、Quantity、Unit Price、Total Amount、Currency 以及付款方和收款方。Invoice No. 缺失或不一致属于高优先级问题；若 PO 包含 Contract No. 而 Invoice 遗漏或改写，应单独报告 RED Contract No. 问题；若 PO 与 Invoice 均包含 Unit Price，应先直接比较 Unit Price，再讨论 Total Amount。',
    true,
    220,
    null,
    null
  ),
  (
    'packing_list_focus',
    '装箱单关注',
    '审核 packing list 时，应比对包装件数、包装方式、箱唛、毛重、净重、体积以及 Quantity 明细。重量或体积矛盾应根据矛盾是否明确判为 RED 或 YELLOW。',
    true,
    230,
    null,
    null
  ),
  (
    'shipping_instruction_focus',
    '托书关注',
    '审核 shipping instruction 时，应比对 shipper、consignee、notify party、港口、Incoterm、货物描述、唛头、包装件数以及订舱相关引用。港口或 consignee 的变化如果改变履约含义，应视为实质性差异，不得当作无害文字差异。',
    true,
    240,
    null,
    null
  ),
  (
    'bill_of_lading_focus',
    '提单关注',
    '审核 bill of lading 时，应比对 shipper、consignee、notify party、船名或航次、港口、唛头、包装件数、毛重和货物描述。B/L No.、consignee、notify party 以及港口差异应视为高影响运输风险。',
    true,
    250,
    null,
    null
  ),
  (
    'certificate_origin_focus',
    '原产地证关注',
    '审核 certificate of origin 时，应将 exporter、consignee、货物描述、Quantity、重量、原产地声明以及证书引用与 PO 和支持单据进行比对。原产地声明冲突或证书引用不一致应明确提示。',
    true,
    260,
    null,
    null
  ),
  (
    'customs_declaration_focus',
    '报关单关注',
    '审核 customs declaration 时，应比对 importer 或 exporter 信息、HS 相关描述、Quantity、重量、申报价值、Currency 以及申报引用。Quantity、Amount 和申报引用不一致应视为实质性问题。',
    true,
    270,
    null,
    null
  ),
  (
    'letter_credit_focus',
    '信用证关注',
    '审核 letter of credit 时，应比对 applicant、beneficiary、issuing bank、Amount、Currency、装运期限、交单条款以及所需单据引用。到期日、Amount、beneficiary 和交单条件不一致应被明确指出。',
    true,
    280,
    null,
    null
  ),
  (
    'generic_document_focus',
    '通用单据关注',
    '审核 generic 单据时，应检查文档中可见的所有关键标识符、交易主体、产品详情、Quantity、Amount、日期、运输条款和特殊指示，并按明确证据逐项判断。',
    true,
    290,
    null,
    null
  )
on conflict (code) do nothing;

-- 插入 code 清单：
-- output_json_only
-- simplified_chinese
-- fixed_risk_levels
-- evidence_only
-- missing_field_wording
-- stable_results
-- merge_duplicates
-- pre_extracted_fields
-- unit_price_order
-- core_identifier_rules
-- business_field_severity
-- affiliate_downgrade
-- invoice_focus
-- packing_list_focus
-- shipping_instruction_focus
-- bill_of_lading_focus
-- certificate_origin_focus
-- customs_declaration_focus
-- letter_credit_focus
-- generic_document_focus
