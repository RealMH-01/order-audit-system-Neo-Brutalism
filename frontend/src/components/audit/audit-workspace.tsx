"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  ExternalLink,
  Loader2,
  Play,
  ScanSearch,
  Settings2,
  Sparkles
} from "lucide-react";

import {
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
  apiUploadFile,
  getStoredAccessToken,
  streamJsonEvents
} from "@/lib/api";
import { FileBucket } from "@/components/audit/file-bucket";
import { ProgressPanel } from "@/components/audit/progress-panel";
import { ResultsPanel } from "@/components/audit/results-panel";
import type {
  AuditBucketFile,
  AuditCancelResponse,
  AuditDeleteResponse,
  AuditDocumentType,
  AuditFileUploadResponse,
  AuditProgressPayload,
  AuditReportResponse,
  AuditResultResponse,
  AuditStartPayload,
  AuditStartResponse
} from "@/components/audit/types";
import { Dialog, DialogSection } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { Tooltip } from "@/components/ui/tooltip";
import type { WizardProfile } from "@/components/wizard/types";

const ACTIVE_TASK_STATUSES = new Set(["queued", "running", "cancelling"]);

type BucketKey = "po" | "target" | "prev" | "template" | "reference";
type ResultFilter = "ALL" | "RED" | "YELLOW" | "BLUE";

function resolveProviderFromModel(model: string) {
  const normalized = model.toLowerCase();
  if (normalized.startsWith("deepseek")) {
    return "deepseek" as const;
  }
  if (normalized.startsWith("glm")) {
    return "zhipuai" as const;
  }
  return "openai" as const;
}

function normalizeError(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "detail" in error) {
    return String(error.detail);
  }
  return fallback;
}

function resolveDefaultDocumentType(detectedType: string): AuditDocumentType {
  if (detectedType === "invoice") {
    return "invoice";
  }
  if (detectedType === "packing_list") {
    return "packing_list";
  }
  if (detectedType === "shipping_instruction") {
    return "shipping_instruction";
  }
  return "other";
}

function toBucketFile(file: AuditFileUploadResponse["file"]): AuditBucketFile {
  return {
    ...file,
    documentType: resolveDefaultDocumentType(file.detected_type),
    label: file.filename
  };
}

function normalizeFilename(filename: string) {
  return filename.trim().toLowerCase();
}

function mergeFilesByFilename(
  existing: AuditBucketFile[],
  uploaded: AuditBucketFile[]
) {
  const nextFiles = [...existing];
  const replacedIds: string[] = [];
  const replacedNames = new Set<string>();

  for (const file of uploaded) {
    const duplicate = nextFiles.find(
      (item) => normalizeFilename(item.filename) === normalizeFilename(file.filename)
    );

    if (duplicate) {
      replacedIds.push(duplicate.id);
      replacedNames.add(duplicate.filename);
      const duplicateIndex = nextFiles.findIndex((item) => item.id === duplicate.id);
      nextFiles.splice(duplicateIndex, 1, file);
      continue;
    }

    nextFiles.push(file);
  }

  return {
    files: nextFiles,
    replacedIds,
    replacedNames: Array.from(replacedNames)
  };
}

function resolveBucketName(key: BucketKey) {
  switch (key) {
    case "po":
      return "PO 基准文件";
    case "target":
      return "待审核文件";
    case "prev":
      return "上一票文件";
    case "template":
      return "模板文件";
    case "reference":
      return "参考文件";
    default:
      return "文件";
  }
}

function resolveReportState(message: string | null) {
  if (!message) {
    return {
      kind: "idle" as const,
      title: "尚未获取报告状态",
      description: "审核完成后，这里会显示报告状态。"
    };
  }

  if (/^https?:\/\//i.test(message) || message.startsWith("/")) {
    return {
      kind: "download" as const,
      title: "报告已可下载",
      description: "当前后端已经返回可用下载地址，你可以直接打开或下载。",
      href: message
    };
  }

  if (message.includes("下载接口将在后续轮次接通")) {
    return {
      kind: "placeholder" as const,
      title: "报告已生成，但下载仍是占位",
      description: message
    };
  }

  if (message.includes("尚未生成")) {
    return {
      kind: "pending" as const,
      title: "报告尚未生成",
      description: message
    };
  }

  return {
    kind: "placeholder" as const,
    title: "报告状态已返回",
    description: message
  };
}

