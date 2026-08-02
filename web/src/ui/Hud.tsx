import { useEffect, useRef, useState } from "react";
import {
  Box,
  Clapperboard,
  EyeOff,
  Flag,
  LayoutGrid,
  Maximize,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  RotateCw,
  ScrollText,
  Settings as SettingsIcon,
  Swords,
  Video,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

import type { GameSnapshot, LedgerMove, PieceKind } from "../core/types";
import { ARENA_LOOKS, ARENA_ORDER, type ArenaTheme } from "../scene/arena";
import type { CameraPreset } from "../scene/sceneEngine";
import { Crest, Hourglass, pieceGlyph } from "./Heraldry";
import { MoveLedger } from "./MoveLedger";

interface HudProps {
  snapshot: GameSnapshot;
  muted: boolean;
  fps: number;
  onNewGame: () => void;
  onUndo: () => void;
  onResign: () => void;
  onToggleSound: () => void;
  onFullscreen: () => void;
  onSettings: () => void;
  onCamera: (preset: CameraPreset) => void;
  onFlipCamera: () => void;
  cameraFlipped: boolean;
  tactical: boolean;
  onToggleTactical: () => void;
  arena: ArenaTheme;
  onArena: (theme: ArenaTheme) => void;
  onPreviewMove: (move: LedgerMove | null) => void;
  onTogglePause: () => void;
  onDemoSpeed: (speed: number) => void;
  onDemoLoop: (loop: boolean) => void;
  onDemoRestart: () => void;
  onToggleCinema: () => void;
}

const DEMO_SPEEDS: { label: string; value: number }[] = [
  { label: "0.5×", value: 0.5 },
  { label: "1×", value: 1 },
  { label: "2×", value: 2 },
  { label: "4×", value: 4 },
];

const DIFFICULTY_SHORT: Record<string, string> = {
  easy: "Squire",
  medium: "Knight",
  hard: "Warlord",
};

const CAMERA_BUTTONS: { key: CameraPreset; label: string }[] = [
  { key: "white", label: "Ivory" },
  { key: "black", label: "Obsidian" },
  { key: "top", label: "Overhead" },
  { key: "cinematic", label: "Cinematic" },
];

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function Hud({
  snapshot,
  muted,
  fps,
  onNewGame,
  onUndo,
  onResign,
  onToggleSound,
  onFullscreen,
  onSettings,
  onCamera,
  onFlipCamera,
  cameraFlipped,
  tactical,
  onToggleTactical,
  arena,
  onArena,
  onPreviewMove,
  onTogglePause,
  onDemoSpeed,
  onDemoLoop,
  onDemoRestart,
  onToggleCinema,
}: HudProps) {
  const [chronicleOpen, setChronicleOpen] = useState(false);
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<CameraPreset>(() =>
    snapshot.mode === "ai" && snapshot.playerColor === "b" ? "black" : "white",
  );
  const cameraMenuRef = useRef<HTMLDivElement | null>(null);
  const chronicleRef = useRef<HTMLDivElement | null>(null);

  // Dismiss the camera menu on outside taps / Escape without laying an
  // invisible backdrop over the board (that would eat the next board click).
  useEffect(() => {
    if (!cameraMenuOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      const node = cameraMenuRef.current;
      if (node && !node.contains(event.target as Node)) setCameraMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setCameraMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [cameraMenuOpen]);

  // The chronicle is a corner button by default so the board keeps the whole
  // screen. Escape closes it anywhere; on narrow screens the open panel covers
  // a good part of the board, so a tap outside folds it back down as well.
  useEffect(() => {
    if (!chronicleOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setChronicleOpen(false);
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (window.innerWidth >= 1024) return;
      const node = chronicleRef.current;
      if (node && !node.contains(event.target as Node)) setChronicleOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [chronicleOpen]);

  // "H" toggles the record without reaching for the corner.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "h" && event.key !== "H") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const typing = target ? /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable : false;
      if (typing) return;
      setChronicleOpen((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pickCamera = (preset: CameraPreset): void => {
    setActivePreset(preset);
    setCameraMenuOpen(false);
    onCamera(preset);
  };

  const demo = snapshot.demo;
  const whiteTaken = snapshot.captured.filter((piece) => piece.color === "b");
  const blackTaken = snapshot.captured.filter((piece) => piece.color === "w");
  const diff = snapshot.materialDiff;

  const ledger = (
    <MoveLedger
      moves={snapshot.moves}
      pgn={snapshot.pgn}
      result={snapshot.result}
      turn={snapshot.turn}
      thinking={snapshot.thinking}
      playing={snapshot.status === "playing"}
      onPreview={onPreviewMove}
    />
  );

  const spoils = (
    <div className="mc-slate mc-goldleaf px-4 py-3">
      <div className="flex items-center justify-between">
        <p className="mc-display text-[0.6rem] tracking-[0.34em] text-[#a89268]">Spoils</p>
        <span className="mc-display text-[0.72rem] text-[#e2c98f]">
          {diff === 0 ? "even" : diff > 0 ? `ivory +${diff}` : `obsidian +${-diff}`}
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        <CapturedRow label="w" pieces={whiteTaken.map((piece) => piece.kind)} />
        <CapturedRow label="b" pieces={blackTaken.map((piece) => piece.kind)} />
      </div>
    </div>
  );

  return (
    <>
      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3 sm:p-4">
        <div className="mc-slate mc-goldleaf pointer-events-auto flex items-center gap-3 px-3 py-2.5">
          <Crest faction={snapshot.turn} size={26} active />
          <div>
            <p className="mc-display text-[0.58rem] tracking-[0.3em] text-[#a89268]">
              {demo
                ? `Showcase · duel ${snapshot.demoRound}`
                : snapshot.status === "over"
                  ? "Battle ended"
                  : snapshot.thinking
                    ? "Council of war"
                    : "To move"}
            </p>
            <p className="mc-display text-sm text-[#f2e2bd]">
              {snapshot.status === "over"
                ? "—"
                : snapshot.thinking
                  ? "Thinking…"
                  : snapshot.turn === "w"
                    ? "Ivory"
                    : "Obsidian"}
            </p>
          </div>
          {snapshot.inCheck && snapshot.status === "playing" ? (
            <span className="mc-danger-flash mc-display rounded-sm border border-[#a8342a] px-2 py-1 text-[0.6rem] tracking-[0.24em] text-[#ff9a8a]">
              CHECK
            </span>
          ) : null}
          {snapshot.thinking ? (
            <span className="mc-pulse ml-1 h-2 w-2 rounded-full bg-[#d8b163]" aria-hidden="true" />
          ) : null}
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
          {snapshot.clock.enabled ? (
            <div className="mc-slate flex items-center gap-3 px-3 py-1.5">
              <ClockFace
                ms={snapshot.clock.whiteMs}
                initial={snapshot.clock.initialMs}
                active={snapshot.turn === "w" && snapshot.status === "playing"}
                faction="w"
              />
              <div className="h-6 w-px bg-[#8a652244]" />
              <ClockFace
                ms={snapshot.clock.blackMs}
                initial={snapshot.clock.initialMs}
                active={snapshot.turn === "b" && snapshot.status === "playing"}
                faction="b"
              />
            </div>
          ) : null}

          {demo ? (
            <IconButton title="Hide the interface for recording (C)" onClick={onToggleCinema}>
              <EyeOff size={16} />
            </IconButton>
          ) : (
            <>
              <IconButton title="Undo" onClick={onUndo} disabled={!snapshot.canUndo}>
                <RotateCcw size={16} />
              </IconButton>
              <IconButton title="Resign" onClick={onResign} disabled={snapshot.status !== "playing"} danger>
                <Flag size={16} />
              </IconButton>
            </>
          )}
          <IconButton title="New game" onClick={onNewGame}>
            <Swords size={16} />
          </IconButton>
          <IconButton title={muted ? "Unmute" : "Mute"} onClick={onToggleSound}>
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </IconButton>
          <IconButton title="Fullscreen" onClick={onFullscreen}>
            <Maximize size={16} />
          </IconButton>
          <IconButton title="Flip view 180° (F)" onClick={onFlipCamera} active={cameraFlipped}>
            <Repeat size={16} />
          </IconButton>
          <IconButton
            title={tactical ? "Back to the 3D hall (T)" : "Tactical 2D map — read the whole board (T)"}
            onClick={onToggleTactical}
            active={tactical}
          >
            {tactical ? <Box size={16} /> : <LayoutGrid size={16} />}
          </IconButton>

          {/* Camera views live in a dropdown so nothing floats over the board */}
          <div className="relative" ref={cameraMenuRef}>
            <IconButton
              title="Camera views"
              onClick={() => setCameraMenuOpen((open) => !open)}
              active={cameraMenuOpen}
            >
              <Video size={16} />
            </IconButton>
            {cameraMenuOpen ? (
              <div className="mc-cam-menu mc-slate absolute right-0 top-[calc(100%+0.4rem)] z-30 w-44 p-2">
                <p className="mc-display px-1 pb-1.5 text-[0.52rem] tracking-[0.3em] text-[#a89268]">Camera</p>
                <div className="flex flex-col gap-1">
                  {CAMERA_BUTTONS.map((button) => (
                    <button
                      key={button.key}
                      type="button"
                      className="mc-chip w-full text-left"
                      data-active={!tactical && activePreset === button.key}
                      onClick={() => pickCamera(button.key)}
                    >
                      {button.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="mc-chip flex w-full items-center gap-1.5 text-left"
                    data-active={tactical}
                    onClick={() => {
                      setCameraMenuOpen(false);
                      onToggleTactical();
                    }}
                    title="Flat overhead map — no figures in the way (T)"
                    aria-pressed={tactical}
                  >
                    <LayoutGrid size={13} />
                    Tactical 2D
                  </button>
                  <div className="mc-rule my-1 opacity-60" />
                  <button
                    type="button"
                    className="mc-chip mc-chip-flip flex w-full items-center gap-1.5"
                    data-active={cameraFlipped}
                    onClick={onFlipCamera}
                    title="Swing the camera to the opposite side (F)"
                    aria-pressed={cameraFlipped}
                  >
                    <Repeat
                      size={13}
                      className="mc-flip-icon"
                      style={{ transform: cameraFlipped ? "rotate(180deg)" : "none" }}
                    />
                    Flip 180°
                  </button>
                </div>

                <p className="mc-display px-1 pb-1.5 pt-3 text-[0.52rem] tracking-[0.3em] text-[#a89268]">
                  Battleground
                </p>
                <div className="flex flex-col gap-1">
                  {ARENA_ORDER.map((theme) => (
                    <button
                      key={theme}
                      type="button"
                      className="mc-chip flex w-full items-center gap-2 text-left"
                      data-active={arena === theme}
                      onClick={() => onArena(theme)}
                      title={ARENA_LOOKS[theme].note}
                    >
                      <span className="mc-arena-dot" data-arena={theme} />
                      {ARENA_LOOKS[theme].label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <IconButton title="Settings" onClick={onSettings}>
            <SettingsIcon size={16} />
          </IconButton>
        </div>
      </div>

      {/* Spoils tucks under the top bar on desktop — it is short and clear of
          the board. */}
      <div className="mc-rise pointer-events-auto absolute right-4 top-24 hidden w-56 lg:block xl:w-60">{spoils}</div>

      {/* Chronicle: a small corner sigil that unfurls the record on demand. The
          wrapper stays click-through so the board keeps every tap that is not
          aimed at the button or the open panel. */}
      <div
        ref={chronicleRef}
        className="pointer-events-none absolute bottom-0 left-0 z-30 flex flex-col items-start gap-2 p-3 sm:p-4"
      >
        {chronicleOpen ? (
          <div className="mc-chronicle-panel pointer-events-auto flex h-[min(56vh,460px)] w-[min(84vw,18.5rem)] flex-col gap-2 lg:w-64">
            <div className="min-h-0 flex-1">{ledger}</div>
            <div className="lg:hidden">{spoils}</div>
          </div>
        ) : null}

        <button
          type="button"
          className="mc-chronicle-fab pointer-events-auto"
          data-open={chronicleOpen || undefined}
          onClick={() => setChronicleOpen((open) => !open)}
          title={chronicleOpen ? "Close the chronicle (H)" : "Chronicle — move record (H)"}
          aria-label="Toggle the move chronicle"
          aria-expanded={chronicleOpen}
        >
          {chronicleOpen ? <X size={16} /> : <ScrollText size={16} />}
          {!chronicleOpen && snapshot.moves.length > 0 ? (
            <span key={snapshot.moves.length} className="mc-chronicle-badge">
              {snapshot.moves.length}
            </span>
          ) : null}
        </button>
      </div>

      {/* Showcase transport — small, centred at the foot of the screen so it
          never covers a rank of the board. */}
      {demo ? (
        <div className="mc-demo-bar pointer-events-auto">
          <button
            type="button"
            className="mc-demo-play"
            onClick={onTogglePause}
            title={snapshot.paused ? "Resume the showcase (Space)" : "Pause the showcase (Space)"}
            aria-label={snapshot.paused ? "Resume the showcase" : "Pause the showcase"}
          >
            {snapshot.paused ? <Play size={15} /> : <Pause size={15} />}
          </button>

          <div className="mc-demo-sep" />

          <div className="flex items-center gap-1">
            {DEMO_SPEEDS.map((option) => (
              <button
                key={option.label}
                type="button"
                className="mc-chip mc-demo-speed"
                data-active={demo.speed === option.value}
                onClick={() => onDemoSpeed(option.value)}
                title={`Play at ${option.label}`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="mc-demo-sep" />

          <button
            type="button"
            className="mc-chip mc-demo-speed flex items-center gap-1.5"
            data-active={demo.autoRematch}
            onClick={() => onDemoLoop(!demo.autoRematch)}
            title="Start a fresh duel when this one ends"
            aria-pressed={demo.autoRematch}
          >
            <Repeat size={12} /> loop
          </button>
          <button
            type="button"
            className="mc-chip mc-demo-speed flex items-center gap-1.5"
            onClick={onDemoRestart}
            title="Restart the duel now"
          >
            <RotateCw size={12} /> new duel
          </button>

          <div className="mc-demo-sep hidden sm:block" />

          <span className="mc-display hidden items-center gap-1.5 text-[0.58rem] tracking-[0.22em] text-[#a89268] sm:flex">
            <Clapperboard size={12} />
            {DIFFICULTY_SHORT[demo.white] ?? demo.white} vs {DIFFICULTY_SHORT[demo.black] ?? demo.black}
          </span>

          {snapshot.paused ? <span className="mc-demo-flag mc-pulse">PAUSED</span> : null}
          {snapshot.status === "over" && demo.autoRematch ? (
            <span className="mc-demo-flag mc-pulse">NEXT DUEL…</span>
          ) : null}
        </div>
      ) : null}

      {fps > 0 ? (
        <span className="pointer-events-none absolute bottom-2 right-3 hidden text-[0.62rem] tracking-widest text-[#5f5747] lg:block">
          {fps} FPS
        </span>
      ) : null}
    </>
  );
}

function CapturedRow({ label, pieces }: { label: "w" | "b"; pieces: PieceKind[] }) {
  return (
    <div className="flex items-center gap-2">
      <Crest faction={label} size={14} />
      <div className="flex flex-wrap gap-0.5 text-lg leading-none" style={{ color: label === "w" ? "#f0e3c6" : "#b9838a" }}>
        {pieces.length === 0 ? <span className="text-xs italic text-[#7d6f57]">—</span> : null}
        {pieces.map((kind, index) => (
          <span key={`${kind}-${index}`}>{pieceGlyph(kind)}</span>
        ))}
      </div>
    </div>
  );
}

function ClockFace({
  ms,
  initial,
  active,
  faction,
}: {
  ms: number;
  initial: number;
  active: boolean;
  faction: "w" | "b";
}) {
  const urgent = ms < 30_000;
  return (
    <div className="flex items-center gap-1.5" style={{ opacity: active ? 1 : 0.55 }}>
      <Hourglass ratio={initial > 0 ? ms / initial : 0} urgent={urgent} />
      <div>
        <p className="mc-display text-[0.5rem] tracking-[0.2em] text-[#a89268]">{faction === "w" ? "IVORY" : "OBSIDIAN"}</p>
        <p className={`mc-display text-sm ${urgent ? "text-[#ff8f7d]" : "text-[#f2e2bd]"}`}>{formatClock(ms)}</p>
      </div>
    </div>
  );
}

function IconButton({
  children,
  title,
  onClick,
  disabled,
  danger,
  active,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      data-active={active ? "true" : undefined}
      className={`mc-btn mc-icon-btn ${danger ? "mc-btn-danger" : ""}`}
    >
      {children}
    </button>
  );
}
