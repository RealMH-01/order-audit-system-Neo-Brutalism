import { FilePlus2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select } from "@/components/ui/select";
import { getFileMarkBadge, type FileMarkBadgeTone } from "@/lib/file-mark-badge";

import type { AuditBucketFile, AuditDocumentType } from "@/components/audit/types";

const documentTypeOptions: Array<{ label: string; value: AuditDocumentType }> = [
  { label: "商业发票", value: "invoice" },
  { label: "装箱单", value: "packing_list" },
  { label: "托书 / SI", value: "shipping_instruction" },
  { label: "提单", value: "bill_of_lading" },
  { label: "原产地证", value: "certificate_of_origin" },
  { label: "报关单", value: "customs_declaration" },
  { label: "信用证", value: "letter_of_credit" },
  { label: "其他单据", value: "other" }
];

const markBadgeToneClass: Record<FileMarkBadgeTone, string> = {
  green: "bg-[#86efac] text-ink",
  yellow: "bg-secondary text-ink",
  gray: "bg-paper text-ink"
};

const legacyDocPreviewMessage =
  "该文件为 .doc 格式，预览暂不可用。仍可参与审核，建议另存为 .docx / PDF / Excel 以获得更稳定的识别效果。";

type FileBucketProps = {
  title: string;
  description: string;
  badgeLabel: string;
  files: AuditBucketFile[];
  emptyHint: string;
  limitHint?: string;
  multiple?: boolean;
  uploading?: boolean;
  disabled?: boolean;
  disableHint?: string | null;
  busyFileIds?: string[];
  allowDocumentType?: boolean;
  showMarkingHint?: boolean;
  uploadLabel?: string;
  onUpload: (files: FileList) => void;
  onRemove: (fileId: string) => void;
  onDocumentTypeChange?: (fileId: string, documentType: AuditDocumentType) => void;
};

export function FileBucket({
  title,
  description,
  badgeLabel,
  files,
  emptyHint,
  limitHint,
  multiple = false,
  uploading = false,
  disabled = false,
  disableHint = null,
  busyFileIds = [],
  allowDocumentType = false,
  showMarkingHint = false,
  uploadLabel = "上传文件",
  onUpload,
  onRemove,
  onDocumentTypeChange
}: FileBucketProps) {
  const listContent = (
    <div className="space-y-3">
      {files.map((file) => {
        const fileBusy = busyFileIds.includes(file.id);
        const markBadge = getFileMarkBadge(file.filename);
        const isLegacyDocFile = file.filename
          .toLowerCase()
          .trim()
          .endsWith(".doc");

        return (
          <div
            key={file.id}
            className="border-4 border-ink bg-canvas p-4 shadow-neo-sm"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1 space-y-2">
                <p className="max-w-full overflow-hidden break-words text-sm font-black leading-6 [overflow-wrap:anywhere]">
                  {file.filename}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="muted">{file.detected_type}</Badge>
                  <Badge variant="secondary">
                    {(file.size_bytes / 1024).toFixed(1)} KB
                  </Badge>
                  <Badge
                    variant="neutral"
                    className={markBadgeToneClass[markBadge.tone]}
                  >
                    {markBadge.label}
                  </Badge>
                  {allowDocumentType ? (
                    <Badge variant="neutral">
                      当前类型：
                      {documentTypeOptions.find(
                        (option) => option.value === (file.documentType ?? "other")
                      )?.label ?? "其他单据"}
                    </Badge>
                  ) : null}
                </div>
                <p className="line-clamp-3 max-w-full overflow-hidden break-words text-sm font-bold leading-6 [overflow-wrap:anywhere]">
                  {isLegacyDocFile
                    ? legacyDocPreviewMessage
                    : file.preview_text || "当前文件暂时没有可直接展示的文本预览。"}
                </p>
              </div>
              <div className="flex flex-col gap-3 lg:min-w-[15rem]">
                {allowDocumentType && onDocumentTypeChange ? (
                  <Select
                    value={file.documentType ?? "other"}
                    disabled={disabled || fileBusy}
                    onChange={(event) =>
                      onDocumentTypeChange(
                        file.id,
                        event.target.value as AuditDocumentType
                      )
                    }
                  >
                    {documentTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled || fileBusy}
                  onClick={() => onRemove(file.id)}
                >
                  <Trash2 size={18} strokeWidth={3} />
                  {fileBusy ? "处理中..." : "删除"}
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <Card className="bg-paper">
      <CardHeader>
        <Badge variant="accent">{badgeLabel}</Badge>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="border-2 border-black bg-amber-100 px-3 py-2 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
          已上传的文件仅在当前会话中有效，系统维护更新后需重新上传。
        </div>

        {limitHint ? (
          <div className="border-2 border-ink bg-sky px-3 py-2 text-xs font-black leading-5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
            {limitHint}
          </div>
        ) : null}

        {disabled && disableHint ? (
          <div className="issue-yellow p-4">
            <p className="text-sm font-bold leading-6">{disableHint}</p>
          </div>
        ) : null}

        {showMarkingHint ? (
          <div className="border-4 border-ink bg-canvas p-3 text-sm font-black leading-6 shadow-neo-sm">
            <p>推荐上传 Excel（.xlsx）格式。</p>
            <p>
              上传 .xlsx，系统可在原单据上直接用红/黄/蓝标出问题单元格，生成“标记版”报告。
            </p>
            <p>
              .xls / .xlsm 第一版不支持原表标记版，建议另存为 .xlsx 后再上传。
            </p>
            <p>
              PDF / Word / 图片不会生成原文视觉标注版，只在详情版和页面报告里说明问题。
            </p>
            <p>
              完整问题仍以页面报告和详情版 Excel 为准。
            </p>
          </div>
        ) : null}

        <label
          className={[
            "inline-flex items-center gap-3 border-4 border-ink bg-secondary px-4 py-3 font-bold uppercase tracking-[0.14em] shadow-neo-sm transition-all duration-100 ease-linear",
            disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:-translate-y-0.5"
          ].join(" ")}
        >
          <FilePlus2 size={18} strokeWidth={3} />
          {uploading ? "上传中..." : uploadLabel}
          <input
            type="file"
            multiple={multiple}
            disabled={disabled || uploading}
            className="hidden"
            onChange={(event) => {
              if (event.target.files && event.target.files.length > 0) {
                onUpload(event.target.files);
              }
              event.target.value = "";
            }}
          />
        </label>

        {files.length > 0 ? (
          multiple ? (
            <ScrollArea className="max-h-[24rem] p-0">
              {listContent}
            </ScrollArea>
          ) : (
            listContent
          )
        ) : (
          <div className="issue-yellow p-4">
            <p className="text-sm font-bold leading-6">{emptyHint}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
