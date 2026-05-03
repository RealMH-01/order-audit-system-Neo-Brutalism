# Golden Dataset 回归测试

本目录用于运行外贸单据 AI 审核系统的黄金测试集回归。脚本会读取每个 case 的 `expected.json`，上传 CI/PL/PO/托书，启动审核，等待 SSE 进度完成，然后生成 Markdown 和 HTML 报告。

## 安装依赖

```powershell
cd C:\Users\37271\Documents\Codex\2026-04-22-github-round7-merge\backend\tests\golden_dataset
python -m pip install -r requirements.txt
```

## 配置 .env

复制 `.env.example` 为 `.env`，填入真实密码。`.env` 已被仓库根目录 `.gitignore` 忽略，不要提交。

```powershell
Copy-Item .env.example .env
notepad .env
```

变量说明：

| 变量 | 说明 |
|---|---|
| `TEST_API_BASE_URL` | API 域名根地址，不需要写 `/api`，脚本内部统一拼接。 |
| `TEST_USER_EMAIL` | 测试账号邮箱。 |
| `TEST_USER_PASSWORD` | 测试账号密码。 |
| `TEST_DATASET_PATH` | 第一阶段生成的 Golden Dataset 根目录。 |
| `TEST_REPORT_OUTPUT_DIR` | 报告输出目录。 |
| `TEST_CONCURRENCY` | 并发 case 数，默认建议 `1`。 |
| `TEST_REQUEST_TIMEOUT_SECONDS` | 普通 HTTP 请求超时秒数。 |
| `TEST_AUDIT_POLL_INTERVAL_SECONDS` | SSE 断线重连前等待秒数。 |
| `TEST_AUDIT_POLL_MAX_SECONDS` | 单个审核任务最大等待秒数。 |

## 运行

先做 dry-run，确认环境变量、登录和 `expected.json` 可读：

```powershell
python run_golden_dataset.py --dry-run
```

单独跑一个 case：

```powershell
python run_golden_dataset.py --case case_02_po_no_mismatch
```

跑全量 30 个 case：

```powershell
python run_golden_dataset.py
```

## 报告位置

每次运行都会在 `TEST_REPORT_OUTPUT_DIR` 下生成带时间戳的两份报告：

- `report_<timestamp>.md`
- `report_<timestamp>.html`

脚本运行日志会写入：

- `backend/tests/golden_dataset/runs/<timestamp>.log`

## 结果解读

- `PASS`：summary 区间、expected_issues 命中、must_not_contain 均满足。
- `FAIL`：接口正常返回，但存在 summary 超区间、漏报或误报。
- `ERROR`：接口超时、HTTP 异常、JSON 解析失败、任务状态为 `failed/cancelled` 等运行异常。

报告开头有总体摘要和按规则维度统计；中间是逐 case 明细；末尾列出 FAIL/ERROR 的实际 issue 与期望对比。
