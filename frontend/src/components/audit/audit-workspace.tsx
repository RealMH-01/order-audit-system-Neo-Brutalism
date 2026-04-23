"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
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
import {
  FileBucket
} from "@/components/audit/file-bucket";
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

  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
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
  const [resultFilter, setResultFilter] = useState<"ALL" | "RED" | "YELLOW" | "BLUE">(
    "ALL"
  );
  const [reportLoading, setReportLoading] = useState(false);
  const [reportMessage, setReportMessage] = useState<string | null>(null);

  const provider = useMemo(
    () => resolveProviderFromModel(profile?.selected_model ?? "gpt-4o"),
    [profile?.selected_model]
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
      setWorkspaceError(normalizeError(error, "读取当前审核配置失败，请稍后重试。"));
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
    if (!taskId || !token) {
      return;
    }

    if (!["queued", "running", "cancelling"].includes(taskStatus)) {
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
        setProgressEvents((previous) => [...previous, payload]);

        if (
          payload.status === "completed" ||
          payload.status === "failed" ||
          payload.status === "cancelled"
        ) {
          void apiGet<AuditResultResponse>(`/audit/result/${taskId}`, {
            token
          })
            .then(({ data }) => setResult(data))
            .catch((error) =>
              setWorkspaceError(
                normalizeError(error, "读取审核结果失败，请稍后重试。")
              )
            );

          void apiGet<AuditReportResponse>(`/audit/report/${taskId}`, {
            token
          })
            .then(({ data }) => setReportMessage(data.message))
            .catch((error) =>
              setWorkspaceError(
                normalizeError(error, "读取报告状态失败，请稍后重试。")
              )
            );
        }
      }
    }).catch((error) => {
      if (controller.signal.aborted) {
        return;
      }
      setWorkspaceError(normalizeError(error, "建立审核进度流失败，请稍后重试。"));
    });

    return () => {
      controller.abort();
    };
  }, [taskId, taskStatus, token]);

  const uploadSingleFile = useCallback(
    async (
      file: File,
      currentFile: AuditBucketFile | null,
      key: string,
      onSuccess: (nextFile: AuditBucketFile) => void
    ) => {
      if (!token) {
        setWorkspaceError("请先登录后再上传文件。");
        return;
      }

      setUploadingKey(key);
      setWorkspaceError(null);
      setWorkspaceMessage(null);

      try {
        const path = currentFile
          ? `/files/${currentFile.id}/replace`
          : "/files/upload";
        const { data } = await apiUploadFile<AuditFileUploadResponse>(path, file, {
          token
        });
        onSuccess({
          ...data.file,
          documentType: resolveDefaultDocumentType(data.file.detected_type),
          label: data.file.filename
        });
        setWorkspaceMessage(data.message);
      } catch (error) {
        setWorkspaceError(normalizeError(error, "上传文件失败，请稍后重试。"));
      } finally {
        setUploadingKey(null);
      }
    },
    [token]
  );

  const uploadMultipleFiles = useCallback(
    async (
      files: FileList,
      key: string,
      onSuccess: (nextFiles: AuditBucketFile[]) => void
    ) => {
      if (!token) {
        setWorkspaceError("请先登录后再上传文件。");
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
          uploaded.push({
            ...data.file,
            documentType: resolveDefaultDocumentType(data.file.detected_type),
            label: data.file.filename
          });
          setWorkspaceMessage(data.message);
        }
        onSuccess(uploaded);
      } catch (error) {
        setWorkspaceError(normalizeError(error, "上传文件失败，请稍后重试。"));
      } finally {
        setUploadingKey(null);
      }
    },
    [token]
  );

  const removeFile = useCallback(
    async (
      fileId: string,
      onSuccess: () => void
    ) => {
      if (!token) {
        setWorkspaceError("请先登录后再删除文件。");
        return;
      }

      try {
        const { data } = await apiDelete<AuditDeleteResponse>(`/files/${fileId}`, {
          token
        });
        onSuccess();
        setWorkspaceMessage(data.message);
      } catch (error) {
        setWorkspaceError(normalizeError(error, "删除文件失败，请稍后重试。"));
      }
    },
    [token]
  );

  const handleStartAudit = useCallback(async () => {
    if (!token) {
      setWorkspaceError("请先登录后再启动审核。");
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

    setStartLoading(true);
    setWorkspaceError(null);
    setWorkspaceMessage(null);
    setResult(null);
    setReportMessage(null);
    setProgressEvents([]);

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
  }, [poFile, prevTicketFiles, provider, referenceFiles, runDeepThink, targetFiles, templateFile, token]);

  const handleCancelAudit = useCallback(async () => {
    if (!token || !taskId) {
      return;
    }

    setCancelling(true);
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
      await apiPut(
        "/settings/disclaimer",
        { disclaimer_accepted: true },
        { token }
      );
      setProfile((previous) =>
        previous ? { ...previous, disclaimer_accepted: true } : previous
      );
      setDisclaimerOpen(false);
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
          description="当前审核工作台需要已保存登录态。请先完成向导或返回设置页建立当前用户会话。"
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
          description="这一轮把 /audit 从骨架提升为主工作台：文件上传、审核启动、SSE 进度、结果展示和报告入口都在这里收口。"
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
              当前账号还没有完成向导配置。你仍然可以尝试搭建审核任务，但建议先去
              `/wizard` 或 `/settings` 完成模型和规则配置。
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

        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-6">
            <FileBucket
              title="PO 基准区"
              description="这里只允许上传单个基准 PO，后续所有审核都以它为准。"
              badgeLabel="1. PO 基准区"
              files={poFile ? [poFile] : []}
              emptyHint="请先上传 1 个 PO 基准文件。"
              uploading={uploadingKey === "po"}
              uploadLabel={poFile ? "替换 PO 基准文件" : "上传 PO 基准文件"}
              onUpload={(files) =>
                void uploadSingleFile(files[0], poFile, "po", setPoFile)
              }
              onRemove={(fileId) =>
                void removeFile(fileId, () => setPoFile(null))
              }
            />

            <FileBucket
              title="辅助资料区 · 模板文件"
              description="可选上传 1 个模板文件，作为本次审核的参考模版。"
              badgeLabel="3A. 模板文件"
              files={templateFile ? [templateFile] : []}
              emptyHint="模板文件是可选项。当前未上传也不会阻止启动审核。"
              uploading={uploadingKey === "template"}
              uploadLabel={templateFile ? "替换模板文件" : "上传模板文件"}
              onUpload={(files) =>
                void uploadSingleFile(files[0], templateFile, "template", setTemplateFile)
              }
              onRemove={(fileId) =>
                void removeFile(fileId, () => setTemplateFile(null))
              }
            />

            <FileBucket
              title="辅助资料区 · 参考文件"
              description="可选上传多个参考文件，为审核引擎提供额外上下文。"
              badgeLabel="3B. 参考文件"
              files={referenceFiles}
              emptyHint="参考文件是可选项。你可以稍后再补。"
              multiple
              uploading={uploadingKey === "reference"}
              uploadLabel="上传参考文件"
              onUpload={(files) =>
                void uploadMultipleFiles(files, "reference", (uploaded) =>
                  setReferenceFiles((previous) => [...previous, ...uploaded])
                )
              }
              onRemove={(fileId) =>
                void removeFile(fileId, () =>
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
              description="支持上传多个待审核文件，并为每个文件指定文档类型。"
              badgeLabel="2. 待审核文件"
              files={targetFiles}
              emptyHint="请至少上传 1 个待审核文件，才能启动审核。"
              multiple
              allowDocumentType
              uploading={uploadingKey === "target"}
              uploadLabel="上传待审核文件"
              onUpload={(files) =>
                void uploadMultipleFiles(files, "target", (uploaded) =>
                  setTargetFiles((previous) => [...previous, ...uploaded])
                )
              }
              onRemove={(fileId) =>
                void removeFile(fileId, () =>
                  setTargetFiles((previous) =>
                    previous.filter((item) => item.id !== fileId)
                  )
                )
              }
              onDocumentTypeChange={(fileId, documentType) =>
                setTargetFiles((previous) =>
                  previous.map((item) =>
                    item.id === fileId ? { ...item, documentType } : item
                  )
                )
              }
            />

            <FileBucket
              title="辅助资料区 · 上一票文件"
              description="可选上传多个上一票文件，并为每个文件指定文档类型。"
              badgeLabel="3C. 上一票文件"
              files={prevTicketFiles}
              emptyHint="上一票文件是可选项，用于交叉比对时补充上下文。"
              multiple
              allowDocumentType
              uploading={uploadingKey === "prev"}
              uploadLabel="上传上一票文件"
              onUpload={(files) =>
                void uploadMultipleFiles(files, "prev", (uploaded) =>
                  setPrevTicketFiles((previous) => [...previous, ...uploaded])
                )
              }
              onRemove={(fileId) =>
                void removeFile(fileId, () =>
                  setPrevTicketFiles((previous) =>
                    previous.filter((item) => item.id !== fileId)
                  )
                )
              }
              onDocumentTypeChange={(fileId, documentType) =>
                setPrevTicketFiles((previous) =>
                  previous.map((item) =>
                    item.id === fileId ? { ...item, documentType } : item
                  )
                )
              }
            />
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="bg-secondary">
            <CardHeader>
              <Badge variant="inverse">4. 审核控制区</Badge>
              <CardTitle>启动本次审核</CardTitle>
              <CardDescription>
                当前会复用已保存登录态、模型配置和 deep think 设置，并严格按
                `/api/audit/start` 协议构造请求体。
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
                      本次审核是否开启深度思考
                    </p>
                    <p className="text-sm font-bold leading-6">
                      {provider === "zhipuai"
                        ? "智谱当前不支持深度思考，本次将自动关闭。"
                        : "这里默认继承 settings 中的状态，但只影响本次审核请求。"}
                    </p>
                  </div>
                  <Tooltip
                    content={
                      provider === "zhipuai"
                        ? "智谱当前不支持深度思考"
                        : "切换本次审核的深度思考"
                    }
                  >
                    <Button
                      variant={runDeepThink ? "primary" : "outline"}
                      onClick={() => setRunDeepThink((previous) => !previous)}
                      disabled={provider === "zhipuai"}
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
                  当前会按下面结构发起审核：
                  <code className="mx-1 rounded-none border-2 border-ink bg-paper px-2 py-1">
                    po_file_id / target_files / prev_ticket_files / template_file_id /
                    reference_file_ids / deep_think
                  </code>
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={() => void handleStartAudit()} disabled={startLoading}>
                  <Play size={18} strokeWidth={3} />
                  {startLoading ? "启动中..." : "启动审核"}
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

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
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
                这轮只做最小接线。即使后端仍返回占位信息，前端也会明确展示当前状态，而不是静默不处理。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="text-sm font-bold leading-6">
                  {reportMessage ??
                    "审核完成后，这里会显示报告状态。当前后端如果仍返回占位说明，也会原样提示“报告功能待后续联调收口”。"}
                </p>
              </div>
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
