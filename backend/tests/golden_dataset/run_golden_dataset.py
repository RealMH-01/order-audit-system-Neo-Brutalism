from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from api_client import (
    ApiClientConfig,
    GoldenDatasetApiClient,
    GoldenDatasetApiError,
    GoldenDatasetAuditTimeout,
)
from assertions import CaseAssertionResult, compare_result, error_result
from report import write_reports


SCRIPT_DIR = Path(__file__).resolve().parent
ENV_PATH = SCRIPT_DIR / ".env"
RUNS_DIR = SCRIPT_DIR / "runs"
REQUIRED_ENV_VARS = [
    "TEST_API_BASE_URL",
    "TEST_USER_EMAIL",
    "TEST_USER_PASSWORD",
    "TEST_DATASET_PATH",
    "TEST_REPORT_OUTPUT_DIR",
    "TEST_CONCURRENCY",
    "TEST_REQUEST_TIMEOUT_SECONDS",
    "TEST_AUDIT_POLL_INTERVAL_SECONDS",
    "TEST_AUDIT_POLL_MAX_SECONDS",
]


@dataclass(frozen=True)
class RunnerConfig:
    api_base_url: str
    user_email: str
    user_password: str
    dataset_path: Path
    report_output_dir: Path
    concurrency: int
    request_timeout_seconds: int
    audit_poll_interval_seconds: int
    audit_poll_max_seconds: int


