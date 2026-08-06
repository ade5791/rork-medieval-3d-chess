// Applies the user-quality-pin fix with byte-exact anchored replacements.
// Each anchor must match EXACTLY ONCE or the script aborts without writing.
import fs from "node:fs";

let failures = 0;

function patch(file, edits) {
  let src = fs.readFileSync(file, "utf8");
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  for (const [name, find, replace] of edits) {
    const f = find.split("\n").join(eol);
    const r = replace.split("\n").join(eol);
    const first = src.indexOf(f);
    const last = src.lastIndexOf(f);
    if (first === -1) {
      console.error("MISS  " + file + " :: " + name);
      failures += 1;
      continue;
    }
    if (first !== last) {
      console.error("MULTI " + file + " :: " + name);
      failures += 1;
      continue;
    }
    src = src.slice(0, first) + r + src.slice(first + f.length);
    console.log("OK    " + file + " :: " + name);
  }
  if (failures === 0) fs.writeFileSync(file, src);
  return src;
}

// ---------------------------------------------------------------- sceneEngine
patch("src/scene/sceneEngine.ts", [
  [
    "field",
    "  private fpsSamples: number[] = [];\n  private autoAdjusted = false;\n  private lastFpsReport = 0;",
    "  private fpsSamples: number[] = [];\n  private autoAdjusted = false;\n  /**\n   * True once the player explicitly picked a preset in the Settings menu. The\n   * adaptive guard exists to correct the boot-time GUESS (detectQualityPreset),\n   * not to overrule the player: while pinned the automatic step-down never\n   * fires, whatever the frame rate.\n   */\n  private userQualityPin = false;\n  private lastFpsReport = 0;",
  ],
  [
    "guard",
    "    if (this.review.pinQuality) return;\n    if (this.elapsed < 8",
    "    if (this.review.pinQuality) return;\n    // An explicit Settings choice outranks the guard (see setUserQualityPin).\n    if (this.userQualityPin) return;\n    if (this.elapsed < 8",
  ],
  [
    "setter",
    "  setQuality(preset: QualityPreset): void {\n    if (preset === this.preset) return;",
    "  /**\n   * Marks the active preset as an explicit player choice (or releases it).\n   * While pinned, sampleFps never steps the preset down: the player said so.\n   */\n  setUserQualityPin(pinned: boolean): void {\n    this.userQualityPin = pinned;\n  }\n\n  setQuality(preset: QualityPreset): void {\n    if (preset === this.preset) return;",
  ],
  [
    "probe",
    "      setQuality: (preset: QualityPreset) => this.setQuality(preset),\n      setCamera:",
    "      setQuality: (preset: QualityPreset) => this.setQuality(preset),\n      /** Quality guard state, so QA can assert the user pin actually holds. */\n      qualityGuard: () => ({\n        preset: this.preset,\n        userPin: this.userQualityPin,\n        reviewPin: this.review.pinQuality,\n        autoAdjusted: this.autoAdjusted,\n      }),\n      setCamera:",
  ],
]);

