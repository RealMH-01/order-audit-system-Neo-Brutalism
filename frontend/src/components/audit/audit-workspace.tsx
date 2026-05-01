"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  History,
  BookOpenCheck,
  Loader2,
  Play,
  ScanSearch,
  Settings2,
  Sparkles,
  Trash2
} from "lucide-react";

import {
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
  apiUploadFile,
  downloadAuditReport,
  getStoredAccessToken
} from "@/lib/api";
import { normalizeApiErrorDetail } from "@/lib/api-error";
import { useAuth } from "@/lib/auth-context";
import { FileBucket } from "@/components/audit/file-bucket";
import { ProgressPanel } from "@/components/audit/progress-panel";
import { ResultsPanel } from "@/components/audit/results-panel";
import type {
  AuditBucketFile,
  AuditBulkDeleteResponse,
  AuditCancelResponse,
  AuditDeleteResponse,
  AuditDocumentType,
  AuditFileListResponse,
  AuditFileUploadResponse,
  AuditProgressPayload,
  AuditReportResponse,
  AuditReportType,
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
import { Select } from "@/components/ui/select";
import { SectionHeading } from "@/components/ui/section-heading";
import { Tooltip } from "@/components/ui/tooltip";
import type {
  AuditTemplate,
  AuditTemplateListResponse
} from "@/components/templates/types";
import type { WizardProfile } from "@/components/wizard/types";

const ACTIVE_TASK_STATUSES = new Set(["queued", "running", "cancelling"]);
const TERMINAL_TASK_STATUSES = new Set(["completed", "failed", "cancelled"]);
const MAX_PROGRESS_EVENTS = 24;
const PROGRESS_CONNECTION_INTERRUPTED_MESSAGE =
  "审核进度连接中断，请刷新页面查看结果或重新发起审核。";
const AUDIT_UPLOAD_FORMAT_HINT =
  "支持格式：PDF、DOCX、XLSX、PNG、JPG/JPEG、TXT；单文件 20MB 以内。";
const AUDIT_SINGLE_UPLOAD_LIMIT_HINT = `${AUDIT_UPLOAD_FORMAT_HINT} 当前入口保留 1 个文件，可重新上传替换；所有上传区合计最多暂存 10 个文件。`;
const AUDIT_MULTI_UPLOAD_LIMIT_HINT = `${AUDIT_UPLOAD_FORMAT_HINT} 可一次选择多个文件，重复文件名会自动替换；所有上传区合计最多暂存 10 个文件。`;
const AUDIT_UPLOAD_HINT_LIST = [
  "推荐上传 Excel（.xlsx）格式。",
  ".xlsx 支持生成原表标记版。",
  ".xls / .xlsm 第一版暂不支持原表标记版，建议另存为 .xlsx 后再上传。",
  "PDF / Word / 图片仅生成文字审核结果，不生成原文视觉标注版。"
];
const MARKED_REPORT_UNAVAILABLE_HINT =
  "本次没有可生成的原表标记版。可下载详情版 Excel 或完整报告包查看问题。";

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

function resolveEffectiveModelLabel(
  provider: "openai" | "deepseek" | "zhipuai",
  selectedModel: string | undefined,
  runDeepThink: boolean
) {
  if (!selectedModel) {
    return "未配置";
  }

  const normalized = selectedModel.toLowerCase();
  if (provider === "deepseek") {
    if (runDeepThink) {
      return "DeepSeek V4 Pro（深度思考）";
    }
    if (normalized === "deepseek-v4-flash" || normalized === "deepseek-chat") {
      return "DeepSeek V4 Flash";
    }
    if (normalized === "deepseek-v4-pro" || normalized === "deepseek-reasoner") {
      return "DeepSeek V4 Pro";
    }
  }
  if (provider === "zhipuai") {
    let label = selectedModel;
    if (normalized === "glm-4.6v" || normalized === "glm-4v") {
      label = "智谱 GLM-4.6V";
    } else if (normalized === "glm-4.6v-flash" || normalized === "glm-4-flash") {
      label = "智谱 GLM-4.6V-Flash";
    }
    return runDeepThink ? `${label}（深度思考）` : label;
  }

  if (normalized === "gpt-4o") {
    return "GPT-4o";
  }
  return selectedModel;
}

function normalizeError(error: unknown, fallback: string) {
  return normalizeApiErrorDetail(error, fallback);
}

function getErrorStatus(error: unknown) {
  if (typeof error === "object" && error && "status" in error) {
    const status = Number(error.status);
    return Number.isFinite(status) ? status : null;
  }
  return null;
}

function getErrorReasonCode(error: unknown) {
  if (typeof error !== "object" || !error || !("reason_code" in error)) {
    return null;
  }

  const reasonCode = error.reason_code;
  return typeof reasonCode === "string" && reasonCode.trim() ? reasonCode : null;
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
  if (detectedType === "bill_of_lading") {
    return "bill_of_lading";
  }
  if (detectedType === "certificate_of_origin") {
    return "certificate_of_origin";
  }
  if (detectedType === "customs_declaration") {
    return "customs_declaration";
  }
  if (detectedType === "letter_of_credit") {
    return "letter_of_credit";
  }
  return "other";
}

function resolveBusinessTypeLabel(type: AuditTemplate["business_type"]) {
  return type === "foreign" ? "外贸" : "内贸";
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

function countNonEmptyLines(value?: string | null) {
  return value?.split(/\r?\n/).filter((line) => line.trim().length > 0).length ?? 0;
}

function formatCompanyAffiliates(profile: WizardProfile | null) {
  const affiliates =
    profile?.company_affiliates.map((company) => company.trim()).filter(Boolean) ?? [];
  return affiliates.length > 0 ? affiliates.join("、") : "未配置";
}

function formatCompanyAffiliateRoles(profile: WizardProfile | null) {
  const roles =
    profile?.company_affiliates_roles
      .map((item) => {
        const company = item.company.trim();
        const role = item.role.trim();
        if (company && role) {
          return `${company}：${role}`;
        }
        return company || role;
      })
      .filter(Boolean) ?? [];

  return roles.length > 0 ? roles.join("；") : "未配置";
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

function getProgressEventKey(event: AuditProgressPayload) {
  const eventId = event.event_id ?? event.id;
  if (eventId) {
    return `id:${eventId}`;
  }

  return [
    event.task_id,
    event.status,
    event.progress_percent,
    event.message,
    event.created_at
  ].join("|");
}

function getProgressEventTime(event: AuditProgressPayload) {
  const timestamp = new Date(event.updated_at || event.created_at).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function mergeProgressEvents(
  previous: AuditProgressPayload[],
  incoming: AuditProgressPayload
) {
  const eventsByKey = new Map<string, AuditProgressPayload>();

  for (const event of [...previous, incoming]) {
    const key = getProgressEventKey(event);
    if (!eventsByKey.has(key)) {
      eventsByKey.set(key, event);
    }
  }

  return Array.from(eventsByKey.values())
    .sort((first, second) => getProgressEventTime(first) - getProgressEventTime(second))
    .slice(-MAX_PROGRESS_EVENTS);
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

const REPORT_DOWNLOAD_BUTTONS: Array<{
  type: AuditReportType;
  label: string;
  variant: "primary" | "outline";
  tooltip: string;
}> = [
  {
    type: "zip",
    label: "完整报告包",
    variant: "primary",
    tooltip: "ZIP，含详情版、标记版、任务信息、系统清单"
  },
  {
    type: "marked",
    label: "标记版",
    variant: "outline",
    tooltip: "ZIP，仅含原表填色批注的 Excel 副本"
  },
  {
    type: "detailed",
    label: "详情版",
    variant: "outline",
    tooltip: "Excel，问题明细 + 审核摘要"
  }
];

function resolveMarkedIssueSummary(result: AuditResultResponse | null) {
  if (!result || result.issues.length === 0) {
    return null;
  }

  const hasMarkStatus = result.issues.some(
    (issue) => typeof issue.mark_status === "string" && issue.mark_status.trim().length > 0
  );

  if (!hasMarkStatus) {
    return null;
  }

  const markedCount = result.issues.filter((issue) => issue.mark_status === "marked").length;
  const textOnlyCount = result.issues.filter(
    (issue) =>
      issue.mark_status === "not_applicable" ||
      issue.mark_status === "unsupported_file_type" ||
      issue.mark_status === "unlocated"
  ).length;
  const otherCount = Math.max(0, result.issues.length - markedCount - textOnlyCount);

  return {
    total: result.issues.length,
    markedCount,
    textOnlyCount,
    otherCount
  };
}

function resolveReportState(
  report: AuditReportResponse | null,
  taskId: string | null,
  taskStatus: string
) {
  const message = report?.message ?? null;
  if (!taskId) {
    return {
      kind: "unavailable" as const,
      title: "报告暂不可下载",
      description: "当前还没有可用任务，请先运行一次审核。"
    };
  }

  if (report?.available || report?.status === "ready") {
    return {
      kind: "download" as const,
      title: "报告已可下载",
      description:
        message ?? "报告已生成，可直接下载标记版 Excel、详情版 Excel 和 ZIP。"
    };
  }

  if (report?.status === "failed") {
    return {
      kind: "failed" as const,
      title: "报告未生成",
      description: message ?? "报告生成失败，请重新运行审核。"
    };
  }

  if (message?.includes("已失效")) {
    return {
      kind: "expired" as const,
      title: "报告已失效",
      description: message
    };
  }

  if (message?.includes("尚未生成")) {
    return {
      kind: "pending" as const,
      title: "报告尚未生成",
      description: message
    };
  }

  if (taskStatus === "completed") {
    return {
      kind: "download" as const,
      title: "报告已可下载",
      description:
        "当前进程中的报告 bundle 已就绪，可直接下载标记版 Excel、详情版 Excel 和 ZIP。"
    };
  }

  if (!message) {
    return {
      kind: "idle" as const,
      title: "尚未获取报告状态",
      description: "审核完成后，这里会显示报告状态。"
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
  const { state: authState } = useAuth();
  const progressAbortRef = useRef<AbortController | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestTaskIdRef = useRef<string | null>(null);
  const latestTaskStatusRef = useRef("idle");

  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<WizardProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [auditTemplates, setAuditTemplates] = useState<AuditTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [acceptingDisclaimer, setAcceptingDisclaimer] = useState(false);

  const [poFile, setPoFile] = useState<AuditBucketFile | null>(null);
  const [targetFiles, setTargetFiles] = useState<AuditBucketFile[]>([]);
  const [prevTicketFiles, setPrevTicketFiles] = useState<AuditBucketFile[]>([]);
  const [templateFile, setTemplateFile] = useState<AuditBucketFile | null>(null);
  const [referenceFiles, setReferenceFiles] = useState<AuditBucketFile[]>([]);

  const [uploadingKey, setUploadingKey] = useState<BucketKey | null>(null);
  const [removingFileIds, setRemovingFileIds] = useState<string[]>([]);
  const [residualFiles, setResidualFiles] = useState<AuditBucketFile[]>([]);
  const [residualLoading, setResidualLoading] = useState(false);
  const [residualCleanupLoading, setResidualCleanupLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);

  const [runDeepThink, setRunDeepThink] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState("idle");
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [progressEvents, setProgressEvents] = useState<AuditProgressPayload[]>([]);
  const [startLoading, setStartLoading] = useState(false);
  const [ruleConfirmOpen, setRuleConfirmOpen] = useState(false);
  const [pendingStartPayload, setPendingStartPayload] = useState<AuditStartPayload | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [result, setResult] = useState<AuditResultResponse | null>(null);
  const [resultFilter, setResultFilter] = useState<ResultFilter>("ALL");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [reportInfo, setReportInfo] = useState<AuditReportResponse | null>(null);
  const [reportDownloadError, setReportDownloadError] = useState<string | null>(null);
  const [markedUnavailableHint, setMarkedUnavailableHint] = useState<string | null>(null);
  const [downloadingReports, setDownloadingReports] = useState<Record<AuditReportType, boolean>>({
    marked: false,
    detailed: false,
    zip: false
  });

  const provider = useMemo(
    () => resolveProviderFromModel(profile?.selected_model ?? "gpt-4o"),
    [profile?.selected_model]
  );
  const accountDisplayName =
    authState.user?.display_name?.trim() ||
    authState.user?.email?.split("@")[0]?.trim() ||
    "当前账号";

  const auditLocked = ACTIVE_TASK_STATUSES.has(taskStatus);
  const workspaceDisabled = profileLoading || disclaimerOpen || auditLocked;
  const bucketDisableHint = disclaimerOpen
    ? "请先确认免责声明，确认后再开始上传和审核。"
    : auditLocked
      ? "审核进行中时会锁定文件区，避免本轮任务和当前文件状态互相污染。"
      : null;
  const reportState = useMemo(
    () => resolveReportState(reportInfo, taskId, taskStatus),
    [reportInfo, taskId, taskStatus]
  );
  const markedIssueSummary = useMemo(() => resolveMarkedIssueSummary(result), [result]);
  const hasAnyKey =
    profile?.has_deepseek_key || profile?.has_openai_key || profile?.has_zhipu_key || false;
  const activeFileIds = useMemo(
    () =>
      new Set(
        [
          poFile?.id,
          ...targetFiles.map((file) => file.id),
          ...prevTicketFiles.map((file) => file.id),
          templateFile?.id,
          ...referenceFiles.map((file) => file.id)
        ].filter((fileId): fileId is string => Boolean(fileId))
      ),
    [poFile?.id, prevTicketFiles, referenceFiles, targetFiles, templateFile?.id]
  );
  const residualVisibleFiles = useMemo(
    () => residualFiles.filter((file) => !activeFileIds.has(file.id)),
    [activeFileIds, residualFiles]
  );
  const selectedTemplate = useMemo(
    () => auditTemplates.find((template) => template.id === selectedTemplateId) ?? null,
    [auditTemplates, selectedTemplateId]
  );
  const selectedTemplateRuleCount = useMemo(
    () => countNonEmptyLines(selectedTemplate?.supplemental_rules),
    [selectedTemplate?.supplemental_rules]
  );
  const companyAffiliatesDisplay = useMemo(() => formatCompanyAffiliates(profile), [profile]);
  const companyAffiliateRolesDisplay = useMemo(
    () => formatCompanyAffiliateRoles(profile),
    [profile]
  );

  useEffect(() => {
    latestTaskIdRef.current = taskId;
  }, [taskId]);

  useEffect(() => {
    latestTaskStatusRef.current = taskStatus;
  }, [taskStatus]);

  useEffect(() => {
    setMarkedUnavailableHint(null);
  }, [taskId]);

  const stopProgressPolling = useCallback(() => {
    progressAbortRef.current?.abort();
    progressAbortRef.current = null;
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  const clearRunState = useCallback((nextMessage?: string) => {
    stopProgressPolling();
    setTaskId(null);
    setTaskStatus("idle");
    setProgressPercent(0);
    setProgressMessage("");
    setProgressEvents([]);
    setCancelling(false);
    setResult(null);
    setResultFilter("ALL");
    setReportMessage(null);
    setReportInfo(null);
    setReportLoading(false);
    setReportDownloadError(null);
    setMarkedUnavailableHint(null);
    setDownloadingReports({
      marked: false,
      detailed: false,
      zip: false
    });
    if (nextMessage) {
      setWorkspaceMessage(nextMessage);
    }
  }, [stopProgressPolling]);

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
      setRunDeepThink(Boolean(data.deep_think_enabled));
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

  const fetchResidualFiles = useCallback(async (accessToken: string) => {
    setResidualLoading(true);
    try {
      const { data } = await apiGet<AuditFileListResponse>("/files/mine", {
        token: accessToken
      });
      setResidualFiles(data.files.map(toBucketFile));
    } catch (error) {
      setWorkspaceError(
        normalizeError(error, "读取残留文件列表失败，请稍后重试。")
      );
    } finally {
      setResidualLoading(false);
    }
  }, []);

  const fetchAuditTemplates = useCallback(async (accessToken: string) => {
    setTemplatesLoading(true);
    setTemplatesError(null);

    try {
      const { data } = await apiGet<AuditTemplateListResponse>("/templates", {
        token: accessToken
      });
      const templates = data.templates;
      setAuditTemplates(templates);
      setSelectedTemplateId((current) => {
        if (current && templates.some((template) => template.id === current)) {
          return current;
        }

        const defaultTemplate = templates.find((template) => template.is_default);
        return defaultTemplate?.id ?? templates[0]?.id ?? "";
      });
    } catch (error) {
      setTemplatesError(normalizeError(error, "读取自定义规则集失败，请稍后重试。"));
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    const accessToken = getStoredAccessToken();
    setToken(accessToken);

    if (!accessToken) {
      setProfileLoading(false);
      setTemplatesLoading(false);
      return;
    }

    void fetchProfile(accessToken);
    void fetchResidualFiles(accessToken);
    void fetchAuditTemplates(accessToken);
  }, [fetchAuditTemplates, fetchProfile, fetchResidualFiles]);

  const fetchFinishedTaskArtifacts = useCallback(
    async (finishedTaskId: string, accessToken: string) => {
      const [resultOutcome, reportOutcome] = await Promise.allSettled([
        apiGet<AuditResultResponse>(`/audit/result/${finishedTaskId}`, {
          token: accessToken
        }),
        apiGet<AuditReportResponse>(`/audit/report/${finishedTaskId}`, {
          token: accessToken
        })
      ] as const);

      if (latestTaskIdRef.current !== finishedTaskId) {
        return;
      }

      if (resultOutcome.status === "fulfilled") {
        setResult(resultOutcome.value.data);
      } else if (
        getErrorStatus(resultOutcome.reason) === 401 ||
        getErrorStatus(resultOutcome.reason) === 403
      ) {
        throw resultOutcome.reason;
      }

      if (reportOutcome.status === "fulfilled") {
        const reportMessage = normalizeError(
          reportOutcome.value.data.message,
          "读取报告状态失败，请稍后重试。"
        );
        setReportMessage(reportMessage);
        setReportInfo({
          ...reportOutcome.value.data,
          message: reportMessage
        });
      } else if (
        getErrorStatus(reportOutcome.reason) === 401 ||
        getErrorStatus(reportOutcome.reason) === 403
      ) {
        throw reportOutcome.reason;
      }
    },
    []
  );

  useEffect(() => {
    if (!taskId || !token) {
      return;
    }

    const controller = new AbortController();
    const pollIntervalMs = 2000;
    const maxConsecutiveFailures = 5;
    let closed = false;
    let requestInFlight = false;
    let consecutiveFailures = 0;
    progressAbortRef.current = controller;

    const clearPollingInterval = () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };

    const pollProgress = async () => {
      if (closed || controller.signal.aborted || requestInFlight) {
        return;
      }

      requestInFlight = true;
      try {
        const { data: payload } = await apiGet<AuditProgressPayload>(
          `/audit/progress/${taskId}`,
          { token, signal: controller.signal }
        );

        if (closed || latestTaskIdRef.current !== taskId) {
          return;
        }

        consecutiveFailures = 0;
        setTaskStatus(payload.status);
        setProgressPercent(payload.progress_percent);
        const safeMessage = normalizeError(payload.message, "审核进度更新失败，请稍后刷新查看。");
        setProgressMessage(safeMessage);
        setProgressEvents((previous) =>
          mergeProgressEvents(previous, { ...payload, message: safeMessage })
        );

        if (TERMINAL_TASK_STATUSES.has(payload.status)) {
          clearPollingInterval();
          void fetchFinishedTaskArtifacts(taskId, token).catch((error) => {
            if (closed || latestTaskIdRef.current !== taskId) {
              return;
            }
            setWorkspaceError(
              normalizeError(error, "读取审核结果失败，请稍后重试。")
            );
          });
        }
      } catch (error) {
        if (closed || controller.signal.aborted) {
          return;
        }

        consecutiveFailures += 1;
        if (consecutiveFailures < maxConsecutiveFailures) {
          return;
        }

        clearPollingInterval();
        setTaskStatus("failed");
        setProgressMessage(PROGRESS_CONNECTION_INTERRUPTED_MESSAGE);
        setWorkspaceError(
          normalizeError(error, PROGRESS_CONNECTION_INTERRUPTED_MESSAGE)
        );
      } finally {
        requestInFlight = false;
      }
    };

    void pollProgress();
    progressIntervalRef.current = setInterval(() => {
      void pollProgress();
    }, pollIntervalMs);

    return () => {
      closed = true;
      clearPollingInterval();
      controller.abort();
      if (progressAbortRef.current === controller) {
        progressAbortRef.current = null;
      }
    };
  }, [fetchFinishedTaskArtifacts, taskId, token]);

  const deleteFilesSilently = useCallback(
    async (fileIds: string[]) => {
      if (!token || fileIds.length === 0) {
        return;
      }

      await Promise.allSettled(
        fileIds.map((fileId) => apiDelete<AuditDeleteResponse>(`/files/${fileId}`, { token }))
      );
      const deletedIds = new Set(fileIds);
      setResidualFiles((previous) => previous.filter((file) => !deletedIds.has(file.id)));
    },
    [token]
  );

  const handleCleanupResidualFiles = useCallback(async () => {
    if (!token) {
      setWorkspaceError("请先登录后再清理残留文件。");
      return;
    }

    const cleanupFileIds = residualVisibleFiles.map((file) => file.id);
    if (cleanupFileIds.length === 0) {
      setResidualFiles([]);
      return;
    }

    setResidualCleanupLoading(true);
    setWorkspaceError(null);
    setWorkspaceMessage(null);

    try {
      const { data } = await apiDelete<AuditBulkDeleteResponse>("/files/mine", {
        token,
        body: { file_ids: cleanupFileIds }
      });
      await fetchResidualFiles(token);
      setWorkspaceMessage(`已清理 ${data.deleted_count} 个残留文件。`);
    } catch (error) {
      setWorkspaceError(
        normalizeError(error, "清理残留文件失败，请稍后重试。")
      );
    } finally {
      setResidualCleanupLoading(false);
    }
  }, [fetchResidualFiles, residualVisibleFiles, token]);

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

      setRemovingFileIds((previous) =>
        previous.includes(fileId) ? previous : [...previous, fileId]
      );
      setWorkspaceError(null);
      setWorkspaceMessage(null);

      try {
        const { data } = await apiDelete<AuditDeleteResponse>(`/files/${fileId}`, {
          token
        });
        onSuccess();
        setResidualFiles((previous) => previous.filter((file) => file.id !== fileId));
        invalidateFinishedRun(`${resolveBucketName(key)}已调整，请重新启动审核。`);
        setWorkspaceMessage(data.message || `${resolveBucketName(key)}已删除。`);
      } catch (error) {
        if (getErrorStatus(error) === 404) {
          onSuccess();
          setResidualFiles((previous) => previous.filter((file) => file.id !== fileId));
          invalidateFinishedRun(`${resolveBucketName(key)}已调整，请重新启动审核。`);
          setWorkspaceMessage("该文件已不在暂存区，已从页面移除。");
          return;
        }

        setWorkspaceError(
          `${resolveBucketName(key)}删除失败：${normalizeError(error, "请稍后重试。")}`
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

  const handleStartAudit = useCallback(() => {
    setMarkedUnavailableHint(null);

    if (!token) {
      setWorkspaceError("请先登录后再启动审核。");
      return;
    }

    if (disclaimerOpen) {
      setWorkspaceError("请先确认免责声明，再进入审核工作台。");
      return;
    }

    if (!hasAnyKey) {
      setWorkspaceError("请先在设置页配置 API Key，否则无法启动审核。");
      return;
    }

    if (auditLocked) {
      setWorkspaceError("当前已有审核任务正在进行，请等待完成或先取消。");
      return;
    }

    if (uploadingKey || removingFileIds.length > 0) {
      setWorkspaceError("文件上传或删除处理中，请完成后再启动审核。");
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
      ...(selectedTemplateId ? { template_id: selectedTemplateId } : {}),
      reference_file_ids: referenceFiles.map((file) => file.id),
      deep_think: runDeepThink
    };

    setPendingStartPayload(payload);
    setRuleConfirmOpen(true);
  }, [
    auditLocked,
    disclaimerOpen,
    hasAnyKey,
    removingFileIds.length,
    poFile,
    prevTicketFiles,
    referenceFiles,
    runDeepThink,
    selectedTemplateId,
    targetFiles,
    templateFile,
    token,
    uploadingKey
  ]);

  const handleCancelRuleConfirm = useCallback(() => {
    setRuleConfirmOpen(false);
    setPendingStartPayload(null);
  }, []);

  const handleConfirmAndStart = useCallback(async () => {
    const payload = pendingStartPayload;
    setRuleConfirmOpen(false);

    if (!token) {
      setPendingStartPayload(null);
      setWorkspaceError("请先登录后再启动审核。");
      return;
    }

    if (!payload) {
      setWorkspaceError("启动审核信息已失效，请重新点击启动审核。");
      return;
    }

    clearRunState();

    setStartLoading(true);
    setWorkspaceError(null);
    setWorkspaceMessage(null);

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
      const status = getErrorStatus(error);
      const detail = normalizeError(error, "启动审核失败，请稍后重试。");

      if (status === 404 && detail.includes("未找到指定文件")) {
        setPoFile(null);
        setTargetFiles([]);
        setPrevTicketFiles([]);
        setTemplateFile(null);
        setReferenceFiles([]);
        setWorkspaceError(
          "文件已失效（服务端可能已重启），所有暂存文件已清空，请重新上传后再启动审核。"
        );
      } else {
        setWorkspaceError(detail);
      }
    } finally {
      setStartLoading(false);
      setPendingStartPayload(null);
    }
  }, [
    clearRunState,
    pendingStartPayload,
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
    setReportDownloadError(null);
    setMarkedUnavailableHint(null);

    try {
      const { data } = await apiGet<AuditReportResponse>(`/audit/report/${taskId}`, {
        token
      });
      setReportMessage(data.message);
      setReportInfo(data);
    } catch (error) {
      setWorkspaceError(normalizeError(error, "读取报告状态失败，请稍后重试。"));
    } finally {
      setReportLoading(false);
    }
  }, [taskId, token]);

  const handleDownloadReport = useCallback(
    async (reportType: AuditReportType) => {
      if (!token || !taskId) {
        setReportDownloadError("报告暂不可下载，请先运行一次审核。");
        setMarkedUnavailableHint(null);
        return;
      }

      setReportDownloadError(null);
      setMarkedUnavailableHint(null);
      setWorkspaceError(null);
      setDownloadingReports((previous) => ({ ...previous, [reportType]: true }));

      try {
        const { blob, filename } = await downloadAuditReport(taskId, reportType, {
          token
        });
        const objectUrl = window.URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.URL.revokeObjectURL(objectUrl);
      } catch (error) {
        if (reportType === "marked" && getErrorStatus(error) === 409) {
          const reasonCode = getErrorReasonCode(error);
          if (reasonCode) {
            console.debug("Marked report unavailable.", { reason_code: reasonCode });
          }
          setMarkedUnavailableHint(MARKED_REPORT_UNAVAILABLE_HINT);
          return;
        }

        const detail = normalizeError(error, "下载报告失败，请稍后重试。");
        setReportDownloadError(detail);
        if (typeof error === "object" && error && "status" in error && error.status === 404) {
          setReportMessage("报告已失效，请重新运行审核。");
          setReportInfo({
            task_id: taskId,
            message: "报告已失效，请重新运行审核。",
            status: "failed",
            available: false
          });
        }
      } finally {
        setDownloadingReports((previous) => ({ ...previous, [reportType]: false }));
      }
    },
    [taskId, token]
  );

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
              审核工作台会自动使用你在引导向导和设置页中保存的配置。
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
          description="在这里完成文件上传、审核启动、进度追踪、结果查看和报告下载。页面会自动使用你已保存的模型与规则配置。"
          icon={ScanSearch}
        />
        <div className="neo-panel bg-paper p-4">
          <p className="text-sm font-bold leading-6">
            你好，{accountDisplayName}。请上传单据并启动审核。
          </p>
        </div>

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
              「引导向导」页或「设置」页完成模型、规则和公司架构设置。
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

        {residualVisibleFiles.length > 0 ? (
          <div className="issue-yellow flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm font-bold leading-6">
              检测到上一轮残留文件（{residualVisibleFiles.length} 个），可能占用上传配额。
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleCleanupResidualFiles()}
              disabled={residualCleanupLoading || residualLoading}
            >
              {residualCleanupLoading ? (
                <Loader2 size={16} strokeWidth={3} className="animate-spin" />
              ) : (
                <Trash2 size={16} strokeWidth={3} />
              )}
              {residualCleanupLoading ? "清理中..." : "清理残留文件"}
            </Button>
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
              limitHint={AUDIT_SINGLE_UPLOAD_LIMIT_HINT}
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
              limitHint={AUDIT_SINGLE_UPLOAD_LIMIT_HINT}
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
              limitHint={AUDIT_MULTI_UPLOAD_LIMIT_HINT}
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
            <div className="border-4 border-ink bg-canvas p-4 text-sm font-black leading-6 shadow-neo-sm">
              <ul className="list-disc space-y-1 pl-5">
                {AUDIT_UPLOAD_HINT_LIST.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            </div>

            <FileBucket
              title="待审核文件区"
              description="上传多个待审核文件，并为每个文件明确指定文档类型。文档类型改变后，上一轮审核结果会自动清空，避免误读。"
              badgeLabel="2. 待审核文件"
              files={targetFiles}
              emptyHint="请至少上传 1 个待审核文件，才能启动审核。"
              limitHint={`${AUDIT_MULTI_UPLOAD_LIMIT_HINT} 启动审核前至少需要 1 个待审核文件。`}
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
              limitHint={AUDIT_MULTI_UPLOAD_LIMIT_HINT}
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
                启动审核时会自动使用系统硬约束规则、当前规则集和公司信息。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <BookOpenCheck size={18} strokeWidth={3} />
                      <p className="text-xs font-black uppercase tracking-[0.14em]">
                        选择规则集
                      </p>
                    </div>
                    <p className="text-sm font-bold leading-6">
                      选择本次审核要使用的一套自定义规则集。系统会自动组合系统硬约束规则、当前规则集和公司信息。
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push("/templates")}
                  >
                    去自定义规则集
                  </Button>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
                  <Select
                    value={selectedTemplateId}
                    disabled={templatesLoading || auditTemplates.length === 0 || workspaceDisabled}
                    onChange={(event) => {
                      setSelectedTemplateId(event.target.value);
                      invalidateFinishedRun("本轮自定义规则集已调整，请重新启动审核。");
                    }}
                  >
                    <option value="">
                      {auditTemplates.length > 0 ? "请选择规则集" : "暂无可选规则集"}
                    </option>
                    {auditTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                        {template.is_default ? " · 默认规则集" : ""}
                        {" · "}
                        {resolveBusinessTypeLabel(template.business_type)}
                      </option>
                    ))}
                  </Select>
                  {selectedTemplate ? (
                    <Badge variant="inverse">
                      {selectedTemplate.is_default ? "默认规则集" : resolveBusinessTypeLabel(selectedTemplate.business_type)}
                    </Badge>
                  ) : null}
                </div>

                {templatesLoading ? (
                  <p className="mt-3 text-sm font-bold leading-6">正在读取自定义规则集。</p>
                ) : null}
                {templatesError ? (
                  <div className="issue-red mt-3 p-4">
                    <p className="text-sm font-bold leading-6">{templatesError}</p>
                  </div>
                ) : null}
                {!templatesLoading && auditTemplates.length === 0 ? (
                  <div className="issue-yellow mt-3 p-4">
                    <p className="text-sm font-bold leading-6">
                      还没有自定义规则集，可先前往自定义规则集页面创建。未选择规则集时，将仅使用系统硬约束规则和公司信息。
                    </p>
                  </div>
                ) : null}
                {!templatesLoading && auditTemplates.length > 0 && !selectedTemplateId ? (
                  <div className="issue-yellow mt-3 p-4">
                    <p className="text-sm font-bold leading-6">
                      未选择任何规则集时，将仅使用系统硬约束规则和公司信息。
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                  <p className="text-xs font-black uppercase tracking-[0.14em]">
                    本轮实际模型
                  </p>
                  <p className="mt-2 text-sm font-bold leading-6">
                    {resolveEffectiveModelLabel(provider, profile?.selected_model, runDeepThink)}
                  </p>
                </div>
                <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                  <p className="text-xs font-black uppercase tracking-[0.14em]">
                    当前规则集规则数
                  </p>
                  <p className="mt-2 text-sm font-bold leading-6">
                    {selectedTemplateRuleCount} 条
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
                        ? "GLM-4.6V 支持深度思考。开启后，系统会在智谱请求中启用更强的推理模式。"
                        : "开启后，系统会使用更强的推理能力处理本轮审核。"}
                    </p>
                  </div>
                  <Tooltip
                    content="切换本轮审核的深度思考开关"
                  >
                    <Button
                      variant={runDeepThink ? "primary" : "outline"}
                      disabled={workspaceDisabled}
                      onClick={() => {
                        setRunDeepThink((previous) => !previous);
                        invalidateFinishedRun("本轮深度思考配置已变更，请重新启动审核。");
                      }}
                    >
                      <Sparkles size={18} strokeWidth={3} />
                      {runDeepThink ? "已开启" : "已关闭"}
                    </Button>
                  </Tooltip>
                </div>
              </div>

              {!profileLoading && !hasAnyKey ? (
                <div className="issue-yellow p-4">
                  <p className="text-sm font-bold leading-6">
                    请先在设置页配置 API Key，否则无法启动审核。
                  </p>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => void handleStartAudit()}
                  disabled={startLoading || auditLocked || disclaimerOpen || !hasAnyKey}
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
                <Button variant="outline" onClick={() => router.push("/history")}>
                  <History size={18} strokeWidth={3} />
                  审核历史
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
            onNavigateHistory={() => router.push("/history")}
          />

          <Card className="bg-muted">
            <CardHeader>
              <Badge variant="inverse">7. 报告区</Badge>
              <CardTitle>报告下载入口</CardTitle>
              <CardDescription>
                审核完成后，可以在这里查看报告状态并下载审核报告。
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

              <div className="border-4 border-ink bg-canvas p-4 shadow-neo-sm">
                {markedIssueSummary ? (
                  <div className="space-y-2 text-sm font-bold leading-6">
                    <p className="text-xs font-black uppercase tracking-[0.14em]">
                      标记版摘要
                    </p>
                    <p>本次共发现 {markedIssueSummary.total} 个问题：</p>
                    <p>✓ 已标记到原表：{markedIssueSummary.markedCount} 个</p>
                    <p>· 建议/资料类（仅详情版）：{markedIssueSummary.textOnlyCount} 个</p>
                    <p>· 其他状态：{markedIssueSummary.otherCount} 个</p>
                  </div>
                ) : null}
                <div
                  className={[
                    "space-y-2 text-sm font-bold leading-6",
                    markedIssueSummary ? "mt-3 border-t-4 border-ink pt-3" : ""
                  ].join(" ")}
                >
                  <p>推荐下载完整报告包 ZIP，里面包含详情版、标记版、任务信息和系统清单。</p>
                  <p>标记版用于查看原表红黄蓝标注。</p>
                  <p>详情版用于查看完整问题明细。</p>
                </div>
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

                {reportState.kind === "download"
                  ? REPORT_DOWNLOAD_BUTTONS.map((item) => (
                      <Tooltip key={item.type} content={item.tooltip}>
                        <Button
                          variant={item.variant}
                          onClick={() => void handleDownloadReport(item.type)}
                          disabled={downloadingReports[item.type]}
                        >
                          {downloadingReports[item.type] ? (
                            <Loader2 size={18} strokeWidth={3} className="animate-spin" />
                          ) : (
                            <Download size={18} strokeWidth={3} />
                          )}
                          {downloadingReports[item.type] ? "下载中..." : item.label}
                        </Button>
                      </Tooltip>
                    ))
                  : null}
              </div>

              {markedUnavailableHint ? (
                <div className="issue-yellow p-4">
                  <p className="text-sm font-bold leading-6">{markedUnavailableHint}</p>
                </div>
              ) : null}

              {reportDownloadError ? (
                <div className="issue-red p-4">
                  <p className="text-sm font-bold leading-6">{reportDownloadError}</p>
                </div>
              ) : null}

              <div className="issue-blue p-4 space-y-3">
                <p className="text-sm font-bold leading-6">
                  审核报告已持久化到云端存储，后端重启后仍可通过「审核历史」页面重新下载。
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push("/history")}
                >
                  <History size={16} strokeWidth={3} />
                  前往审核历史
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <Dialog
        open={ruleConfirmOpen}
        onClose={handleCancelRuleConfirm}
        title="本次审核将使用的规则"
        description="确认以下规则与公司信息后，系统才会启动审核任务。"
        footer={
          <>
            <Button variant="outline" onClick={handleCancelRuleConfirm}>
              取消
            </Button>
            <Button
              onClick={() => void handleConfirmAndStart()}
              disabled={!pendingStartPayload || startLoading}
            >
              {startLoading ? (
                <Loader2 size={18} strokeWidth={3} className="animate-spin" />
              ) : (
                <Play size={18} strokeWidth={3} />
              )}
              {startLoading ? "启动中..." : "确认并开始审核"}
            </Button>
          </>
        }
      >
        <DialogSection>
          {!selectedTemplate ? (
            <div className="issue-yellow p-4">
              <p className="text-sm font-bold leading-6">
                未选择任何规则集，将仅使用系统硬约束规则和公司信息。
              </p>
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            {[
              ["系统硬约束规则", "自动使用，不可关闭"],
              [
                "当前选择的自定义规则集",
                selectedTemplate
                  ? `「${selectedTemplate.name}」；自定义规则：${selectedTemplateRuleCount} 条`
                  : "未选择任何规则集"
              ],
              ["公司信息", companyAffiliatesDisplay],
              ["公司分工", companyAffiliateRolesDisplay],
              ["深度思考", runDeepThink ? "已开启" : "未开启"]
            ].map(([label, value]) => (
              <div key={label} className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-muted">
                  {label}
                </p>
                <p className="mt-2 text-sm font-bold leading-6">{value}</p>
              </div>
            ))}
          </div>
        </DialogSection>
      </Dialog>

      <Dialog
        open={disclaimerOpen}
        title="使用须知与免责声明"
        description="在使用审核功能之前，请仔细阅读以下内容。"
        footer={
          <Button
            onClick={() => void handleAcceptDisclaimer()}
            disabled={acceptingDisclaimer}
          >
            {acceptingDisclaimer ? "确认中..." : "我已阅读并同意"}
          </Button>
        }
      >
        <DialogSection>
          <p className="text-sm font-bold leading-6">
            本系统的审核结果由 AI 模型生成，仅供参考，不构成任何专业意见或最终判定。请务必结合人工复核，确认审核结论后再用于实际业务决策。
          </p>
          <p className="text-sm font-bold leading-6">
            使用本系统即表示您理解并接受：AI 审核可能存在遗漏或误判，系统开发方不对因审核结果导致的任何直接或间接损失承担责任。
          </p>
          <p className="text-sm font-bold leading-6">
            您上传的文件仅用于本次审核处理，系统会按当前配额与清理策略处理暂存文件。如有疑问，请联系管理员。
          </p>
        </DialogSection>
      </Dialog>
    </>
  );
}
