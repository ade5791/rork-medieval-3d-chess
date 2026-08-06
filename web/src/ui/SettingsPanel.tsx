import { X } from "lucide-react";

import { ARENA_LOOKS, ARENA_ORDER, type ArenaTheme } from "../scene/arena";
import { ERAS, ERA_ORDER, type EraId } from "../scene/eras";
import type { QualityPreset } from "../scene/quality";

export interface GameSettings {
  quality: QualityPreset;
  /** Historical era - decides the armies and their default battleground. */
  era: EraId;
  /** Which map the board is staged in. */
  arena: ArenaTheme;
  captureCinematics: boolean;
  rotateBoard: boolean;
  /** Floating rank crests over every figure. */
  rankBadges: boolean;
  muted: boolean;
}

interface SettingsPanelProps {
  settings: GameSettings;
  autoDetected: QualityPreset;
  fps: number;
  /** True when the player pinned a preset by hand (auto step-down disarmed). */
  qualityPinned: boolean;
  onChange: (settings: GameSettings) => void;
  /** Explicit Graphics chip click - pins the preset. */
  onPickQuality: (preset: QualityPreset) => void;
  /** Re-arm the adaptive guard and return to the detected preset. */
  onResetQualityAuto: () => void;
  onClose: () => void;
}

const PRESETS: { key: QualityPreset; label: string; note: string }[] = [
  { key: "low", label: "Low", note: "No post-processing, no shadows — runs anywhere" },
  { key: "medium", label: "Medium", note: "Bloom, shadows, light shafts, some dust" },
  { key: "high", label: "High", note: "Adds depth of field, grade, 2K shadows" },
  { key: "ultra", label: "Ultra", note: "Ambient occlusion, 4K shadows, dense particles" },
];

export function SettingsPanel({
  settings,
  autoDetected,
  fps,
  qualityPinned,
  onChange,
  onPickQuality,
  onResetQualityAuto,
  onClose,
}: SettingsPanelProps) {
  return (
    <div className="pointer-events-auto absolute inset-0 z-20 flex flex-col items-center justify-center overflow-hidden bg-black/60 px-5 py-6 backdrop-blur-sm">
      <div className="mc-slate mc-goldleaf mc-rise flex max-h-full w-full min-h-0 max-w-lg flex-col p-5 sm:p-6">
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 className="mc-display text-lg text-[#f2e2bd]">Settings</h2>
          <button type="button" className="mc-btn mc-icon-btn" onClick={onClose} aria-label="Close settings">
            <X size={16} />
          </button>
        </div>

        <div className="mc-scroll mc-scroll-shade -mr-2 min-h-0 flex-auto overflow-y-auto pb-1 pr-2">
        <p className="mc-display mb-2 text-[0.6rem] tracking-[0.3em] text-[#a89268]">Era</p>
        <div className="grid grid-cols-2 gap-2">
          {ERA_ORDER.map((era) => (
            <button
              key={era}
              type="button"
              className="mc-arena-card"
              data-active={settings.era === era}
              title={ERAS[era].note}
              onClick={() =>
                onChange({
                  ...settings,
                  era,
                  // Each era carries its own battleground, so switching period
                  // restages the map too instead of stranding legionaries in
                  // the rainforest.
                  arena: ERAS[era].arena,
                })
              }
            >
              <span className="mc-arena-swatch" data-arena={ERAS[era].arena} />
              <span className="mc-display text-[0.68rem] leading-tight text-[#f0e0be]">{ERAS[era].label}</span>
              <span className="text-[0.6rem] leading-tight text-[#9c8b6c]">{ERAS[era].period}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs italic text-[#9c8b6c]">
          {ERAS[settings.era].armies.w} vs {ERAS[settings.era].armies.b}
        </p>

        <div className="mc-rule my-5" />

        <p className="mc-display mb-2 text-[0.6rem] tracking-[0.3em] text-[#a89268]">Battleground</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ARENA_ORDER.map((theme) => (
            <button
              key={theme}
              type="button"
              className="mc-arena-card"
              data-active={settings.arena === theme}
              onClick={() => onChange({ ...settings, arena: theme })}
            >
              <span className="mc-arena-swatch" data-arena={theme} />
              <span className="mc-display text-[0.68rem] leading-tight text-[#f0e0be]">{ARENA_LOOKS[theme].label}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs italic text-[#9c8b6c]">{ARENA_LOOKS[settings.arena].note}</p>

        <div className="mc-rule my-5" />

        <p className="mc-display mb-2 text-[0.6rem] tracking-[0.3em] text-[#a89268]">Graphics</p>
        <div className="grid grid-cols-4 gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className="mc-chip py-2.5"
              data-active={settings.quality === preset.key}
              onClick={() => onPickQuality(preset.key)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs italic text-[#9c8b6c]">
          {PRESETS.find((preset) => preset.key === settings.quality)?.note}
        </p>
        <p className="mt-1 text-[0.68rem] text-[#7d6f57]">
          Auto-detected on this device: <span className="text-[#c8ab74]">{autoDetected}</span>
          {fps > 0 ? ` · currently ${fps} FPS` : ""}
        </p>
        {qualityPinned ? (
          <p className="mt-1 text-[0.68rem] text-[#c8ab74]">
            Locked to your choice - the game will not step it down.{" "}
            <button
              type="button"
              className="underline decoration-dotted underline-offset-2"
              onClick={onResetQualityAuto}
            >
              Reset to auto
            </button>
          </p>
        ) : (
          <p className="mt-1 text-[0.68rem] text-[#7d6f57]">
            Below 58 FPS the game steps the preset down on its own. Picking a
            preset yourself turns that off.
          </p>
        )}

        <div className="mc-rule my-5" />

        <Toggle
          label="Battle capture cinematics"
          note="Camera punch, strike, sparks and crumble — under 1.5s"
          value={settings.captureCinematics}
          onChange={(value) => onChange({ ...settings, captureCinematics: value })}
        />
        <Toggle
          label="Swing camera between turns"
          note="Two-player hotseat only"
          value={settings.rotateBoard}
          onChange={(value) => onChange({ ...settings, rotateBoard: value })}
        />
        <Toggle
          label="Rank crests above pieces"
          note="Floating shield and sun-disc badges naming every figure"
          value={settings.rankBadges}
          onChange={(value) => onChange({ ...settings, rankBadges: value })}
        />
        <Toggle
          label="Sound"
          note="Score, ambience and effects"
          value={!settings.muted}
          onChange={(value) => onChange({ ...settings, muted: !value })}
        />
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label,
  note,
  value,
  onChange,
}: {
  label: string;
  note: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between gap-4 border-b border-[#8a652222] py-3 text-left last:border-b-0"
      onClick={() => onChange(!value)}
    >
      <span>
        <span className="mc-display block text-[0.78rem] text-[#efe0c0]">{label}</span>
        <span className="text-xs italic text-[#9c8b6c]">{note}</span>
      </span>
      <span
        className="relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200"
        style={{
          background: value ? "linear-gradient(180deg,#d8b163,#8a6522)" : "rgba(20,18,15,0.8)",
          borderColor: value ? "rgba(246,223,165,0.8)" : "rgba(216,177,99,0.3)",
        }}
      >
        <span
          className="absolute top-0.5 h-4.5 w-4.5 rounded-full bg-[#1a1710] transition-all duration-200"
          style={{ left: value ? "1.55rem" : "0.15rem", width: "1.1rem", height: "1.1rem" }}
        />
      </span>
    </button>
  );
}
