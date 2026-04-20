import React, { useCallback, useEffect, useRef, useState } from "react";
import { Icon, type IconProps } from "./Icon";

export type Tab =
  | "graph"
  | "sitemap"
  | "intel"
  | "operations"
  | "scanners"
  | "findings"
  | "settings"
  | "ingestors"
  | "queries"
  | "registry"
  | "data";

export type Project = {
  name: string;
  created_at: string;
  has_database: boolean;
  size_bytes: number;
};

export type ShellProps = {
  tab: Tab;
  setTab: (t: Tab) => void;
  graphStats: { nodes: number };
  onOpenCmdk: () => void;
  onLogout: () => void;
  projects: Project[];
  activeProject: string;
  onSwitchProject: (name: string) => void;
  onCreateProject: (name: string) => void;
  onDeleteProject: (name: string) => void;
  onExportProject: (name: string) => void;
  onReloadProjects: () => void;
  projectBusy?: boolean;
  children?: React.ReactNode;
};

type NavItem = {
  id: Tab;
  icon: React.FC<IconProps>;
  label: string;
  hint: string;
  count?: number;
};

function renderRailItem(it: NavItem, activeTab: Tab, setTab: (t: Tab) => void) {
  const IconEl = it.icon;
  return (
    <button
      key={it.id}
      type="button"
      className={`rail-item ${activeTab === it.id ? "active" : ""}`}
      onClick={() => setTab(it.id)}
      aria-label={it.label}
      data-tab={it.id}
    >
      <IconEl size={18} />
      {it.count !== undefined && <span className="rail-count">{it.count}</span>}
      <span className="rail-tip">
        {it.label} <kbd>{it.hint}</kbd>
      </span>
    </button>
  );
}

const Shell: React.FC<ShellProps> = ({
  tab,
  setTab,
  graphStats,
  onOpenCmdk,
  onLogout,
  projects,
  activeProject,
  onSwitchProject,
  onCreateProject,
  onDeleteProject,
  onExportProject,
  onReloadProjects,
  projectBusy = false,
  children,
}) => {
  const navItems: NavItem[] = [
    { id: "graph", icon: Icon.graph, label: "Graph", hint: "G", count: graphStats.nodes },
    { id: "sitemap", icon: Icon.sitemap, label: "Sitemap", hint: "S" },
    { id: "intel", icon: Icon.intel, label: "Intel", hint: "I" },
    { id: "operations", icon: Icon.ops, label: "Ingest & Crawl", hint: "O" },
    { id: "scanners", icon: Icon.scan, label: "Scanners", hint: "N" },
    { id: "findings", icon: Icon.finding, label: "Findings", hint: "F" },
  ];
  const bottomItems: NavItem[] = [
    { id: "settings", icon: Icon.settings, label: "Settings", hint: "," },
  ];

  const currentLabel =
    navItems.concat(bottomItems).find((i) => i.id === tab)?.label ?? tab;

  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const projectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showProjectMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (projectRef.current && target && !projectRef.current.contains(target)) {
        setShowProjectMenu(false);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [showProjectMenu]);

  const togglePillMenu = useCallback(() => {
    setShowProjectMenu((v) => {
      const next = !v;
      if (next) onReloadProjects();
      return next;
    });
  }, [onReloadProjects]);

  const submitCreate = useCallback(() => {
    const name = newProjectName.trim();
    if (!name) return;
    onCreateProject(name);
    setNewProjectName("");
  }, [newProjectName, onCreateProject]);

  return (
    <div className="app">
      <aside className="rail">
        <div className="rail-brand">
          <svg viewBox="0 0 32 32" width="22" height="22" style={{ color: "var(--silk)" }}>
            <g stroke="currentColor" fill="none" strokeLinecap="round">
              <g strokeWidth="0.5" opacity="0.7">
                <line x1="16" y1="16" x2="16" y2="2" />
                <line x1="16" y1="16" x2="28" y2="6" />
                <line x1="16" y1="16" x2="30" y2="16" />
                <line x1="16" y1="16" x2="28" y2="26" />
                <line x1="16" y1="16" x2="16" y2="30" />
                <line x1="16" y1="16" x2="4" y2="26" />
                <line x1="16" y1="16" x2="2" y2="16" />
                <line x1="16" y1="16" x2="4" y2="6" />
              </g>
              <g strokeWidth="0.3" opacity="0.4">
                <circle cx="16" cy="16" r="5" />
                <circle cx="16" cy="16" r="10" />
                <circle cx="16" cy="16" r="14" />
              </g>
            </g>
            <circle cx="16" cy="16" r="2" fill="currentColor" />
          </svg>
        </div>

        {navItems.map((it) => renderRailItem(it, tab, setTab))}

        <div className="rail-spacer" />

        {bottomItems.map((it) => renderRailItem(it, tab, setTab))}
        <button type="button" className="rail-item" onClick={onLogout} aria-label="Sign out">
          <Icon.logout size={18} />
          <span className="rail-tip">Sign out</span>
        </button>
      </aside>

      <header className="header">
        <div>
          <span className="brand-word">Gossamer</span>
          <span className="brand-sub">v2.4</span>
        </div>
        <div style={{ width: 1, height: 20, background: "var(--line-1)" }} />
        <div ref={projectRef} style={{ position: "relative" }}>
          <button type="button" className="project-pill" onClick={togglePillMenu}>
            <span className="pill-dot" />
            <span className="mono">{activeProject}</span>
            <Icon.chevron size={10} className="chevron" />
          </button>
          {showProjectMenu && (
            <div className="project-menu">
              <div className="project-menu-header">Projects</div>
              {projects.map((p) => (
                <div
                  key={p.name}
                  className={`project-menu-item ${p.name === activeProject ? "active" : ""}`}
                >
                  <button
                    type="button"
                    className="project-menu-name"
                    onClick={() => {
                      onSwitchProject(p.name);
                      setShowProjectMenu(false);
                    }}
                    disabled={projectBusy}
                  >
                    {p.name}
                    {p.name === activeProject && <span className="project-active-dot" />}
                  </button>
                  <div className="project-menu-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => onExportProject(p.name)}
                      disabled={projectBusy}
                      title="Export"
                    >
                      ↓
                    </button>
                    {p.name !== "default" && (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => onDeleteProject(p.name)}
                        disabled={projectBusy}
                        title="Delete"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div className="project-menu-create">
                <input
                  type="text"
                  placeholder="New project name"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitCreate();
                  }}
                />
                <button
                  type="button"
                  className="primary"
                  onClick={submitCreate}
                  disabled={projectBusy || !newProjectName.trim()}
                >
                  Create
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="breadcrumbs">
          <span className="sep">/</span>
          <span className="current">{currentLabel}</span>
        </div>
        <div className="header-spacer" />
        <button type="button" className="cmdk-trigger" onClick={onOpenCmdk}>
          <Icon.search size={13} />
          <span>Search nodes, findings, commands…</span>
          <span className="cmdk-shortcut">
            <kbd>⌘</kbd>
            <kbd>K</kbd>
          </span>
        </button>
        <span className="status-pill">
          <span className="pulse" />
          {graphStats.nodes} nodes
        </span>
        <button type="button" className="header-btn" title="Notifications" aria-label="Notifications">
          <Icon.bell size={16} />
        </button>
        <div className="avatar">GS</div>
      </header>

      <main className="main panel-enter">{children}</main>
    </div>
  );
};

export default Shell;
