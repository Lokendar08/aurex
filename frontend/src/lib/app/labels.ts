import { humanize } from "./format";

const ERROR_LABELS: Record<string, string> = {
  missing_required: "Required value missing",
  invalid_date: "Invalid date",
  invalid_number: "Invalid number",
  invalid_choice: "Value not allowed",
  negative_value: "Negative value where not allowed",
  unknown_store: "Unknown store code",
  unknown_product: "Unknown product SKU",
  unknown_supplier: "Unknown supplier code",
  unknown_category: "Unknown category code",
  net_mismatch: "Net amount doesn’t match gross − discounts − refunds",
  duplicate_in_file: "Duplicate row in the file",
  currency_mismatch: "Currency differs from the company currency",
};

/** Readable name for a validation error code from the import pipeline. */
export function errorCodeLabel(code: string): string {
  return ERROR_LABELS[code] ?? humanize(code);
}

const METHOD_LABELS: Record<string, string> = {
  api: "API",
  oauth: "OAuth",
  webhook: "Webhook",
  csv: "CSV",
  excel: "Excel",
  approved_export: "Approved export",
  database: "Read-only database",
  synthetic: "Synthetic",
};

export function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? humanize(method);
}

const CATEGORY_LABELS: Record<string, string> = {
  pos: "POS",
  erp: "ERP",
  inventory: "Inventory",
  accounting: "Accounting",
  workforce: "Workforce",
  crm: "CRM",
  marketing: "Marketing",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? humanize(category);
}

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual sync",
  upload: "File upload",
  schedule: "Schedule",
  webhook: "Webhook event",
  seed: "Initial load",
};

export function triggerLabel(trigger: string): string {
  return TRIGGER_LABELS[trigger] ?? humanize(trigger);
}

export const FILE_PROVIDERS = new Set(["csv_upload", "excel_upload"]);
export const LIVE_PROVIDERS = new Set(["generic_rest", "postgres_readonly"]);

/** Whether a connection accepts file uploads (file imports and vendor profiles awaiting an API). */
export function acceptsUploads(providerKey: string, availability: string | null | undefined): boolean {
  return FILE_PROVIDERS.has(providerKey) || availability === "requires_vendor_authorization";
}

/** Whether a connection can pull data on demand (never for files, webhooks or synthetic feeds). */
export function canPull(providerKey: string): boolean {
  return !FILE_PROVIDERS.has(providerKey) && providerKey !== "webhook_push";
}
