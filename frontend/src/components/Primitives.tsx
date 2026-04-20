import React from "react";

export type SparkProps = {
  data: number[];
  color: string;
  height?: number;
  width?: number;
};

export const Spark: React.FC<SparkProps> = ({ data, color, height = 40, width = 180 }) => {
  if (!data || !data.length) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1 || 1);
  const pts = data
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  const areaPts = `0,${height} ${pts} ${width},${height}`;
  return (
    <svg
      className="spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      <polygon points={areaPts} fill={color} opacity="0.1" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
      {data.map((v, i) => {
        const x = i * step;
        const y = height - ((v - min) / range) * (height - 4) - 2;
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={i === data.length - 1 ? 2.5 : 0}
            fill={color}
          />
        );
      })}
    </svg>
  );
};

export type SeverityLevel = "crit" | "high" | "med" | "low" | "info" | string;

export const Severity: React.FC<{ s: SeverityLevel }> = ({ s }) => (
  <span className={`sev-chip ${s}`}>{s}</span>
);

export const Status: React.FC<{ code: number }> = ({ code }) => {
  const cls = "s-" + Math.floor(code / 100) + "xx";
  return <span className={`status-chip ${cls}`}>{code}</span>;
};

export const Method: React.FC<{ m: string }> = ({ m }) => (
  <span className={`method ${m.toLowerCase()}`}>{m}</span>
);

export const Toast: React.FC<{ msg: string | null }> = ({ msg }) => {
  if (!msg) return null;
  return (
    <div className="toast-layer">
      <div className="toast">{msg}</div>
    </div>
  );
};
