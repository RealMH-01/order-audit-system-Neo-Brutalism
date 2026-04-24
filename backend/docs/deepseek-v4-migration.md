# DeepSeek V4 迁移说明

## 背景

DeepSeek 于 2026 年 4 月发布了 V4 系列模型，包括 `deepseek-v4-flash` 和 `deepseek-v4-pro`。旧模型名 `deepseek-chat` 和 `deepseek-reasoner` 将于 2026 年 7 月 24 日被官方废弃。

本项目在 Round 7 中完成了 V4 迁移。

## 模型对应关系

| 旧模型名 | 新模型名 | 用途 |
| --- | --- | --- |
| deepseek-chat | deepseek-v4-flash | 文本审核（非深度思考） |
| deepseek-reasoner | deepseek-v4-pro | 深度推理（深度思考模式） |

## V4 主要变化

- 上下文窗口：从 64K 提升到 1M（1,000,000 tokens）
- 最大输出：384K tokens
- 价格：`deepseek-v4-flash` 比旧版更便宜
- API 格式：仍然兼容 OpenAI 格式，`base_url` 不变（`https://api.deepseek.com`）

## 项目中的改动

### 前端

- 设置页模型下拉列表只展示 `deepseek-v4-flash` 和 `deepseek-v4-pro`
- 不再展示 `deepseek-chat` 和 `deepseek-reasoner`
- 加载历史 profile 时，自动将旧模型名映射为新名称显示

### 后端 llm_client.py

- `_resolve_model` 方法中，当 provider 为 `deepseek` 时：
  - 默认非深度思考模型：`deepseek-v4-flash`
  - 默认深度思考模型：`deepseek-v4-pro`
  - 收到 `deepseek-chat` 时自动映射为 `deepseek-v4-flash`
  - 收到 `deepseek-reasoner` 时自动映射为 `deepseek-v4-pro`
- `_resolve_provider` 未改动，`startswith("deepseek")` 对新旧模型名都有效

### 后端 token_utils.py

- 新增 `deepseek-v4-flash` 和 `deepseek-v4-pro` 的 token limit（1,000,000）
- 旧模型名的 token limit 也更新为 1,000,000，保持兼容

### 数据库

- `profiles` 表中 `selected_model` 字段可能存有旧值 `deepseek-chat` 或 `deepseek-reasoner`
- 后端读取时会自动归一化，前端保存时会写入新值
- 不需要执行数据库迁移脚本

## 注意事项

- 如果你的 Supabase `profiles` 表中有大量用户使用旧模型名，不需要手动更新。用户下次保存设置时会自动更新为新模型名。
- wizard 流程中的模型选择界面本轮未更新（按计划在后续轮次处理），但 wizard 保存的配置在后端调用时会自动走 V4 路径。
- `deepseek-v4-flash` 支持思考模式和非思考模式（通过 API 参数切换），但本项目当前将深度思考场景默认指向 `deepseek-v4-pro`。
