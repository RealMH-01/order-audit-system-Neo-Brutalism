"""报告生成服务：输出标记版、详情版 Excel，并支持 ZIP 打包。"""

from __future__ import annotations

import io
import zipfile
from typing import Any

from app.errors import AppError
from app.models.schemas import FeatureStatus
from app.services.report_filename import build_report_filename, pick_report_identifier

try:
    from openpyxl import Workbook
    from openpyxl.comments import Comment
    from openpyxl.styles import Font, PatternFill
except Exception:  # pragma: no cover
    Workbook = None
    Comment = None
    Font = None
    PatternFill = None

_LEVEL_FILLCOLORS = {
    "RED": "FECACA",
    "YELLOW": "FEF08A",
    "BLUE": "BFDBFE",
}


class ReportGeneratorService:
    """根据审核结果生成内存态 Excel 与 ZIP 报告。"""

    def get_features(self) -> list[FeatureStatus]:
        """返回当前报告生成模块能力说明。"""

        return [
            FeatureStatus(
                name="标记版与详情版报告导出",
                ready=True,
                note="已支持 Excel 输出、单元格标色、批注置信度和 ZIP 打包。",
            )
        ]

    def generate_marked_report(self, task_id: str, audit_result: dict[str, Any]) -> io.BytesIO:
        """生成标记版 Excel 报告。"""

        workbook = self._new_workbook()
        sheet = workbook.active
        sheet.title = "审核问题标记汇总"
        sheet.append(["任务 ID", task_id])
        sheet.append(["红色", audit_result.get("summary", {}).get("red", 0)])
        sheet.append(["黄色", audit_result.get("summary", {}).get("yellow", 0)])
        sheet.append(["蓝色", audit_result.get("summary", {}).get("blue", 0)])
        sheet.append([])

        headers = ["序号", "级别", "字段", "问题说明", "建议", "文档类型", "文件 ID"]
        sheet.append(headers)
        self._set_column_widths(sheet, [12, 16, 20, 50, 40, 16, 20])
        self._style_header_row(sheet, row_index=6)

        for index, issue in enumerate(self._extract_issues(audit_result), start=1):
            level = issue.get("level", "YELLOW")
            row = [
                issue.get("id", f"issue-{index:03d}"),
                self._localize_level(str(level)),
                issue.get("field_name", "unspecified_field"),
                issue.get("finding") or issue.get("message", ""),
                issue.get("suggestion", ""),
                issue.get("document_type", ""),
                issue.get("file_id", ""),
            ]
            sheet.append(row)
            current_row = sheet.max_row
            self._mark_issue_row(sheet, current_row, str(level), float(issue.get("confidence", 0.5)))

        self._apply_wrap_text(sheet, start_row=1)
        sheet.freeze_panes = "A7"
        return self._workbook_to_bytes(workbook)

    def generate_detail_report(self, task_id: str, audit_result: dict[str, Any]) -> io.BytesIO:
        """生成详情版 Excel 报告。"""

        workbook = self._new_workbook()
        summary_sheet = workbook.active
        summary_sheet.title = "审核摘要"
        summary_sheet.append(["任务 ID", task_id])
        summary_sheet.append(["整体置信度", f"{float(audit_result.get('confidence', 0.5)) * 100:.1f}%"])
        summary_sheet.append(["红色问题数", audit_result.get("summary", {}).get("red", 0)])
        summary_sheet.append(["黄色问题数", audit_result.get("summary", {}).get("yellow", 0)])
        summary_sheet.append(["蓝色问题数", audit_result.get("summary", {}).get("blue", 0)])
        summary_sheet.append(["备注", "\n".join(audit_result.get("notes", [])) or ""])

        issue_sheet = workbook.create_sheet("问题详情")
        headers = [
            "序号",
            "级别",
            "字段",
            "问题说明",
            "建议",
            "置信度",
            "PO 值",
            "观察值",
            "引用片段",
            "文档类型",
            "文件 ID",
        ]
        headers.extend(["源文件名", "定位单元格", "标记状态", "未标记原因", "定位置信度"])
        issue_sheet.append(headers)
        self._set_column_widths(issue_sheet, [12, 16, 20, 50, 40, 12, 24, 24, 40, 16, 20, 24, 28, 18, 36, 14])
        self._style_header_row(issue_sheet, row_index=1)

        for index, issue in enumerate(self._extract_issues(audit_result), start=1):
            level = issue.get("level", "YELLOW")
            issue_sheet.append(
                [
                    issue.get("id", f"issue-{index:03d}"),
                    self._localize_level(str(level)),
                    issue.get("field_name", "unspecified_field"),
                    issue.get("finding") or issue.get("message", ""),
                    issue.get("suggestion", ""),
                    f"{float(issue.get('confidence', 0.5)) * 100:.1f}%",
                    issue.get("matched_po_value") or issue.get("source_value", ""),
                    issue.get("observed_value") or issue.get("your_value", ""),
                    issue.get("source_excerpt", ""),
                    issue.get("document_type", ""),
                    issue.get("file_id", ""),
                    self._source_file_name(issue),
                    self._location_refs(issue),
                    issue.get("mark_status", ""),
                    "" if issue.get("mark_status") == "marked" else issue.get("mark_reason", ""),
                    self._location_confidence(issue),
                ]
            )
            current_row = issue_sheet.max_row
            self._mark_issue_row(issue_sheet, current_row, str(level), float(issue.get("confidence", 0.5)))

        self._apply_wrap_text(issue_sheet, start_row=1)
        issue_sheet.freeze_panes = "A2"
        return self._workbook_to_bytes(workbook)

    def generate_report_zip(
        self,
        task_id: str,
        audit_result: dict[str, Any],
        audit_context: Any | None = None,
        filenames: dict[str, str] | None = None,
    ) -> io.BytesIO:
        """把面向用户的标记版和详情版报告打包为 ZIP。"""

        marked = self.generate_marked_report(task_id, audit_result)
        detailed = self.generate_detail_report(task_id, audit_result)
        filenames = filenames or self.build_report_filenames(task_id, audit_context)
        archive = io.BytesIO()

        with zipfile.ZipFile(archive, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(filenames["marked"], marked.getvalue())
            zf.writestr(filenames["detailed"], detailed.getvalue())

        archive.seek(0)
        return archive

    def generate_report_bundle(
        self,
        task_id: str,
        audit_result: dict[str, Any],
        audit_context: Any | None = None,
    ) -> dict[str, Any]:
        """返回一组可直接下载或持久化的报告二进制对象。"""

        filenames = self.build_report_filenames(task_id, audit_context)
        return {
            "marked_report": self.generate_marked_report(task_id, audit_result),
            "detailed_report": self.generate_detail_report(task_id, audit_result),
            "report_zip": self.generate_report_zip(task_id, audit_result, audit_context, filenames),
            "filenames": filenames,
        }

    @staticmethod
    def build_report_filenames(task_id: str, audit_context: Any | None = None) -> dict[str, str]:
        """Build user-facing names for all generated report artifacts."""

        identifier = pick_report_identifier(audit_context or {}, task_id)
        return {
            "marked": build_report_filename("标记版", identifier, "xlsx"),
            "detailed": build_report_filename("详情版", identifier, "xlsx"),
            "zip": build_report_filename("报告", identifier, "zip"),
        }

    @staticmethod
    def _source_file_name(issue: dict[str, Any]) -> str:
        locations = issue.get("locations")
        if isinstance(locations, list) and locations:
            first = locations[0]
            if isinstance(first, dict) and first.get("file_name"):
                return str(first["file_name"])
        candidates = issue.get("candidate_locations")
        if isinstance(candidates, list) and candidates:
            first = candidates[0]
            if isinstance(first, dict) and first.get("file_name"):
                return str(first["file_name"])
        return str(issue.get("document_label") or "")

    @staticmethod
    def _location_refs(issue: dict[str, Any]) -> str:
        locations = issue.get("locations")
        if not locations and issue.get("mark_status") == "multiple_candidates":
            locations = issue.get("candidate_locations")
        if not isinstance(locations, list):
            return ""

        refs: list[str] = []
        for location in locations:
            if not isinstance(location, dict):
                continue
            sheet = str(location.get("sheet") or "").strip()
            cell = str(location.get("cell") or "").strip()
            if sheet and cell:
                refs.append(f"{sheet}!{cell}")
        return "; ".join(dict.fromkeys(refs))

    @staticmethod
    def _location_confidence(issue: dict[str, Any]) -> str:
        locations = issue.get("locations")
        if not locations and issue.get("mark_status") == "low_confidence":
            locations = issue.get("candidate_locations")
        if not isinstance(locations, list) or not locations:
            return ""

        values = [
            float(location["confidence"])
            for location in locations
            if isinstance(location, dict) and location.get("confidence") not in (None, "")
        ]
        if not values:
            return ""
        return f"{max(values):.2f}"

    def _new_workbook(self):
        """创建 Workbook 并检查依赖。"""

        if Workbook is None or PatternFill is None or Comment is None or Font is None:
            raise AppError("当前环境缺少 openpyxl，暂时无法生成报告。", status_code=500)
        return Workbook()

    @staticmethod
    def _extract_issues(audit_result: dict[str, Any]) -> list[dict[str, Any]]:
        """从审核结果中提取问题列表。"""

        issues = audit_result.get("issues")
        if isinstance(issues, list):
            return [item for item in issues if isinstance(item, dict)]
        return []

    @staticmethod
    def _style_header_row(sheet, row_index: int) -> None:
        """设置表头样式。"""

        for cell in sheet[row_index]:
            cell.font = Font(bold=True)
            cell.fill = PatternFill(fill_type="solid", fgColor="D9EAF7")

    @staticmethod
    def _mark_issue_row(sheet, row_index: int, level: str, confidence: float) -> None:
        """对问题行做精准标色，并在说明列写入置信度批注。"""

        fill_color = _LEVEL_FILLCOLORS.get(level.upper(), _LEVEL_FILLCOLORS["YELLOW"])
        fill = PatternFill(fill_type="solid", fgColor=fill_color)
        for column in ("B", "C", "D", "E"):
            sheet[f"{column}{row_index}"].fill = fill
        sheet[f"D{row_index}"].comment = Comment(
            f"模型置信度：{max(0.0, min(1.0, confidence)) * 100:.1f}%",
            "system",
        )

    @staticmethod
    def _localize_level(level: str) -> str:
        """将英文级别标签转换为中文显示标签。"""

        mapping = {"RED": "红色·高风险", "YELLOW": "黄色·疑点", "BLUE": "蓝色·提示"}
        return mapping.get(level.upper().strip(), level)

    @staticmethod
    def _set_column_widths(sheet, widths: list[int]) -> None:
        """批量设置列宽。"""

        from openpyxl.utils import get_column_letter

        for index, width in enumerate(widths, start=1):
            sheet.column_dimensions[get_column_letter(index)].width = width

    @staticmethod
    def _apply_wrap_text(sheet, start_row: int) -> None:
        """对指定起始行之后的所有数据行设置自动换行。"""

        from openpyxl.styles import Alignment

        for row in sheet.iter_rows(min_row=start_row, max_row=sheet.max_row):
            for cell in row:
                cell.alignment = Alignment(wrap_text=True, vertical="top")

    @staticmethod
    def _workbook_to_bytes(workbook) -> io.BytesIO:
        """把 Workbook 输出成 BytesIO。"""

        buffer = io.BytesIO()
        workbook.save(buffer)
        buffer.seek(0)
        return buffer