// ------------------------------------------------------------------ GameShell
patch("src/ui/GameShell.tsx", [
  [
    "pin-state",
    "  const [notice, setNotice] = useState<string | null>(null);",
    "  const [notice, setNotice] = useState<string | null>(null);\n  /** Set when the player hand-picks a graphics preset. See handlePickQuality. */\n  const [qualityPinned, setQualityPinned] = useState(false);",
  ],
  [
    "apply-pin",
    "    engine.setQuality(settings.quality);\n    engine.setArena(settings.arena);",
    "    engine.setQuality(settings.quality);\n    engine.setUserQualityPin(qualityPinned);\n    engine.setArena(settings.arena);",
  ],
  [
    "apply-deps",
    "    audio.setMuted(settings.muted);\n  }, [settings]);",
    "    audio.setMuted(settings.muted);\n  }, [settings, qualityPinned]);",
  ],
  [
    "handlers",
    "  // ------------------------------------------------------------- attract mode",
    "  // ------------------------------------------------ manual graphics choice\n  /**\n   * Any click on a Graphics chip is an explicit choice, so it pins the preset\n   * and disarms the adaptive step-down. The step-down path itself updates\n   * settings via setSettings directly and therefore never pins - first-load\n   * auto-detection keeps its guard, a hand-picked preset does not.\n   */\n  const handlePickQuality = useCallback((preset: QualityPreset) => {\n    setQualityPinned(true);\n    setSettings((current) =>\n      current.quality === preset ? current : { ...current, quality: preset },\n    );\n    setNotice(`Graphics locked to ${preset} - automatic step-down is off.`);\n    setTimeout(() => setNotice(null), 5000);\n  }, []);\n\n  /** Back to the boot-time guess with the adaptive guard re-armed. */\n  const resetQualityAuto = useCallback(() => {\n    setQualityPinned(false);\n    setSettings((current) =>\n      current.quality === detected ? current : { ...current, quality: detected },\n    );\n    setNotice(\"Graphics back on auto - steps down if the frame rate drops.\");\n    setTimeout(() => setNotice(null), 5000);\n  }, [detected]);\n\n  // ------------------------------------------------------------- attract mode",
  ],
  [
    "panel-props",
    "          <SettingsPanel\n            settings={settings}\n            autoDetected={detected}\n            fps={fps}\n            onChange={setSettings}\n            onClose={() => setShowSettings(false)}\n          />",
    "          <SettingsPanel\n            settings={settings}\n            autoDetected={detected}\n            fps={fps}\n            qualityPinned={qualityPinned}\n            onChange={setSettings}\n            onPickQuality={handlePickQuality}\n            onResetQualityAuto={resetQualityAuto}\n            onClose={() => setShowSettings(false)}\n          />",
  ],
]);

// -------------------------------------------------------------- SettingsPanel
patch("src/ui/SettingsPanel.tsx", [
  [
    "props",
    "interface SettingsPanelProps {\n  settings: GameSettings;\n  autoDetected: QualityPreset;\n  fps: number;\n  onChange: (settings: GameSettings) => void;\n  onClose: () => void;\n}",
    "interface SettingsPanelProps {\n  settings: GameSettings;\n  autoDetected: QualityPreset;\n  fps: number;\n  /** True when the player pinned a preset by hand (auto step-down disarmed). */\n  qualityPinned: boolean;\n  onChange: (settings: GameSettings) => void;\n  /** Explicit Graphics chip click - pins the preset. */\n  onPickQuality: (preset: QualityPreset) => void;\n  /** Re-arm the adaptive guard and return to the detected preset. */\n  onResetQualityAuto: () => void;\n  onClose: () => void;\n}",
  ],
  [
    "signature",
    "export function SettingsPanel({ settings, autoDetected, fps, onChange, onClose }: SettingsPanelProps) {",
    "export function SettingsPanel({\n  settings,\n  autoDetected,\n  fps,\n  qualityPinned,\n  onChange,\n  onPickQuality,\n  onResetQualityAuto,\n  onClose,\n}: SettingsPanelProps) {",
  ],
  [
    "chip-click",
    "              onClick={() => onChange({ ...settings, quality: preset.key })}",
    "              onClick={() => onPickQuality(preset.key)}",
  ],
  [
    "status-line",
    "        </p>\n\n        <div className=\"mc-rule my-5\" />\n\n        <Toggle",
    "        </p>\n        {qualityPinned ? (\n          <p className=\"mt-1 text-[0.68rem] text-[#c8ab74]\">\n            Locked to your choice - the game will not step it down.{\" \"}\n            <button\n              type=\"button\"\n              className=\"underline decoration-dotted underline-offset-2\"\n              onClick={onResetQualityAuto}\n            >\n              Reset to auto\n            </button>\n          </p>\n        ) : (\n          <p className=\"mt-1 text-[0.68rem] text-[#7d6f57]\">\n            Below 58 FPS the game steps the preset down on its own. Picking a\n            preset yourself turns that off.\n          </p>\n        )}\n\n        <div className=\"mc-rule my-5\" />\n\n        <Toggle",
  ],
]);

if (failures > 0) {
  console.error("ABORTED: " + failures + " anchor(s) failed; no file written.");
  process.exit(1);
}
console.log("All patches applied.");
