from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from html import escape
from pathlib import Path
from typing import Any

from assertions import CaseAssertionResult


def write_reports(results: list[CaseAssertionResult], output_dir: Path, timestamp: str) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    markdown_text = build_markdown_report(results, timestamp)
    md_path = output_dir / f"report_{timestamp}.md"
    html_path = output_dir / f"report_{timestamp}.html"
    md_path.write_text(markdown_text, encoding="utf-8")
    import markdown

    html_body = markdown.markdown(markdown_text, extensions=["tables", "fenced_code"])
    html_path.write_text(build_html_document(html_body), encoding="utf-8")
    return md_path, html_path


def build_markdown_report(results: list[CaseAssertionResult], timestamp: str) -> str:
    total = len(results)
    pass_count = sum(1 for item in results if item.status == "PASS")
    fail_count = sum(1 for item in results if item.status == "FAIL")
    error_count = sum(1 for item in results if item.status == "ERROR")
    denominator = pass_count + fail_count
    accuracy = pass_count / denominator * 100 if denominator else 0

    lines = [
        "# Golden Dataset 回归测试报告",
        "",
        f"- 生成时间：{timestamp}",
        f"- 总 case 数：{total}",
        f"- PASS：{pass_count}",
        f"- FAIL：{fail_count}",
        f"- ERROR：{error_count}",
        f"- 整体准确率：{accuracy:.2f}%（ERROR 不进入分母）",
        "",
        "## 按规则维度命中率",
        "",
        "| 规则 | 覆盖 case 数 | PASS case 数 | 漏报次数 | 误报次数 | ERROR case 数 |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for rule, stats in sorted(rule_stats(results).items()):
        lines.append(
            f"| {rule} | {stats['cases']} | {stats['pass_cases']} | {stats['missing']} | {stats['forbidden']} | {stats['errors']} |"
        )

    lines.extend(
        [
            "",
            "## Case 明细",
            "",
            "| Case | 规则 | 状态 | 实际 RED/YELLOW/BLUE | 漏报 | 误报 | 摘要问题 |",
            "|---|---|---|---|---:|---:|---|",
        ]
    )
    for result in results:
        summary = result.actual_summary
        lines.append(
            "| {case} | {rules} | {status} | {red}/{yellow}/{blue} | {missing} | {forbidden} | {summary_failures} |".format(
                case=result.case_id,
                rules=", ".join(result.tested_rules),
                status=result.status,
                red=summary.get("red", 0),
                yellow=summary.get("yellow", 0),
                blue=summary.get("blue", 0),
                missing=len(result.missing_expected_issues),
                forbidden=len(result.forbidden_issues),
                summary_failures="<br>".join(result.summary_failures) if result.summary_failures else "",
            )
        )

    lines.extend(["", "## 失败与异常详情", ""])
    for result in results:
        if result.status == "PASS":
            continue
        lines.extend(case_detail_lines(result))

    return "\n".join(lines) + "\n"


def rule_stats(results: list[CaseAssertionResult]) -> dict[str, dict[str, int]]:
    stats: dict[str, dict[str, int]] = defaultdict(
        lambda: {"cases": 0, "pass_cases": 0, "missing": 0, "forbidden": 0, "errors": 0}
    )
    for result in results:
        for rule in result.tested_rules:
            stats[rule]["cases"] += 1
            if result.status == "PASS":
                stats[rule]["pass_cases"] += 1
            elif result.status == "ERROR":
                stats[rule]["errors"] += 1
            stats[rule]["missing"] += len(result.missing_expected_issues)
            stats[rule]["forbidden"] += len(result.forbidden_issues)
    return stats


def case_detail_lines(result: CaseAssertionResult) -> list[str]:
    lines = [
        f"### {result.case_id} - {result.status}",
        "",
        f"- 规则：{', '.join(result.tested_rules)}",
        f"- task_id：{result.task_id or ''}",
    ]
    if result.error_message:
        lines.append(f"- 异常：{result.error_message}")
    if result.last_progress:
        lines.append(f"- 最后进度：`{jsonish(result.last_progress)}`")
    if result.summary_failures:
        lines.append(f"- Summary 超区间：{'；'.join(result.summary_failures)}")
    if result.missing_expected_issues:
        lines.append("- 漏报 expected_issues：")
        lines.append("```json")
        lines.append(jsonish(result.missing_expected_issues))
        lines.append("```")
    if result.forbidden_issues:
        lines.append("- 误报 must_not_contain：")
        lines.append("```json")
        lines.append(jsonish(result.forbidden_issues))
        lines.append("```")
    if result.actual_issues:
        lines.append("- 实际 issues：")
        lines.append("```json")
        lines.append(jsonish(result.actual_issues))
        lines.append("```")
    lines.append("")
    return lines


def jsonish(value: Any) -> str:
    import json

    return json.dumps(value, ensure_ascii=False, indent=2, default=str)


def build_html_document(body: str) -> str:
    css = """
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; line-height: 1.5; color: #17202a; }
table { border-collapse: collapse; width: 100%; margin: 16px 0 24px; }
th, td { border: 1px solid #cfd8dc; padding: 6px 8px; vertical-align: top; }
th { background: #f3f6f8; text-align: left; }
pre { background: #f7f7f7; border: 1px solid #ddd; padding: 12px; overflow-x: auto; }
td:has(> code), code { font-family: Consolas, "SFMono-Regular", monospace; }
body { --pass: #0f7b3f; --fail: #b42318; --error: #a15c00; }
"""
    highlighted = (
        body.replace(">PASS<", '><span style="color:#0f7b3f;font-weight:700">PASS</span><')
        .replace(">FAIL<", '><span style="color:#b42318;font-weight:700">FAIL</span><')
        .replace(">ERROR<", '><span style="color:#a15c00;font-weight:700">ERROR</span><')
    )
    return (
        "<!doctype html><html><head><meta charset=\"utf-8\">"
        f"<title>Golden Dataset Report</title><style>{css}</style></head>"
        f"<body>{highlighted}<footer><p>Generated at {escape(datetime.now().isoformat(timespec='seconds'))}</p></footer></body></html>"
    )