export function AuditWorkspace() {
  const router = useRouter();
  const progressAbortRef = useRef<AbortController | null>(null);

  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<WizardProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [acceptingDisclaimer, setAcceptingDisclaimer] = useState(false);

  const [poFile, setPoFile] = useState<AuditBucketFile | null>(null);
  const [targetFiles, setTargetFiles] = useState<AuditBucketFile[]>([]);
  const [prevTicketFiles, setPrevTicketFiles] = useState<AuditBucketFile[]>([]);
  const [templateFile, setTemplateFile] = useState<AuditBucketFile | null>(null);
  const [referenceFiles, setReferenceFiles] = useState<AuditBucketFile[]>([]);

  const [uploadingKey, setUploadingKey] = useState<BucketKey | null>(null);
  const [removingFileIds, setRemovingFileIds] = useState<string[]>([]);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);

  const [runDeepThink, setRunDeepThink] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState("idle");
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [progressEvents, setProgressEvents] = useState<AuditProgressPayload[]>([]);
  const [startLoading, setStartLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [result, setResult] = useState<AuditResultResponse | null>(null);
  const [resultFilter, setResultFilter] = useState<ResultFilter>("ALL");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportMessage, setReportMessage] = useState<string | null>(null);

  const provider = useMemo(
    () => resolveProviderFromModel(profile?.selected_model ?? "gpt-4o"),
    [profile?.selected_model]
  );

  const auditLocked = ACTIVE_TASK_STATUSES.has(taskStatus);
  const workspaceDisabled = profileLoading || disclaimerOpen || auditLocked;
  const bucketDisableHint = disclaimerOpen
    ? "请先确认免责声明，确认后再开始上传和审核。"
    : auditLocked
      ? "审核进行中时会锁定文件区，避免本轮任务和当前文件状态互相污染。"
      : null;
  const reportState = useMemo(() => resolveReportState(reportMessage), [reportMessage]);

  const clearRunState = useCallback((nextMessage?: string) => {
    progressAbortRef.current?.abort();
    progressAbortRef.current = null;
    setTaskId(null);
    setTaskStatus("idle");
    setProgressPercent(0);
    setProgressMessage("");
    setProgressEvents([]);
    setCancelling(false);
    setResult(null);
    setResultFilter("ALL");
    setReportMessage(null);
    setReportLoading(false);
    if (nextMessage) {
      setWorkspaceMessage(nextMessage);
    }
  }, []);

  const invalidateFinishedRun = useCallback(
    (nextMessage: string) => {
      if (auditLocked) {
        return;
      }

      if (taskId || result || progressEvents.length > 0 || reportMessage) {
        clearRunState(nextMessage);
      }
    },
    [auditLocked, clearRunState, progressEvents.length, reportMessage, result, taskId]
  );

  const fetchProfile = useCallback(async (accessToken: string) => {
    setProfileLoading(true);
    try {
      const { data } = await apiGet<WizardProfile>("/settings/profile", {
        token: accessToken
      });
      const nextProvider = resolveProviderFromModel(data.selected_model);
      setProfile(data);
      setRunDeepThink(
        nextProvider === "zhipuai" ? false : Boolean(data.deep_think_enabled)
      );
      if (data.wizard_completed && !data.disclaimer_accepted) {
        setDisclaimerOpen(true);
      }
    } catch (error) {
      setWorkspaceError(
        normalizeError(error, "读取当前审核配置失败，请稍后重试。")
      );
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    const accessToken = getStoredAccessToken();
    setToken(accessToken);

    if (!accessToken) {
      setProfileLoading(false);
      return;
    }

    void fetchProfile(accessToken);
  }, [fetchProfile]);

  useEffect(() => {
    if (!taskId || !token || !ACTIVE_TASK_STATUSES.has(taskStatus)) {
      return;
    }

    const controller = new AbortController();
    progressAbortRef.current = controller;

    void streamJsonEvents<AuditProgressPayload>(`/audit/progress/${taskId}`, {
      token,
      signal: controller.signal,
      onMessage: (payload) => {
        setTaskStatus(payload.status);
        setProgressPercent(payload.progress_percent);
        setProgressMessage(payload.message);
        setProgressEvents((previous) => [...previous, payload].slice(-24));

        if (
          payload.status === "completed" ||
          payload.status === "failed" ||
          payload.status === "cancelled"
        ) {
          void apiGet<AuditResultResponse>(`/audit/result/${taskId}`, {
            token
          })
            .then(({ data }) => {
              setResult(data);
            })
            .catch((error) => {
              setWorkspaceError(
                normalizeError(error, "读取审核结果失败，请稍后重试。")
              );
            });

          void apiGet<AuditReportResponse>(`/audit/report/${taskId}`, {
            token
          })
            .then(({ data }) => {
              setReportMessage(data.message);
            })
            .catch((error) => {
              setWorkspaceError(
                normalizeError(error, "读取报告状态失败，请稍后重试。")
              );
            });
        }
      }
    }).catch((error) => {
      if (controller.signal.aborted) {
        return;
      }

      setWorkspaceError(
        normalizeError(error, "建立审核进度连接失败，请稍后重试。")
      );
    });

    return () => {
      controller.abort();
    };
  }, [taskId, taskStatus, token]);

  const deleteFilesSilently = useCallback(
    async (fileIds: string[]) => {
      if (!token || fileIds.length === 0) {
        return;
      }

      await Promise.allSettled(
        fileIds.map((fileId) => apiDelete<AuditDeleteResponse>(`/files/${fileId}`, { token }))
      );
    },
    [token]
  );

  const uploadSingleFile = useCallback(
    async (
      file: File,
      currentFile: AuditBucketFile | null,
      key: BucketKey,
      onSuccess: (nextFile: AuditBucketFile) => void
    ) => {
      if (!token) {
        setWorkspaceError("请先登录后再上传文件。");
        return;
      }

      if (workspaceDisabled) {
        setWorkspaceError("当前阶段暂不允许修改文件，请先完成免责声明或等待审核结束。");
        return;
      }

      setUploadingKey(key);
      setWorkspaceError(null);
      setWorkspaceMessage(null);

      try {
        const path = currentFile ? `/files/${currentFile.id}/replace` : "/files/upload";
        const { data } = await apiUploadFile<AuditFileUploadResponse>(path, file, {
          token
        });
        onSuccess(toBucketFile(data.file));
        invalidateFinishedRun(`${resolveBucketName(key)}已更新，请重新启动审核。`);
        setWorkspaceMessage(
          currentFile
            ? `${resolveBucketName(key)}已替换为最新文件。`
            : `${resolveBucketName(key)}上传成功。`
        );
      } catch (error) {
        setWorkspaceError(
          normalizeError(error, `${resolveBucketName(key)}上传失败，请稍后重试。`)
        );
      } finally {
        setUploadingKey(null);
      }
    },
    [invalidateFinishedRun, token, workspaceDisabled]
  );

  const uploadMultipleFiles = useCallback(
    async (
      files: FileList,
      key: BucketKey,
      currentFiles: AuditBucketFile[],
      onSuccess: (nextFiles: AuditBucketFile[]) => void
    ) => {
      if (!token) {
        setWorkspaceError("请先登录后再上传文件。");
        return;
      }

      if (workspaceDisabled) {
        setWorkspaceError("当前阶段暂不允许修改文件，请先完成免责声明或等待审核结束。");
        return;
      }

      setUploadingKey(key);
      setWorkspaceError(null);
      setWorkspaceMessage(null);

      try {
        const uploaded: AuditBucketFile[] = [];
        for (const file of Array.from(files)) {
          const { data } = await apiUploadFile<AuditFileUploadResponse>(
            "/files/upload",
            file,
            { token }
          );
          uploaded.push(toBucketFile(data.file));
        }

        const merged = mergeFilesByFilename(currentFiles, uploaded);
        onSuccess(merged.files);
        await deleteFilesSilently(merged.replacedIds);

        invalidateFinishedRun(`${resolveBucketName(key)}已变更，请重新启动审核。`);
        if (merged.replacedNames.length > 0) {
          setWorkspaceMessage(
            `${resolveBucketName(key)}上传成功，已自动替换同名文件：${merged.replacedNames.join("、")}。`
          );
        } else {
          setWorkspaceMessage(`${resolveBucketName(key)}上传成功。`);
        }
      } catch (error) {
        setWorkspaceError(
          normalizeError(error, `${resolveBucketName(key)}上传失败，请稍后重试。`)
        );
      } finally {
        setUploadingKey(null);
      }
    },
    [deleteFilesSilently, invalidateFinishedRun, token, workspaceDisabled]
  );

  const removeFile = useCallback(
    async (fileId: string, key: BucketKey, onSuccess: () => void) => {
      if (!token) {
        setWorkspaceError("请先登录后再删除文件。");
        return;
      }

      if (workspaceDisabled) {
        setWorkspaceError("审核进行中时不能删除文件，请先等待当前任务结束。");
        return;
      }

      setRemovingFileIds((previous) => [...previous, fileId]);

      try {
        const { data } = await apiDelete<AuditDeleteResponse>(`/files/${fileId}`, {
          token
        });
        onSuccess();
        invalidateFinishedRun(`${resolveBucketName(key)}已调整，请重新启动审核。`);
        setWorkspaceMessage(data.message || `${resolveBucketName(key)}已删除。`);
      } catch (error) {
        setWorkspaceError(
          normalizeError(error, `${resolveBucketName(key)}删除失败，请稍后重试。`)
        );
      } finally {
        setRemovingFileIds((previous) => previous.filter((item) => item !== fileId));
      }
    },
    [invalidateFinishedRun, token, workspaceDisabled]
  );

  const handleDocumentTypeChange = useCallback(
    (
      key: Extract<BucketKey, "target" | "prev">,
      fileId: string,
      documentType: AuditDocumentType
    ) => {
      if (workspaceDisabled) {
        setWorkspaceError("审核进行中时不能修改文档类型，请等待当前任务结束。");
        return;
      }

      const updater = (files: AuditBucketFile[]) =>
        files.map((item) => (item.id === fileId ? { ...item, documentType } : item));

      if (key === "target") {
        setTargetFiles((previous) => updater(previous));
      } else {
        setPrevTicketFiles((previous) => updater(previous));
      }

      invalidateFinishedRun("文档类型已调整，请重新启动审核。");
      setWorkspaceMessage("文档类型已更新。");
    },
    [invalidateFinishedRun, workspaceDisabled]
  );

  const handleStartAudit = useCallback(async () => {
    if (!token) {
      setWorkspaceError("请先登录后再启动审核。");
      return;
    }

    if (disclaimerOpen) {
      setWorkspaceError("请先确认免责声明，再进入审核工作台。");
      return;
    }

    if (auditLocked) {
      setWorkspaceError("当前已有审核任务正在进行，请等待完成或先取消。");
      return;
    }

    if (!poFile) {
      setWorkspaceError("请先上传 PO 基准文件。");
      return;
    }

    if (targetFiles.length === 0) {
      setWorkspaceError("请至少上传 1 个待审核文件。");
      return;
    }

    progressAbortRef.current?.abort();
    clearRunState();

    setStartLoading(true);
    setWorkspaceError(null);
    setWorkspaceMessage(null);

    const payload: AuditStartPayload = {
      po_file_id: poFile.id,
      target_files: targetFiles.map((file) => ({
        file_id: file.id,
        document_type: file.documentType ?? "other",
        label: file.label ?? file.filename
      })),
      prev_ticket_files: prevTicketFiles.map((file) => ({
        file_id: file.id,
        document_type: file.documentType ?? "other",
        label: file.label ?? file.filename
      })),
      template_file_id: templateFile?.id ?? null,
      reference_file_ids: referenceFiles.map((file) => file.id),
      deep_think: provider === "zhipuai" ? false : runDeepThink
    };

    try {
      const { data } = await apiPost<AuditStartResponse>("/audit/start", payload, {
        token
      });
      setTaskId(data.task_id);
      setTaskStatus(data.status);
      setProgressPercent(0);
      setProgressMessage(data.message);
      setWorkspaceMessage(data.message);
    } catch (error) {
      setWorkspaceError(normalizeError(error, "启动审核失败，请稍后重试。"));
    } finally {
      setStartLoading(false);
    }
  }, [
    auditLocked,
    clearRunState,
    disclaimerOpen,
    poFile,
    prevTicketFiles,
    provider,
    referenceFiles,
    runDeepThink,
    targetFiles,
    templateFile,
    token
  ]);

  const handleCancelAudit = useCallback(async () => {
    if (!token || !taskId) {
      return;
    }

    setCancelling(true);
    setWorkspaceError(null);

    try {
      const { data } = await apiPost<AuditCancelResponse>(
        `/audit/cancel/${taskId}`,
        undefined,
        { token }
      );
      setTaskStatus(data.status);
      setProgressMessage(data.message);
      setWorkspaceMessage(data.message);
    } catch (error) {
      setWorkspaceError(normalizeError(error, "取消审核失败，请稍后重试。"));
    } finally {
      setCancelling(false);
    }
  }, [taskId, token]);

  const handleRefreshReport = useCallback(async () => {
    if (!token || !taskId) {
      return;
    }

    setReportLoading(true);
    setWorkspaceError(null);

    try {
      const { data } = await apiGet<AuditReportResponse>(`/audit/report/${taskId}`, {
        token
      });
      setReportMessage(data.message);
    } catch (error) {
      setWorkspaceError(normalizeError(error, "读取报告状态失败，请稍后重试。"));
    } finally {
      setReportLoading(false);
    }
  }, [taskId, token]);

  const handleAcceptDisclaimer = useCallback(async () => {
    if (!token) {
      setDisclaimerOpen(false);
      return;
    }

    setAcceptingDisclaimer(true);
    try {
      await apiPut("/settings/disclaimer", { disclaimer_accepted: true }, { token });
      setProfile((previous) =>
        previous ? { ...previous, disclaimer_accepted: true } : previous
      );
      setDisclaimerOpen(false);
      setWorkspaceMessage("免责声明已确认，现在可以开始上传和审核。");
    } catch (error) {
      setWorkspaceError(
        normalizeError(error, "确认免责声明失败，请稍后重试。")
      );
    } finally {
      setAcceptingDisclaimer(false);
    }
  }, [token]);

  if (!token) {
    return (
      <section className="space-y-6">
        <SectionHeading
          title="审核工作台"
          description="当前审核工作台需要已保存登录态。请先完成向导或回到设置页建立当前用户会话。"
          icon={ScanSearch}
        />
        <Card className="bg-paper">
          <CardHeader>
            <Badge variant="accent">未登录</Badge>
            <CardTitle>请先完成引导或登录</CardTitle>
            <CardDescription>
              `/audit` 页面会直接复用当前登录态、模型配置和已保存 profile。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button onClick={() => router.push("/wizard")}>前往引导向导</Button>
            <Button variant="outline" onClick={() => router.push("/settings")}>
              前往设置页
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <>
      <section className="space-y-6">
        <SectionHeading
          title="审核工作台"
          description="在这里完成文件上传、审核启动、进度追踪、结果阅读和报告状态查看。当前页面会继续复用 wizard 与 settings 已经统一好的配置。"
          icon={ScanSearch}
        />

        {profileLoading ? (
          <Card className="bg-paper">
            <CardContent className="flex items-center gap-3 py-10">
              <Loader2 className="animate-spin" size={20} strokeWidth={3} />
              <p className="text-sm font-bold uppercase tracking-[0.14em]">
                正在加载当前审核配置
              </p>
            </CardContent>
          </Card>
        ) : null}

        {profile && !profile.wizard_completed ? (
          <div className="issue-yellow p-4">
            <p className="text-sm font-bold leading-6">
              当前账号还没有完成向导配置。你仍然可以先搭建审核任务，但更建议先去
              `/wizard` 或 `/settings` 完成模型、规则和公司架构设置。
            </p>
          </div>
        ) : null}

        {workspaceError ? (
          <div className="issue-red p-4">
            <p className="text-sm font-bold leading-6">{workspaceError}</p>
          </div>
        ) : null}

        {workspaceMessage ? (
          <div className="issue-blue p-4">
            <p className="text-sm font-bold leading-6">{workspaceMessage}</p>
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
          <div className="space-y-6">
            <FileBucket
              title="PO 基准区"
              description="这里只放 1 个基准 PO，后续所有审核都以它为准。替换 PO 会自动使上一轮审核结果失效。"
              badgeLabel="1. PO 基准区"
              files={poFile ? [poFile] : []}
              emptyHint="请先上传 1 个 PO 基准文件。"
              uploading={uploadingKey === "po"}
              disabled={workspaceDisabled}
              disableHint={bucketDisableHint}
              busyFileIds={removingFileIds}
              uploadLabel={poFile ? "替换 PO 基准文件" : "上传 PO 基准文件"}
              onUpload={(files) => void uploadSingleFile(files[0], poFile, "po", setPoFile)}
              onRemove={(fileId) => void removeFile(fileId, "po", () => setPoFile(null))}
            />

            <FileBucket
              title="辅助资料区 · 模板文件"
              description="可选上传 1 个模板文件，作为本轮审核的额外参考。"
              badgeLabel="3A. 模板文件"
              files={templateFile ? [templateFile] : []}
              emptyHint="模板文件是可选项，不上传也可以启动审核。"
              uploading={uploadingKey === "template"}
              disabled={workspaceDisabled}
              disableHint={bucketDisableHint}
              busyFileIds={removingFileIds}
              uploadLabel={templateFile ? "替换模板文件" : "上传模板文件"}
              onUpload={(files) =>
                void uploadSingleFile(files[0], templateFile, "template", setTemplateFile)
              }
              onRemove={(fileId) =>
                void removeFile(fileId, "template", () => setTemplateFile(null))
              }
            />

            <FileBucket
              title="辅助资料区 · 参考文件"
              description="可选上传多个参考文件，为审核引擎补充上下文。重复上传同名文件时会自动替换为最新版本。"
              badgeLabel="3B. 参考文件"
              files={referenceFiles}
              emptyHint="参考文件是可选项，你可以稍后再补。"
              multiple
              uploading={uploadingKey === "reference"}
              disabled={workspaceDisabled}
              disableHint={bucketDisableHint}
              busyFileIds={removingFileIds}
              uploadLabel="上传参考文件"
              onUpload={(files) =>
                void uploadMultipleFiles(files, "reference", referenceFiles, setReferenceFiles)
              }
              onRemove={(fileId) =>
                void removeFile(fileId, "reference", () =>
                  setReferenceFiles((previous) =>
                    previous.filter((item) => item.id !== fileId)
                  )
                )
              }
            />
          </div>

          <div className="space-y-6">
            <FileBucket
              title="待审核文件区"
              description="上传多个待审核文件，并为每个文件明确指定文档类型。文档类型改变后，上一轮审核结果会自动清空，避免误读。"
              badgeLabel="2. 待审核文件"
              files={targetFiles}
              emptyHint="请至少上传 1 个待审核文件，才能启动审核。"
              multiple
              allowDocumentType
              uploading={uploadingKey === "target"}
              disabled={workspaceDisabled}
              disableHint={bucketDisableHint}
              busyFileIds={removingFileIds}
              uploadLabel="上传待审核文件"
              onUpload={(files) =>
                void uploadMultipleFiles(files, "target", targetFiles, setTargetFiles)
              }
              onRemove={(fileId) =>
                void removeFile(fileId, "target", () =>
                  setTargetFiles((previous) =>
                    previous.filter((item) => item.id !== fileId)
                  )
                )
              }
              onDocumentTypeChange={(fileId, documentType) =>
                handleDocumentTypeChange("target", fileId, documentType)
              }
            />

            <FileBucket
              title="辅助资料区 · 上一票文件"
              description="可选上传上一票文件，并指定每个文件的文档类型，用于交叉比对。重复上传同名文件时会自动替换。"
              badgeLabel="3C. 上一票文件"
              files={prevTicketFiles}
              emptyHint="上一票文件是可选项，用于补充交叉比对上下文。"
              multiple
              allowDocumentType
              uploading={uploadingKey === "prev"}
              disabled={workspaceDisabled}
              disableHint={bucketDisableHint}
              busyFileIds={removingFileIds}
              uploadLabel="上传上一票文件"
              onUpload={(files) =>
                void uploadMultipleFiles(files, "prev", prevTicketFiles, setPrevTicketFiles)
              }
              onRemove={(fileId) =>
                void removeFile(fileId, "prev", () =>
                  setPrevTicketFiles((previous) =>
                    previous.filter((item) => item.id !== fileId)
                  )
                )
              }
              onDocumentTypeChange={(fileId, documentType) =>
                handleDocumentTypeChange("prev", fileId, documentType)
              }
            />
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
          <Card className="bg-secondary">
            <CardHeader>
              <Badge variant="inverse">4. 审核控制区</Badge>
              <CardTitle>启动或重跑审核</CardTitle>
              <CardDescription>
                当前会严格按照稳定的 `/api/audit/start` 协议构造请求，并复用 settings /
                wizard 已保存的模型配置。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                  <p className="text-xs font-black uppercase tracking-[0.14em]">
                    当前模型
                  </p>
                  <p className="mt-2 text-sm font-bold leading-6">
                    {profile?.selected_model ?? "未配置"}
                  </p>
                </div>
                <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                  <p className="text-xs font-black uppercase tracking-[0.14em]">
                    当前规则数
                  </p>
                  <p className="mt-2 text-sm font-bold leading-6">
                    {profile?.active_custom_rules.length ?? 0} 条
                  </p>
                </div>
              </div>

              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-xs font-black uppercase tracking-[0.14em]">
                      本轮是否开启深度思考
                    </p>
                    <p className="text-sm font-bold leading-6">
                      {provider === "zhipuai"
                        ? "智谱当前不支持深度思考，本轮会自动关闭。"
                        : "这里默认继承 settings 中的状态，但只影响本轮审核请求。"}
                    </p>
                  </div>
                  <Tooltip
                    content={
                      provider === "zhipuai"
                        ? "智谱当前不支持深度思考"
                        : "切换本轮审核的深度思考开关"
                    }
                  >
                    <Button
                      variant={runDeepThink ? "primary" : "outline"}
                      disabled={provider === "zhipuai" || workspaceDisabled}
                      onClick={() => {
                        setRunDeepThink((previous) => !previous);
                        invalidateFinishedRun("本轮 deep think 配置已变更，请重新启动审核。");
                      }}
                    >
                      <Sparkles size={18} strokeWidth={3} />
                      {provider === "zhipuai"
                        ? "已禁用"
                        : runDeepThink
                          ? "已开启"
                          : "已关闭"}
                    </Button>
                  </Tooltip>
                </div>
              </div>

              <div className="issue-blue p-4">
                <p className="text-sm font-bold leading-6">
                  当前请求体会严格使用：
                  <code className="mx-1 rounded-none border-2 border-ink bg-paper px-2 py-1">
                    po_file_id / target_files / prev_ticket_files / template_file_id /
                    reference_file_ids / deep_think
                  </code>
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => void handleStartAudit()}
                  disabled={startLoading || auditLocked || disclaimerOpen}
                >
                  {startLoading ? (
                    <Loader2 size={18} strokeWidth={3} className="animate-spin" />
                  ) : (
                    <Play size={18} strokeWidth={3} />
                  )}
                  {startLoading
                    ? "启动中..."
                    : taskStatus === "completed" ||
                        taskStatus === "failed" ||
                        taskStatus === "cancelled" ||
                        result
                      ? "重新发起审核"
                      : "启动审核"}
                </Button>
                <Button variant="outline" onClick={() => router.push("/settings")}>
                  <Settings2 size={18} strokeWidth={3} />
                  前往设置页
                </Button>
              </div>
            </CardContent>
          </Card>

          <ProgressPanel
            taskId={taskId}
            status={taskStatus}
            progressPercent={progressPercent}
            message={progressMessage}
            events={progressEvents}
            cancelling={cancelling}
            onCancel={() => void handleCancelAudit()}
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
          <ResultsPanel
            result={result}
            filter={resultFilter}
            onFilterChange={setResultFilter}
          />

          <Card className="bg-muted">
            <CardHeader>
              <Badge variant="inverse">7. 报告区</Badge>
              <CardTitle>报告下载入口</CardTitle>
              <CardDescription>
                这一轮把报告区从纯占位收口为“可判断状态的入口”。如果后端仍是占位返回，页面会明确告诉用户当前进展。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="text-xs font-black uppercase tracking-[0.14em]">
                  {reportState.title}
                </p>
                <p className="mt-2 text-sm font-bold leading-6">
                  {reportState.description}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  onClick={() => void handleRefreshReport()}
                  disabled={!taskId || reportLoading}
                >
                  {reportLoading ? (
                    <Loader2 size={18} strokeWidth={3} className="animate-spin" />
                  ) : (
                    <Download size={18} strokeWidth={3} />
                  )}
                  {reportLoading ? "读取中..." : "刷新报告状态"}
                </Button>

                {reportState.kind === "download" && reportState.href ? (
                  <a
                    href={reportState.href}
                    target="_blank"
                    rel="noreferrer"
                    className="neo-button-base h-12 w-auto border-4 border-ink bg-acid px-5 text-sm text-ink shadow-neo-md"
                  >
                    <ExternalLink size={18} strokeWidth={3} />
                    打开下载入口
                  </a>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <Dialog
        open={disclaimerOpen}
        title="开始审核前请先确认"
        description="你已经完成了引导向导。免责声明会在进入审核页之后再弹出，而不是在 wizard 之前打断流程。"
        footer={
          <Button
            onClick={() => void handleAcceptDisclaimer()}
            disabled={acceptingDisclaimer}
          >
            {acceptingDisclaimer ? "确认中..." : "我已阅读并接受"}
          </Button>
        }
      >
        <DialogSection>
          <p className="text-sm font-bold leading-6">
            当前系统提供的是 AI 辅助审核建议，请在正式对外发送单据前进行人工复核。
          </p>
          <p className="text-sm font-bold leading-6">
            这次确认会写入
            <code className="mx-1 rounded-none border-2 border-ink bg-secondary px-2 py-1">
              disclaimer_accepted
            </code>
            ，后续同一账号默认不再重复打断。
          </p>
        </DialogSection>
      </Dialog>
    </>
  );
}
