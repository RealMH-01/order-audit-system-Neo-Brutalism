# case_01_clean - 干净基线

## 埋雷说明
完全干净的一票，预期 0 RED 0 YELLOW 0 BLUE。

## 测试规则
stable_results

## 为什么这样埋
本 case 基于主票 HR-EXP2504001 的字段结构生成，先修正种子中已有的发票号少位、CI/PO 单价差异和 PL 品名拼写差异，再只保留本 case 需要验证的差异。

## 人工验证要点
- 打开 CI/PL Excel，检查 F9/F12/F10/F13、货品、数量、单价、金额、净重/毛重等关键字段。
- 打开 PO docx，检查 PO No.、PO Date、Contract No.、商品明细表、目的港和运输信息。
- 打开托书 docx，检查 Shipper/Consignee/Notify Party、Port of Loading、Port of Discharge、货品和 Invoice No.。
