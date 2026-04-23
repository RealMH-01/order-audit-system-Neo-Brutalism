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

type FileBucketProps = {
  title: string;
  description: string;
  badgeLabel: string;
  files: AuditBucketFile[];
  emptyHint: string;
  multiple?: boolean;
  uploading?: boolean;
  disabled?: boolean;
  disableHint?: string | null;
  busyFileIds?: string[];
  allowDocumentType?: boolean;
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
  multiple = false,
  uploading = false,
  disabled = false,
  disableHint = null,
  busyFileIds = [],
  allowDocumentType = false,
  uploadLabel = "上传文件",
  onUpload,
  onRemove,
  onDocumentTypeChange
}: FileBucketProps) {
  const listContent = (
    <div className="space-y-3">
      {files.map((file) => {
        const fileBusy = busyFileIds.includes(file.id);

        return (
          <div
            key={file.id}
            className="border-4 border-ink bg-canvas p-4 shadow-neo-sm"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <p className="text-sm font-black leading-6">{file.filename}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="muted">{file.detected_type}</Badge>
                  <Badge variant="secondary">
                    {(file.size_bytes / 1024).toFixed(1)} KB
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
                <p className="line-clamp-3 text-sm font-bold leading-6">
                  {file.preview_text || "当前文件暂时没有可直接展示的文本预览。"}
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
        {disabled && disableHint ? (
          <div className="issue-yellow p-4">
            <p className="text-sm font-bold leading-6">{disableHint}</p>
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
