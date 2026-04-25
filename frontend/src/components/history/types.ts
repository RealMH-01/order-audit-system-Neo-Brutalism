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
  deep_think_used: boolean;
  created_at: string | null;
  updated_at: string | null;
  task_id?: string | null;
  report_paths?: Record<string, string> | null;
};

export type HistoryDetailResponse = {
  item: HistoryDetailRecord;
};
