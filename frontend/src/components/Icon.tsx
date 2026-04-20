import React from "react";

export type IconProps = {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
};

type IconFC = React.FC<IconProps>;

// Wrapper for consistent stroked icons (24x24 grid, 1.5 stroke)
const I: React.FC<IconProps & { children: React.ReactNode }> = ({
  size = 16,
  className,
  style,
  children,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    className={className}
    style={style}
  >
    {children}
  </svg>
);

export const Icon: Record<string, IconFC> = {
  graph: (p) => (
    <I {...p}>
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="12" cy="18" r="2" />
      <path d="M7 7l4 9M17 7l-4 9M7 6h10" />
    </I>
  ),
  sitemap: (p) => (
    <I {...p}>
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <rect x="3" y="15" width="6" height="4" rx="1" />
      <rect x="15" y="15" width="6" height="4" rx="1" />
      <path d="M12 7v4M12 11H6v4M12 11h6v4" />
    </I>
  ),
  intel: (p) => (
    <I {...p}>
      <path d="M3 3v18h18" />
      <path d="M7 14l3-4 3 3 5-6" />
    </I>
  ),
  ops: (p) => (
    <I {...p}>
      <path d="M4 4h4v4H4zM10 4h4v4h-4zM16 4h4v4h-4zM4 10h4v10H4zM10 14h4v6h-4zM16 10h4v10h-4z" />
    </I>
  ),
  scan: (p) => (
    <I {...p}>
      <path d="M4 4h4M20 4h-4M4 20h4M20 20h-4M4 4v4M20 4v4M4 20v-4M20 20v-4" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 8v8" />
    </I>
  ),
  settings: (p) => (
    <I {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </I>
  ),
  finding: (p) => (
    <I {...p}>
      <path d="M12 2l10 5v5c0 5-4 9-10 10-6-1-10-5-10-10V7z" />
      <path d="M12 8v4M12 16h0" />
    </I>
  ),
  search: (p) => (
    <I {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4.3-4.3" />
    </I>
  ),
  plus: (p) => (
    <I {...p}>
      <path d="M12 5v14M5 12h14" />
    </I>
  ),
  play: (p) => (
    <I {...p}>
      <path d="M6 4l14 8-14 8V4z" fill="currentColor" />
    </I>
  ),
  pause: (p) => (
    <I {...p}>
      <rect x="6" y="5" width="4" height="14" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" fill="currentColor" />
    </I>
  ),
  stop: (p) => (
    <I {...p}>
      <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />
    </I>
  ),
  refresh: (p) => (
    <I {...p}>
      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5" />
    </I>
  ),
  filter: (p) => (
    <I {...p}>
      <path d="M3 4h18l-7 10v5l-4 2v-7z" />
    </I>
  ),
  target: (p) => (
    <I {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </I>
  ),
  threads: (p) => (
    <I {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v6M12 15v6M3 12h6M15 12h6M5.6 5.6l4.2 4.2M14.2 14.2l4.2 4.2M5.6 18.4l4.2-4.2M14.2 9.8l4.2-4.2" />
    </I>
  ),
  close: (p) => (
    <I {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </I>
  ),
  chevron: (p) => (
    <I {...p}>
      <path d="m6 9 6 6 6-6" />
    </I>
  ),
  chevronR: (p) => (
    <I {...p}>
      <path d="m9 6 6 6-6 6" />
    </I>
  ),
  logout: (p) => (
    <I {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </I>
  ),
  bell: (p) => (
    <I {...p}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </I>
  ),
  zoomIn: (p) => (
    <I {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4.3-4.3M11 8v6M8 11h6" />
    </I>
  ),
  zoomOut: (p) => (
    <I {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4.3-4.3M8 11h6" />
    </I>
  ),
  fit: (p) => (
    <I {...p}>
      <path d="M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5" />
    </I>
  ),
  center: (p) => (
    <I {...p}>
      <circle cx="12" cy="12" r="2" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </I>
  ),
  link: (p) => (
    <I {...p}>
      <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </I>
  ),
  export: (p) => (
    <I {...p}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5-5 5 5M12 5v12" />
    </I>
  ),
  upload: (p) => (
    <I {...p}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
    </I>
  ),
  path: (p) => (
    <I {...p}>
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="5" r="2" />
      <path d="M6.4 17.6 17.6 6.4" strokeDasharray="2 3" />
    </I>
  ),
  save: (p) => (
    <I {...p}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </I>
  ),
  note: (p) => (
    <I {...p}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5" />
    </I>
  ),
  terminal: (p) => (
    <I {...p}>
      <path d="m5 8 4 4-4 4M11 16h8" />
      <rect x="2" y="4" width="20" height="16" rx="2" />
    </I>
  ),
  keyboard: (p) => (
    <I {...p}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12" />
    </I>
  ),
};
