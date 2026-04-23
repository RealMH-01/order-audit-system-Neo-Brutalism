export type HistoryStatusFilter = "ALL" | "COMPLETED";

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
};

export type HistoryAuditResult = {
  summary?: {
    red?: number;
    yellow?: number;
    blue?: number;
  };
  issues?: HistoryIssue[];
  message?: string;
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
};

export type HistoryDetailResponse = {
  item: HistoryDetailRecord;
};
