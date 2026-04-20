import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { Icon } from "../components/icons";
import { Severity, normalizeSeverity, type SeverityKey } from "../components/Severity";

type FindingNode = {
  id: string;
  kind: string;
  key: string;
  properties: {
    name?: string;
    template_id?: string;
    severity?: string;
    scanner?: string;
    matcher_name?: string;
    matched_at?: string | null;
    host?: string | null;
    description?: string;
    remediation?: string;
    evidence?: string;
    url?: string;
    updated_at?: string;
    [k: string]: unknown;
  };
};

type FindingsResponse = {
  findings: FindingNode[];
  count: number;
};

type SeverityFilter = Record<SeverityKey, boolean>;

const SEV_ORDER: SeverityKey[] = ["crit", "high", "med", "low", "info"];
const SEV_LABEL: Record<SeverityKey, string> = {
  crit: "Critical",
  high: "High",
  med: "Medium",
  low: "Low",
  info: "Info",
  unknown: "Unknown",
};

const DEFAULT_SEV_FILTER: SeverityFilter = {
  crit: true, high: true, med: true, low: true, info: false, unknown: true,
};

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.max(0, (Date.now() - then) / 1000);
  if (diffSec < 60) return `${Math.floor(diffSec)}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  const days = Math.floor(diffSec / 86400);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

function findingTitle(f: FindingNode): string {
  const p = f.properties;
  return p.name || p.template_id || "Finding";
}

function findingTarget(f: FindingNode): string {
  const p = f.properties;
  if (p.matched_at) return p.matched_at;
  if (p.url) return p.url;
  // Merge keys encode the target as the last `|`-delimited segment (see
  // `finding_merge_key` in backend/gossamer/ingestors/finding_helpers.py).
  const parts = (f.key || "").split("|");
  const maybeUrl = parts[parts.length - 1];
  if (maybeUrl && /^(https?:|file:|pkg:)/.test(maybeUrl)) return maybeUrl;
  if (p.host) return p.host;
  return "—";
}

function findingHost(f: FindingNode): string {
  const p = f.properties;
  if (p.host) return p.host;
  const t = findingTarget(f);
  try {
    return new URL(t).host;
  } catch {
    return "";
  }
}

function findingWhen(f: FindingNode): string {
  return relativeTime(f.properties.updated_at || null);
}

function findingEvidence(f: FindingNode): string {
  const p = f.properties;
  if (typeof p.evidence === "string" && p.evidence.trim()) return p.evidence;
  if (typeof p.description === "string" && p.description.trim()) return p.description;
  if (typeof p.matcher_name === "string" && p.matcher_name.trim()) {
    return `matcher: ${p.matcher_name}`;
  }
  return "(no evidence captured)";
}

function findingRemediation(f: FindingNode): string {
  const r = f.properties.remediation;
  if (typeof r === "string" && r.trim()) return r;
  return "No remediation guidance was provided by the scanner. Consult the template or CVE reference for standard mitigations.";
}

function buildCurl(f: FindingNode): string {
  const target = findingTarget(f);
  if (!target || target === "—") return "# target unknown";
  // Shell-escape the URL by single-quoting; if the URL contains a single
  // quote, break out and re-escape it.
  const safe = target.replace(/'/g, "'\\''");
  return `curl -sk -i '${safe}'`;
}

function mostRecentTimestamp(list: FindingNode[]): string | null {
  let best: number | null = null;
  for (const f of list) {
    const t = Date.parse(f.properties.updated_at || "");
    if (!Number.isNaN(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type Props = {
  onOpenInGraph?: (nodeId: string) => void;
};

export default function FindingsPanel({ onOpenInGraph }: Props) {
  const [all, setAll] = useState<FindingNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState<SeverityFilter>(DEFAULT_SEV_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = () => {
    setError(null);
    apiJson<FindingsResponse>("/api/findings?limit=5000")
      .then((res) => setAll(res.findings || []))
      .catch((e: unknown) => {
        setAll([]);
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  useEffect(load, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const counts = useMemo<Record<SeverityKey, number>>(() => {
    const c: Record<SeverityKey, number> = { crit: 0, high: 0, med: 0, low: 0, info: 0, unknown: 0 };
    for (const f of all || []) c[normalizeSeverity(f.properties.severity)] += 1;
    return c;
  }, [all]);

  const filtered = useMemo(() => {
    if (!all) return [];
    const q = search.trim().toLowerCase();
    return all.filter((f) => {
      const sev = normalizeSeverity(f.properties.severity);
      if (!sevFilter[sev]) return false;
      if (!q) return true;
      const hay = [
        findingTitle(f),
        findingTarget(f),
        findingHost(f),
        f.properties.template_id || "",
        f.properties.scanner || "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [all, search, sevFilter]);

  useEffect(() => {
    if (!filtered.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filtered.some((f) => f.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const selected = useMemo(
    () => filtered.find((f) => f.id === selectedId) || null,
    [filtered, selectedId],
  );

  const lastRun = useMemo(() => mostRecentTimestamp(all || []), [all]);

  const handleRerun = () => {
    // Rescanning needs a scanner selection + target; route user to the Operations
    // tab where the full scan pipeline lives. Fall back to a toast if the host
    // doesn't expose a navigation handler.
    window.dispatchEvent(
      new CustomEvent("gossamer:navigate", { detail: { tab: "operations" } }),
    );
    setToast("Switched to Operations — pick a scanner to rerun.");
  };

  const handleExport = () => {
    const payload = {
      exported_at: new Date().toISOString(),
      total: (all || []).length,
      counts,
      findings: all || [],
    };
    downloadJson(`gossamer-findings-${Date.now()}.json`, payload);
    setToast("Exported findings as JSON.");
  };

  const handleOpenInGraph = (f: FindingNode) => {
    if (onOpenInGraph) {
      onOpenInGraph(f.id);
      return;
    }
    window.dispatchEvent(
      new CustomEvent("gossamer:open-in-graph", { detail: { nodeId: f.id } }),
    );
  };

  const handleCopyCurl = async (f: FindingNode) => {
    try {
      await navigator.clipboard.writeText(buildCurl(f));
      setToast("cURL copied to clipboard.");
    } catch (e) {
      setToast(`Copy failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const total = (all || []).length;

  return (
    <div className="screen">
      <div className="screen-header">
        <h1 className="screen-title">Findings</h1>
        <span className="screen-sub">
          {total} total{lastRun ? ` \u00B7 last run ${relativeTime(lastRun)}` : ""}
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={handleRerun}>
          <Icon.refresh size={12} /> Rerun scan
        </button>
        <button type="button" className="btn" onClick={handleExport} disabled={!all || total === 0}>
          <Icon.export size={12} /> Export report
        </button>
      </div>
      <div className="screen-body">
        <div className={`findings${selected ? "" : " no-detail"}`}>
          <div className="findings-list">
            <div className="find-summary">
              {SEV_ORDER.map((s) => (
                <div key={s} className={`find-stat ${s}`}>
                  <div className="fs-lbl">{SEV_LABEL[s]}</div>
                  <div className="fs-num">{counts[s] || 0}</div>
                </div>
              ))}
            </div>
            <div className="find-toolbar">
              <div className="searchbar" style={{ minWidth: 240 }}>
                <Icon.search size={13} />
                <input
                  placeholder={"Search findings\u2026"}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="chip-row">
                {SEV_ORDER.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`chip ${sevFilter[s] ? "on" : ""}`}
                    onClick={() => setSevFilter((f) => ({ ...f, [s]: !f[s] }))}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: "var(--fs-xs)", color: "var(--fg-3)" }}>
                {filtered.length} matching
              </span>
            </div>
            <div className="find-rows">
              {all === null ? (
                <div className="find-empty">
                  <div className="find-empty-title">{"Loading\u2026"}</div>
                </div>
              ) : filtered.length === 0 ? (
                <div className="find-empty">
                  <div className="find-empty-title">
                    {total === 0 ? "No findings yet" : "No findings match your filters"}
                  </div>
                  <div className="find-empty-sub">
                    {total === 0
                      ? "Run a scanner from the Operations tab to populate this view."
                      : "Try broadening the severity chips or clearing the search."}
                  </div>
                  {error ? <div className="find-empty-sub" style={{ color: "var(--err)" }}>{error}</div> : null}
                </div>
              ) : (
                filtered.map((f) => (
                  <div
                    key={f.id}
                    className={`find-row${selectedId === f.id ? " sel" : ""}`}
                    onClick={() => setSelectedId(f.id)}
                  >
                    <Severity s={normalizeSeverity(f.properties.severity)} />
                    <div className="fr-title">{findingTitle(f)}</div>
                    <div className="fr-target" title={findingTarget(f)}>{findingTarget(f)}</div>
                    <div className="fr-when">{findingWhen(f)}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {selected && (
            <aside className="find-detail">
              <Severity s={normalizeSeverity(selected.properties.severity)} />
              <h2 className="fd-title">{findingTitle(selected)}</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                {selected.properties.scanner ? (
                  <span className="chip on mono" style={{ fontSize: 10 }}>
                    {selected.properties.scanner}
                  </span>
                ) : null}
                {selected.properties.template_id ? (
                  <span className="chip mono" style={{ fontSize: 10 }}>
                    {selected.properties.template_id}
                  </span>
                ) : null}
              </div>

              <div className="fd-section">
                <div className="fd-section-title">Target</div>
                <pre className="fd-evidence">
                  {findingTarget(selected)}
                  {findingHost(selected) ? `\nHost: ${findingHost(selected)}` : ""}
                </pre>
              </div>

              <div className="fd-section">
                <div className="fd-section-title">Evidence</div>
                <pre className="fd-evidence">{findingEvidence(selected)}</pre>
              </div>

              <div className="fd-section">
                <div className="fd-section-title">Remediation</div>
                <div className="fd-remediation">{findingRemediation(selected)}</div>
              </div>

              <div className="fd-section">
                <div className="fd-section-title">Actions</div>
                <div className="fd-actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled
                    title="Coming soon — backend persistence is not yet implemented."
                  >
                    Mark as triaged
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled
                    title="Coming soon — backend persistence is not yet implemented."
                  >
                    Suppress
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => handleOpenInGraph(selected)}
                  >
                    Open in graph
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void handleCopyCurl(selected)}
                  >
                    Copy cURL
                  </button>
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
