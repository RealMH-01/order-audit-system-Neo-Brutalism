# 系统规则架构说明

本文说明审核系统中“系统规则”的来源、拼装方式、管理入口和新增种子规则的开发流程。

## 规则来源

当前审核任务只允许两类规则进入最终 prompt：

1. `system_hard_rules` 表中的系统硬规则
   - 由管理员统一维护。
   - 对所有用户、所有新的审核任务生效。
   - 只有 `is_enabled = true` 的规则会进入审核 prompt。
   - 读取顺序为 `sort_order ASC`，相同顺序下再按创建时间稳定排序。

2. 用户自定义规则，即用户 profile 中的 `active_custom_rules`
   - 由普通用户通过现有自定义规则入口维护。
   - 只影响该用户自己的审核任务。
   - 不属于系统硬规则，不能替代或覆盖系统硬规则。

旧的 built-in 规则不再是规则来源。`system_rules` 旧表和 `/api/rules/builtin` 兼容接口只用于历史调用方读取展示文本，不再提供写入能力。

## 审核 prompt 如何拼装

一次新的审核任务开始时，后端会读取当前启用的 `system_hard_rules`：

1. 查询 `system_hard_rules` 中 `is_enabled = true` 的记录。
2. 按 `sort_order ASC` 排序。
3. 调用 `build_audit_system_prompt(rules)` 拼成系统硬规则全文。
4. 再把当前用户的 `active_custom_rules` 作为用户自定义规则部分追加到审核上下文中。

最终进入审核任务的是：

```text
系统硬规则（来自 system_hard_rules）

用户自定义规则（来自 active_custom_rules）
```

系统硬规则优先级高于用户自定义规则。用户自定义规则不能要求模型违反系统硬规则。

## 管理员如何修改规则

管理员通过：

```text
/admin/system-rules
```

管理系统硬规则，可以执行：

- 新增规则
- 修改规则标题或正文
- 启用规则
- 停用规则
- 调整排序

所有写操作都会写入规则变更日志。修改后无需重启服务，下一次新审核任务会读取最新启用规则并立即生效。已经完成或正在运行中的历史审核不会被回写修改。

## 普通用户如何查看规则

普通用户只能查看当前生效的系统硬规则，不能修改。

主要只读入口：

```text
GET /api/system-rules
```

兼容只读入口：

```text
GET /api/rules/builtin
GET /api/rules/builtin/full
```

兼容入口会保持旧 JSON 响应结构，但其中展示规则文本会改为当前启用 `system_hard_rules` 经 `build_audit_system_prompt` 拼接后的全文。

## 已废弃的旧端点

以下旧端点不再作为规则维护入口：

```text
PUT /api/rules/builtin
```

该端点永久返回：

```json
{
  "detail": "该端点已废弃。请通过 /admin/system-rules 管理系统硬规则。"
}
```

HTTP 状态码为 `410 Gone`。

以下旧模板端点也已下线，后续可能完全移除：

```text
GET /api/rules/templates
POST /api/rules/templates
PUT /api/rules/templates/{template_id}
DELETE /api/rules/templates/{template_id}
POST /api/rules/templates/{template_id}/load
```

## 如何添加新种子规则

新增系统硬规则应通过数据库迁移写入 `system_hard_rules`，不要修改业务代码中的 prompt 常量。

迁移文件建议命名：

```text
backend/sql/migrations/{下一个可用编号}_add_system_hard_rule_<short_name>.sql
```

SQL 模板：

```sql
insert into public.system_hard_rules (
  code,
  title,
  content,
  is_enabled,
  sort_order,
  created_by,
  updated_by
)
values (
  'new_rule_code',
  '新规则标题',
  '新规则正文。请写清楚审核必须遵守的硬约束。',
  true,
  210,
  null,
  null
)
on conflict (code) do nothing;
```

添加前请确认：

- `code` 使用稳定英文 snake_case，不能与已有规则重复。
- `title` 简短明确，便于管理员后台识别。
- `content` 写成可直接进入审核 prompt 的规则文本。
- `sort_order` 与现有规则保持间隔，通常按 10 递增，方便后续插入。
- 默认是否启用应由产品或审核负责人确认。

默认种子 migration 不应覆盖已有规则。如果确实需要更新已有规则，不要通过种子 migration 静默覆盖；应优先由管理员后台手动编辑，或单独写明目的、影响范围和回滚方案后再执行。

本地验证建议：

```bash
git grep -n -E "_SYSTEM_PROMPT|SYSTEM_PROMPT_TEXT" -- backend/app frontend
python -m compileall backend/app
```

生产执行迁移前，应由人工确认 SQL 内容和执行窗口。本项目代码改动不应直接连接生产 Supabase 或在开发任务中执行生产 SQL。
