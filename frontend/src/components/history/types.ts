export type HistoryStatusFilter = "ALL" | "COMPLETED";

export type HistoryResolvedStatus = "COMPLETED";

export type HistorySeveritySummary = {
  red?: number;
  yellow?: number;
  blue?: number;
};

export type HistoryListItem = {
  id: string;
  model_used: string;
  document_count: number;
  red_count: number;
  yellow_count: number;
  blue_count: number;
  deep_think_used: boolean;
  created_at: string | null;
};

export type HistoryListResponse = {
  items: HistoryListItem[];
  total_count?: number;
  page?: number;
  page_size?: number;
};

export type HistoryIssue = {
  id?: string;
  level?: "RED" | "YELLOW" | "BLUE";
  field_name?: string;
  message?: string;
  finding?: string;
  suggestion?: string;
  confidence?: number;
  document_label?: string;
  document_type?: string;
  file_id?: string;
  observed_value?: string;
  matched_po_value?: string;
};

export type HistoryDocumentAuditResult = {
  summary?: HistorySeveritySummary;
  issues?: HistoryIssue[];
  confidence?: number;
  message?: string;
  explanation?: string;
  ai_summary?: string;
  summary_text?: string;
  notes?: string[] | string;
  extra_notes?: string[] | string;
};

export type HistoryDocumentResult = {
  file_id?: string;
  doc_type?: string;
  provider?: string;
  result?: HistoryDocumentAuditResult;
};

export type HistoryAuditResult = {
  summary?: HistorySeveritySummary;
  issues?: HistoryIssue[];
  message?: string;
  confidence?: number;
  notes?: string[];
  documents?: HistoryDocumentResult[];
};

export type HistoryRuleSnapshotSection = {
  title?: string;
  label?: string;
  type?: string;
  key?: string;
  name?: string;
  rules?: unknown[] | string | null;
};

export type HistoryTemplateSnapshot = {
  id?: string;
  name?: string;
  description?: string;
  business_type?: "domestic" | "foreign";
  supplemental_rules?: string;
  is_default_at_run?: boolean;
};

export type HistoryRuleSnapshot = {
  schema_version?: number;
  resolved_at?: string;
  system_rules?: {
    title?: string;
    version?: number;
    rules?: Array<{
      code?: string;
      title?: string;
      content?: string;
    }>;
  };
  template?: HistoryTemplateSnapshot | null;
  selected_template?: {
    id?: string;
    name?: string;
  } | null;
  template_rules?: unknown[] | string | null;
  supplemental_rules?: unknown[] | string | null;
  temporary_rules?: string[] | string | null;
  run_supplemental_rules?: string[] | string | null;
  company_affiliates?: unknown[] | string | null;
  resolved_sections?: HistoryRuleSnapshotSection[];
};

export type HistoryDetailRecord = {
  id: string | null;
  user_id: string;
  document_count: number;
  red_count: number;
  yellow_count: number;
  blue_count: number;
  audit_result: HistoryAuditResult;
  model_used: string;
  custom_rules_snapshot: string[];
  audit_rule_snapshot?: HistoryRuleSnapshot | null;
  deep_think_used: boolean;
  created_at: string | null;
  updated_at: string | null;
  task_id?: string | null;
  report_paths?: Record<string, string> | null;
};

export type HistoryDetailResponse = {
  item: HistoryDetailRecord;
};
