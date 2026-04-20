import React from "react";
import { Icon } from "./Icon";

export type Density = "compact" | "comfortable" | "roomy";
export type GraphNodeStyle = "glyph" | "geometric";
export type EdgeStyle = "curved" | "straight";
export type MonoFont = "IBM Plex Mono" | "JetBrains Mono" | "ui-monospace";

export type TweaksState = {
  accentHue: number;
  density: Density;
  graphNodeStyle: GraphNodeStyle;
  edgeStyle: EdgeStyle;
  showThreads: boolean;
  mono: MonoFont;
};

export const TWEAK_DEFAULTS: TweaksState = {
  accentHue: 210,
  density: "comfortable",
  graphNodeStyle: "glyph",
  edgeStyle: "curved",
  showThreads: true,
  mono: "IBM Plex Mono",
};

export type TweaksPanelProps = {
  tweaks: TweaksState;
  setTweak: <K extends keyof TweaksState>(key: K, value: TweaksState[K]) => void;
  onClose: () => void;
};

const TweaksPanel: React.FC<TweaksPanelProps> = ({ tweaks, setTweak, onClose }) => {
  return (
    <div className="tweaks-panel">
      <div className="tweaks-head">
        <span>Tweaks</span>
        <button type="button" className="close" onClick={onClose} aria-label="Close tweaks">
          <Icon.close size={14} />
        </button>
      </div>
      <div className="tweaks-body">
        <div className="tweak-group">
          <div className="tweak-lbl">
            <span>Accent hue</span>
            <span className="val">{tweaks.accentHue}°</span>
          </div>
          <div
            className="hue-slider"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = (e.clientX - rect.left) / rect.width;
              setTweak("accentHue", Math.round(x * 360));
            }}
          >
            <div
              className="hue-thumb"
              style={{ left: (tweaks.accentHue / 360) * 100 + "%" }}
            />
          </div>
        </div>

        <div className="tweak-group">
          <div className="tweak-lbl">
            <span>Density</span>
          </div>
          <div className="tweak-segs">
            {(["compact", "comfortable", "roomy"] as Density[]).map((d) => (
              <button
                key={d}
                type="button"
                className={`tweak-seg ${tweaks.density === d ? "on" : ""}`}
                onClick={() => setTweak("density", d)}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div className="tweak-group">
          <div className="tweak-lbl">
            <span>Graph nodes</span>
          </div>
          <div className="tweak-segs">
            {(["glyph", "geometric"] as GraphNodeStyle[]).map((d) => (
              <button
                key={d}
                type="button"
                className={`tweak-seg ${tweaks.graphNodeStyle === d ? "on" : ""}`}
                onClick={() => setTweak("graphNodeStyle", d)}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div className="tweak-group">
          <div className="tweak-lbl">
            <span>Edges</span>
          </div>
          <div className="tweak-segs">
            {(["curved", "straight"] as EdgeStyle[]).map((d) => (
              <button
                key={d}
                type="button"
                className={`tweak-seg ${tweaks.edgeStyle === d ? "on" : ""}`}
                onClick={() => setTweak("edgeStyle", d)}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div className="tweak-group">
          <div className="tweak-lbl">
            <span>Background threads</span>
          </div>
          <div className="tweak-segs">
            <button
              type="button"
              className={`tweak-seg ${tweaks.showThreads ? "on" : ""}`}
              onClick={() => setTweak("showThreads", true)}
            >
              on
            </button>
            <button
              type="button"
              className={`tweak-seg ${!tweaks.showThreads ? "on" : ""}`}
              onClick={() => setTweak("showThreads", false)}
            >
              off
            </button>
          </div>
        </div>

        <div className="tweak-group">
          <div className="tweak-lbl">
            <span>Monospace</span>
          </div>
          <div className="tweak-segs">
            {(["IBM Plex Mono", "JetBrains Mono", "ui-monospace"] as MonoFont[]).map((d) => (
              <button
                key={d}
                type="button"
                className={`tweak-seg ${tweaks.mono === d ? "on" : ""}`}
                onClick={() => setTweak("mono", d)}
              >
                {d.split(" ")[0]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TweaksPanel;
