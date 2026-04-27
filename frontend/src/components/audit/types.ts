export type AuditDocumentType =
  | "invoice"
  | "packing_list"
  | "shipping_instruction"
  | "bill_of_lading"
  | "certificate_of_origin"
  | "customs_declaration"
  | "letter_of_credit"
  | "other";

export type AuditFileRecord = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  detected_type: string;
  preview_text: string;
  uploaded_at: string;
};

export type AuditFileUploadResponse = {
  file: AuditFileRecord;
  message: string;
};

export type AuditFileListResponse = {
  files: AuditFileRecord[];
};

export type AuditDeleteResponse = {
  file_id: string;
  message: string;
};

export type AuditBulkDeleteResponse = {
  deleted_count: number;
};

export type AuditBucketFile = AuditFileRecord & {
  documentType?: AuditDocumentType;
  label?: string;
};

export type AuditStartPayload = {
  po_file_id: string;
  target_files: Array<{
    file_id: string;
    document_type: AuditDocumentType;
    label?: string | null;
  }>;
  prev_ticket_files: Array<{
    file_id: string;
    document_type: AuditDocumentType;
    label?: string | null;
  }>;
  template_file_id: string | null;
  template_id?: string | null;
  reference_file_ids: string[];
  deep_think: boolean;
};

export type AuditStartResponse = {
  task_id: string;
  status: string;
  message: string;
};

export type AuditProgressPayload = {
  id?: string;
  event_id?: string;
  task_id: string;
  status: string;
  progress_percent: number;
  message: string;
  created_at: string;
  updated_at: string;
};

export type AuditIssue = {
  id?: string;
  level: "RED" | "YELLOW" | "BLUE";
  field_name: string;
  message: string;
  confidence?: number;
  suggestion?: string;
  document_label?: string | null;
  document_type?: string | null;
  file_id?: string | null;
  matched_po_value?: string | null;
  observed_value?: string | null;
  source_excerpt?: string | null;
};

export type AuditRuleSnapshotSection = {
  title?: string;
  rules?: unknown[] | string | null;
};

export type AuditRuleSnapshot = {
  schema_version?: number;
  resolved_at?: string;
  resolved_sections?: AuditRuleSnapshotSection[];
  system_rules?: {
    title?: string;
    version?: number;
    rules?: unknown[];
  } | null;
  template?: {
    id?: string;
    name?: string;
    description?: string;
    business_type?: string;
    supplemental_rules?: string;
    is_default_at_run?: boolean;
  } | null;
  selected_template?: {
    id?: string;
    name?: string;
  } | null;
  temporary_rules?: unknown[] | string | null;
  run_supplemental_rules?: unknown[] | string | null;
  company_affiliates?: unknown[] | string | null;
};

export type AuditResultResponse = {
  task_id: string;
  status: string;
  summary: {
    red: number;
    yellow: number;
    blue: number;
  };
  issues: AuditIssue[];
  message: string;
  confidence?: number;
  notes?: string[];
  rule_snapshot?: AuditRuleSnapshot | null;
};

export type AuditCancelResponse = {
  task_id: string;
  status: string;
  message: string;
};

export type AuditReportResponse = {
  task_id: string;
  message: string;
  status?: "pending" | "ready" | "failed";
  available?: boolean;
  downloads?: AuditReportType[];
};

export type AuditReportType = "marked" | "detailed" | "zip";
