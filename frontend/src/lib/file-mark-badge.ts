export type FileMarkBadgeTone = "green" | "yellow" | "gray";

export type FileMarkBadge = {
  label: string;
  tone: FileMarkBadgeTone;
};

export function getFileMarkBadge(filename: string): FileMarkBadge {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";

  if (extension === "xlsx") {
    return { label: "✓ 可生成标记版", tone: "green" };
  }

  if (extension === "xls") {
    return { label: "⚠ 建议另存为 .xlsx", tone: "yellow" };
  }

  if (
    [
      "xlsm",
      "pdf",
      "docx",
      "doc",
      "png",
      "jpg",
      "jpeg"
    ].includes(extension)
  ) {
    return { label: "仅文字详情", tone: "gray" };
  }

  return { label: "仅文字详情", tone: "gray" };
}
