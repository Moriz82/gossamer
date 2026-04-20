export type SeverityKey = "crit" | "high" | "med" | "low" | "info" | "unknown";

/**
 * Normalize any backend severity string into the five-class scale used by the
 * UI. Backend values include "critical", "high", "medium", "low", "info",
 * "unknown" (plus a few per-scanner variants like "error", "warning").
 */
export function normalizeSeverity(raw: string | null | undefined): SeverityKey {
  const s = (raw || "").toLowerCase().trim();
  if (!s) return "unknown";
  if (s.startsWith("crit")) return "crit";
  if (s.startsWith("high") || s === "error") return "high";
  if (s.startsWith("med") || s === "warn" || s === "warning") return "med";
  if (s.startsWith("low")) return "low";
  if (s.startsWith("info") || s === "note" || s === "negligible") return "info";
  return "unknown";
}

const LABEL: Record<SeverityKey, string> = {
  crit: "crit",
  high: "high",
  med: "med",
  low: "low",
  info: "info",
  unknown: "unknown",
};

export function Severity({ s }: { s: SeverityKey | string }) {
  const key = typeof s === "string" ? normalizeSeverity(s) : s;
  return <span className={`sev-chip ${key}`}>{LABEL[key]}</span>;
}

export default Severity;