class Logger:
    def __init__(self, log_path: Path) -> None:
        self.log_path = log_path
        self._lock = threading.Lock()
        self.log_path.parent.mkdir(parents=True, exist_ok=True)

    def __call__(self, message: str) -> None:
        stamp = datetime.now().strftime("%H:%M:%S")
        line = f"[{stamp}] {message}"
        with self._lock:
            print(line, flush=True)
            with self.log_path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")

    def file_only(self, message: str) -> None:
        stamp = datetime.now().strftime("%H:%M:%S")
        with self._lock:
            with self.log_path.open("a", encoding="utf-8") as handle:
                handle.write(f"[{stamp}] {message}\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="运行外贸单据 Golden Dataset 回归测试")
    parser.add_argument("--case", dest="case_id", help="只运行指定 case，例如 case_02_po_no_mismatch")
    parser.add_argument("--dry-run", action="store_true", help="只检查环境、登录和 expected.json，不上传或启动审核")
    args = parser.parse_args()

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    logger = Logger(RUNS_DIR / f"{timestamp}.log")

    try:
        config = load_config()
        logger("已加载环境变量配置。")
        case_dirs = discover_cases(config.dataset_path, args.case_id)
        logger(f"发现 {len(case_dirs)} 个待运行 case。")

        expected_by_case = load_expected_files(case_dirs)
        logger("expected.json 读取完成。")

        api_config = ApiClientConfig(
            base_url=config.api_base_url,
            timeout_seconds=config.request_timeout_seconds,
            poll_interval_seconds=config.audit_poll_interval_seconds,
            poll_max_seconds=config.audit_poll_max_seconds,
        )
        client = GoldenDatasetApiClient(api_config, logger)
        try:
            token = client.login(config.user_email, config.user_password)
            logger(f"登录成功，access_token 长度：{len(token)}。")
        finally:
            client.close()

        if args.dry_run:
            logger("dry-run 模式：已完成环境变量、登录和 expected.json 检查，不上传文件，不启动审核。")
            return 0

        logger(f"开始真实审核，最大并发：{config.concurrency}。")
        results = run_cases(
            case_dirs=case_dirs,
            expected_by_case=expected_by_case,
            api_config=api_config,
            token=token,
            logger=logger,
            concurrency=config.concurrency,
        )
        md_path, html_path = write_reports(results, config.report_output_dir, timestamp)
        logger(f"报告已生成：{md_path}")
        logger(f"报告已生成：{html_path}")

        pass_count = sum(1 for item in results if item.status == "PASS")
        fail_count = sum(1 for item in results if item.status == "FAIL")
        error_count = sum(1 for item in results if item.status == "ERROR")
        logger(f"运行完成：PASS={pass_count}，FAIL={fail_count}，ERROR={error_count}。")
        return 1 if fail_count or error_count else 0
    except Exception as exc:
        logger(f"脚本异常退出：{exc}")
        logger.file_only(traceback.format_exc())
        return 2


def load_config() -> RunnerConfig:
    load_dotenv(ENV_PATH)
    missing = [name for name in REQUIRED_ENV_VARS if not os.getenv(name)]
    if missing:
        raise RuntimeError(f"缺少环境变量：{', '.join(missing)}。请检查 {ENV_PATH}")

    return RunnerConfig(
        api_base_url=os.environ["TEST_API_BASE_URL"].strip(),
        user_email=os.environ["TEST_USER_EMAIL"].strip(),
        user_password=os.environ["TEST_USER_PASSWORD"],
        dataset_path=Path(os.environ["TEST_DATASET_PATH"]),
        report_output_dir=Path(os.environ["TEST_REPORT_OUTPUT_DIR"]),
        concurrency=parse_positive_int("TEST_CONCURRENCY"),
        request_timeout_seconds=parse_positive_int("TEST_REQUEST_TIMEOUT_SECONDS"),
        audit_poll_interval_seconds=parse_positive_int("TEST_AUDIT_POLL_INTERVAL_SECONDS"),
        audit_poll_max_seconds=parse_positive_int("TEST_AUDIT_POLL_MAX_SECONDS"),
    )


def parse_positive_int(name: str) -> int:
    value = int(os.environ[name])
    if value < 1:
        raise RuntimeError(f"{name} 必须大于 0")
    return value


def discover_cases(dataset_path: Path, case_id: str | None) -> list[Path]:
    if not dataset_path.exists():
        raise RuntimeError(f"测试集目录不存在：{dataset_path}")
    if case_id:
        case_dir = dataset_path / case_id
        if not case_dir.is_dir():
            raise RuntimeError(f"指定 case 不存在：{case_id}")
        return [case_dir]
    return sorted(path for path in dataset_path.iterdir() if path.is_dir() and path.name.startswith("case_"))


def load_expected_files(case_dirs: list[Path]) -> dict[str, dict[str, Any]]:
    expected_by_case: dict[str, dict[str, Any]] = {}
    for case_dir in case_dirs:
        expected_path = case_dir / "expected.json"
        with expected_path.open("r", encoding="utf-8") as handle:
            expected = json.load(handle)
        case_id = str(expected.get("case_id") or case_dir.name)
        expected_by_case[case_id] = expected
    return expected_by_case


def run_cases(
    *,
    case_dirs: list[Path],
    expected_by_case: dict[str, dict[str, Any]],
    api_config: ApiClientConfig,
    token: str,
    logger: Logger,
    concurrency: int,
) -> list[CaseAssertionResult]:
    if concurrency == 1:
        return [
            run_one_case(case_dir, expected_by_case[case_dir.name], api_config, token, logger)
            for case_dir in case_dirs
        ]

    results_by_case: dict[str, CaseAssertionResult] = {}
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = {
            executor.submit(
                run_one_case,
                case_dir,
                expected_by_case[case_dir.name],
                api_config,
                token,
                logger,
            ): case_dir.name
            for case_dir in case_dirs
        }
        for future in as_completed(futures):
            case_id = futures[future]
            results_by_case[case_id] = future.result()
    return [results_by_case[case_dir.name] for case_dir in case_dirs]


def run_one_case(
    case_dir: Path,
    expected: dict[str, Any],
    api_config: ApiClientConfig,
    token: str,
    logger: Logger,
) -> CaseAssertionResult:
    case_id = case_dir.name
    task_id: str | None = None
    client = GoldenDatasetApiClient(api_config, logger, token=token)
    try:
        logger(f"{case_id} 开始上传文件。")
        files = locate_case_files(case_dir)
        po_file_id = client.upload_file(files["po"])
        ci_file_id = client.upload_file(files["ci"])
        pl_file_id = client.upload_file(files["pl"])
        si_file_id = client.upload_file(files["si"])

        logger(f"{case_id} 文件上传完成，开始审核。")
        task_id = client.start_audit(po_file_id, [ci_file_id, pl_file_id, si_file_id])
        progress = client.wait_for_audit(task_id)
        status = str(progress.get("status", "")).lower()
        if status != "completed":
            return error_result(
                expected=expected,
                message=f"审核任务未成功完成，status={status}，message={progress.get('message', '')}",
                task_id=task_id,
                last_progress=progress,
            )

        actual = client.get_result(task_id)
        result = compare_result(expected=expected, actual=actual, task_id=task_id)
        logger(f"{case_id} 对比完成，状态：{result.status}。")
        return result
    except GoldenDatasetAuditTimeout as exc:
        logger(f"{case_id} 超时：{exc}")
        return error_result(expected=expected, message=str(exc), task_id=task_id, last_progress=exc.last_progress)
    except (GoldenDatasetApiError, OSError, ValueError) as exc:
        logger(f"{case_id} 异常：{exc}")
        return error_result(expected=expected, message=str(exc), task_id=task_id)
    finally:
        client.close()


def locate_case_files(case_dir: Path) -> dict[str, Path]:
    files = {
        "ci": one_match(case_dir, "CI-*.xlsx"),
        "pl": one_match(case_dir, "PL-*.xlsx"),
        "po": one_match(case_dir, "PO-*.docx"),
        "si": locate_shipping_instruction(case_dir),
    }
    return files


def locate_shipping_instruction(case_dir: Path) -> Path:
    candidates = [
        path
        for path in case_dir.glob("*.docx")
        if not path.name.startswith("PO-") and "托书" in path.name
    ]
    if len(candidates) != 1:
        raise RuntimeError(f"{case_dir.name} 托书 docx 文件数量异常：{len(candidates)}")
    return candidates[0]


def one_match(case_dir: Path, pattern: str) -> Path:
    candidates = list(case_dir.glob(pattern))
    if len(candidates) != 1:
        raise RuntimeError(f"{case_dir.name} 匹配 {pattern} 的文件数量异常：{len(candidates)}")
    return candidates[0]


if __name__ == "__main__":
    sys.exit(main())
