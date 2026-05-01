# 外贸跟单单据智能审核系统

基于 AI 的外贸跟单单据审核工具，前后端分离架构，Neo-Brutalism 风格界面。

## 项目简介

本系统帮助外贸跟单团队自动审核贸易单据（发票、装箱单、提单、信用证等），通过 AI 模型对比 PO 基准文件与待审核文件，自动发现字段不一致、遗漏、格式错误等问题，并按 RED（严重）/ YELLOW（警告）/ BLUE（提示）三级标记输出审核结果。

核心功能：

- 多文件并行审核（PO 基准 + 多份待审核文件 + 上一票文件 + 模板 + 参考文件）
- 支持 OpenAI、DeepSeek V4、智谱 GLM 三家模型提供商
- 自定义审核规则（AI 引导生成 + 手动维护）
- 集团关联公司智能降级（RED 自动降为 YELLOW）
- 审核报告导出（标记版 Excel、详情版 Excel、ZIP 打包）
- Supabase Auth 认证，无 Supabase 时自动切换 RuntimeStore 内存态 fallback

## 技术栈

### 后端

- Python 3.11 + FastAPI + asyncio
- OpenAI SDK / ZhipuAI SDK（统一封装，支持 DeepSeek V4）
- pdfplumber / python-docx / openpyxl / Pillow / pdf2image（文件解析）
- Supabase（PostgreSQL + Auth + Row Level Security）
- cryptography（API Key Fernet 加密存储）

### 前端

- Next.js 14（App Router）
- TypeScript
- Tailwind CSS + Neo-Brutalism 自定义组件
- React Context + useReducer 状态管理
- lucide-react 图标库

### 部署目标

- 后端：阿里云 ECS（Nginx + systemd + uvicorn）
- 前端：Vercel
- 数据库与认证：Supabase

实际请求链路：

```text
用户浏览器 → Vercel 前端 → Vercel rewrite 转发 → 阿里云 ECS (8.136.189.224) Nginx → FastAPI (uvicorn)
```

后端更新步骤：

```bash
ssh root@8.136.189.224
cd /opt/order-audit-system-Neo-Brutalism
git pull origin main
sudo systemctl restart order-audit-backend.service
```

详细部署指南请参考 [部署文档](backend/docs/deployment.md) 和 [部署检查清单](docs/deploy-checklist.md)。

## 项目结构

```text
.
  backend/
    app/
      routers/          -- FastAPI 路由（auth, audit, settings, rules, wizard, files, health）
      services/         -- 业务逻辑（auth, audit_orchestrator, audit_engine, llm_client, report_generator, wizard_engine, settings, rules_config, file_parser, token_utils）
      db/               -- 数据层（repository, supabase_client, init_data, runtime_store）
      models/           -- Pydantic schemas
      config.py         -- 环境变量配置
      dependencies.py   -- FastAPI 依赖注入
      errors.py         -- 统一错误类
      main.py           -- 应用入口
    sql/
      supabase_schema.sql                -- 数据库建表脚本
      migrations/
        001_auth_profiles_trigger.sql    -- 认证触发器
        002_audit_report_paths.sql       -- 审核报告路径迁移
    docs/               -- 项目文档
    requirements.txt
    Dockerfile
    render.yaml
    .env.example
  frontend/
    src/
      app/              -- Next.js 页面路由
      components/       -- UI 组件（audit, wizard, shared, ui）
      lib/              -- API 工具函数
      styles/           -- 全局样式
      types/            -- TypeScript 类型定义
    package.json
    .env.example
  README.md
```

## 本地开发

### 后端

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows 用: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# 编辑 .env，填入 Supabase 和 LLM API 密钥
uvicorn app.main:app --reload
```

后端默认运行在 `http://localhost:8000`，API 文档在 `http://localhost:8000/docs`。

不配置 Supabase 环境变量时，系统会自动切换到 RuntimeStore 内存态 fallback 模式，所有功能仍可正常使用，但数据不会持久化。

### 前端

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

前端默认运行在 `http://localhost:3000`。

## Supabase 配置

首次使用 Supabase 时需要完成以下配置：

1. 在 Supabase Dashboard 中关闭邮件确认：Authentication - Providers - Email - Confirm email - 关闭
2. 在 SQL Editor 中按顺序执行以下 SQL：
   - `backend/sql/supabase_schema.sql`
   - `backend/sql/migrations/001_auth_profiles_trigger.sql`
   - `backend/sql/migrations/002_audit_report_paths.sql`
3. 在后端 `.env` 中填入 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`ENCRYPTION_KEY`

`ENCRYPTION_KEY` 必须是有效的 Fernet key，可通过以下命令生成：

```python
from cryptography.fernet import Fernet
print(Fernet.generate_key().decode())
```

## 支持的模型

| 提供商 | 模型名 | 用途 |
| --- | --- | --- |
| OpenAI | gpt-4o | 文本审核 + 视觉/OCR |
| OpenAI | o3-mini | 深度推理 |
| DeepSeek | deepseek-v4-flash | 文本审核（默认） |
| DeepSeek | deepseek-v4-pro | 深度推理 |
| 智谱 | glm-4-flash | 文本审核 |
| 智谱 | glm-4v | 视觉/OCR |

DeepSeek V4 于 2026 年 4 月发布。旧模型名 `deepseek-chat` 和 `deepseek-reasoner` 将于 2026/07/24 被废弃，系统已完成迁移但后端保留兼容映射。

## 开发进度

| 轮次 | 内容 | 状态 |
| --- | --- | --- |
| Round 1-3 | 项目骨架、模块划分、数据库设计、前端结构 | 已完成 |
| Round 4 | 审核引擎主链路（文件解析、Prompt 构造、模型调用、结果修正、报告生成） | 已完成 |
| Round 5 | Supabase Auth 认证集成 + RuntimeStore fallback | 已完成 |
| Round 6 | 报告下载（标记版 Excel、详情版 Excel、ZIP） | 已完成 |
| Round 7 | 真实 LLM 连接测试 + DeepSeek V4 迁移 | 已完成 |
| Round 8 | 前端加固（Auth Guard、logout、拖拽上传、骨架屏） | 计划中 |
| Round 9 | 部署与生产准备 | 计划中 |

## 已知限制

- 审核报告已持久化到 Supabase Storage，后端重启后仍可通过审核历史页面重新下载。
- DeepSeek 不支持视觉/OCR 输入，扫描件审核时系统会自动切换到 OpenAI 或智谱。
- 连接测试仅验证 API Key 有效性和基本连通性，不测试完整审核链路。

## 运维文档

Let's Encrypt 证书自动续签使用 DNS-01 验证 + DNSPod API hook，详见[运维文档](docs/ops/letsencrypt-renewal.md)。
