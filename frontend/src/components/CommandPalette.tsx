import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";

export type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  onNavigate: (tab: string) => void;
};

type Item = {
  section: string;
  label: string;
  hint: string;
  action: () => void;
};

const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose, onNavigate }) => {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  const items: Item[] = useMemo(
    () => [
      { section: "Navigate", label: "Graph", hint: "G", action: () => onNavigate("graph") },
      { section: "Navigate", label: "Sitemap", hint: "S", action: () => onNavigate("sitemap") },
      { section: "Navigate", label: "Intel", hint: "I", action: () => onNavigate("intel") },
      { section: "Navigate", label: "Ingest & Crawl", hint: "O", action: () => onNavigate("operations") },
      { section: "Navigate", label: "Findings", hint: "F", action: () => onNavigate("findings") },
      { section: "Navigate", label: "Scanners", hint: "N", action: () => onNavigate("scanners") },
      { section: "Navigate", label: "Settings", hint: ",", action: () => onNavigate("settings") },
      { section: "Navigate", label: "Ingestors", hint: "", action: () => onNavigate("ingestors") },
      { section: "Navigate", label: "Queries", hint: "", action: () => onNavigate("queries") },
      { section: "Navigate", label: "Types", hint: "", action: () => onNavigate("registry") },
      { section: "Navigate", label: "Data", hint: "", action: () => onNavigate("data") },
      { section: "Actions", label: "New crawl…", hint: "⌘⇧C", action: () => onNavigate("operations") },
      { section: "Actions", label: "Run scanner…", hint: "⌘⇧N", action: () => onNavigate("scanners") },
      { section: "Actions", label: "Import…", hint: "⌘⇧I", action: () => onNavigate("operations") },
    ],
    [onNavigate],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (it) =>
        it.label.toLowerCase().includes(needle) || it.section.toLowerCase().includes(needle),
    );
  }, [items, q]);

  const sections = useMemo(() => {
    const out: Record<string, Item[]> = {};
    filtered.forEach((it) => {
      (out[it.section] ||= []).push(it);
    });
    return out;
  }, [filtered]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(filtered.length - 1, s + 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(0, s - 1));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const target = filtered[sel];
        if (target) target.action();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, sel, filtered, onClose]);

  if (!open) return null;

  let idx = -1;
  return (
    <div className="cmdk-overlay" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Type a command, search nodes, jump to screen…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
        />
        <div className="cmdk-list">
          {Object.entries(sections).map(([sec, arr]) => (
            <div key={sec}>
              <div className="cmdk-section-title">{sec}</div>
              {arr.map((it) => {
                idx += 1;
                const isSel = idx === sel;
                return (
                  <div
                    key={sec + it.label}
                    className={`cmdk-item ${isSel ? "sel" : ""}`}
                    onMouseEnter={() => setSel(idx)}
                    onClick={() => {
                      it.action();
                      onClose();
                    }}
                  >
                    <span className="cmdk-icon">
                      {sec === "Navigate" ? (
                        <Icon.chevronR size={14} />
                      ) : sec === "Actions" ? (
                        <Icon.play size={12} />
                      ) : (
                        <Icon.search size={14} />
                      )}
                    </span>
                    <span className="cmdk-label">{it.label}</span>
                    <span className="cmdk-hint">{it.hint}</span>
                  </div>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
              No results for "{q}"
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
