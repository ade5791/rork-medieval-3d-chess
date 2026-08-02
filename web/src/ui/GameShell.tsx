import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { audio } from "../audio/audioManager";
import { GameController } from "../core/gameController";
import type { LedgerMove } from "../core/types";
import { Clapperboard } from "lucide-react";
import { ARENA_LOOKS, DEFAULT_ARENA, type ArenaTheme } from "../scene/arena";
import { detectQualityPreset, type QualityPreset } from "../scene/quality";
import { SceneEngine, type CameraPreset } from "../scene/sceneEngine";
import { GameOverModal } from "./GameOverModal";
import { Hud } from "./Hud";
import { MainMenu, type MatchConfig } from "./MainMenu";
import { SettingsPanel, type GameSettings } from "./SettingsPanel";
import { useGameSnapshot } from "./useGameSnapshot";
import "./medieval.css";

type Phase = "loading" | "menu" | "playing";

const ATTRACT_DELAY_MS = 30_000;

export function GameShell() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SceneEngine | null>(null);
  const attractTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const controller = useMemo(() => new GameController(), []);
  const snapshot = useGameSnapshot(controller);

  const detected = useMemo<QualityPreset>(() => detectQualityPreset(), []);
  const [settings, setSettings] = useState<GameSettings>(() => ({
    quality: detected,
    arena: DEFAULT_ARENA,
    captureCinematics: true,
    rotateBoard: true,
    rankBadges: true,
    muted: false,
  }));

  const [phase, setPhase] = useState<Phase>("loading");
  const [progress, setProgress] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [introPlaying, setIntroPlaying] = useState(false);
  const [attract, setAttract] = useState(false);
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [fps, setFps] = useState(0);
  const [contextLost, setContextLost] = useState(false);
  const [cameraFlipped, setCameraFlipped] = useState(false);
  /** Flat overhead map: no 3D figure can hide a square. */
  const [tactical, setTactical] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** Showcase recording: strips every panel so the capture is board-only. */
  const [cinema, setCinema] = useState(false);

  // ------------------------------------------------------------ boot the scene
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Headless/blocked environments cannot create a WebGL context — fail loudly
    // with a readable message instead of a black screen.
    const probe = document.createElement("canvas");
    const supported = Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
    if (!supported) {
      setUnsupported(true);
      return;
    }

    let engine: SceneEngine;
    try {
      engine = new SceneEngine(
        canvas,
        controller,
        {
          onLoadProgress: (ratio) => setProgress(ratio),
          onReady: () => setPhase("menu"),
          onPromotionOpen: (open) => setPromotionOpen(open),
          onQualityAdjusted: (preset) => {
            setSettings((current) => ({ ...current, quality: preset }));
            setNotice(`Graphics stepped down to ${preset} to hold a smooth frame rate.`);
            setTimeout(() => setNotice(null), 5000);
          },
          onFps: (value) => setFps(value),
          onContextLost: () => setContextLost(true),
          onCameraFlipped: (flipped) => setCameraFlipped(flipped),
          onTacticalView: (active) => setTactical(active),
        },
        detected,
        DEFAULT_ARENA,
      );
    } catch (error) {
      console.error("[ui] could not start the renderer", error);
      setUnsupported(true);
      return;
    }

    engineRef.current = engine;
    engine.setInteractive(false);
    engine.start();

    void engine.load().then(async () => {
      setIntroPlaying(true);
      await engine.playIntro();
      setIntroPlaying(false);
    });

    return () => {
      engineRef.current = null;
      engine.dispose();
    };
  }, [controller, detected]);

  useEffect(() => () => controller.dispose(), [controller]);

  // ----------------------------------------------------- audio unlock on input
  useEffect(() => {
    const unlock = (): void => {
      void audio.unlock();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // ----------------------------------------------------------- apply settings
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setQuality(settings.quality);
    engine.setArena(settings.arena);
    engine.setCaptureCinematics(settings.captureCinematics);
    engine.setRotateBoard(settings.rotateBoard);
    engine.setRankBadges(settings.rankBadges);
    audio.setMuted(settings.muted);
  }, [settings]);

  // ------------------------------------------------------------- attract mode
  const stopAttract = useCallback(() => {
    if (attractTimer.current) {
      clearTimeout(attractTimer.current);
      attractTimer.current = null;
    }
    if (!attract) return;
    setAttract(false);
    controller.stop();
    engineRef.current?.setAttract(false);
    engineRef.current?.resync();
  }, [attract, controller]);

  const scheduleAttract = useCallback(() => {
    if (attractTimer.current) clearTimeout(attractTimer.current);
    attractTimer.current = setTimeout(() => {
      if (phase !== "menu" || showSettings) return;
      setAttract(true);
      engineRef.current?.setAttract(true);
      controller.start({ mode: "attract", difficulty: "medium", playerColor: "w", clockMinutes: null });
    }, ATTRACT_DELAY_MS);
  }, [controller, phase, showSettings]);

  useEffect(() => {
    if (phase !== "menu" || attract || introPlaying) return;
    scheduleAttract();
    return () => {
      if (attractTimer.current) clearTimeout(attractTimer.current);
    };
  }, [phase, attract, introPlaying, scheduleAttract]);

  // ------------------------------------------------------------------ actions
  const startMatch = useCallback(
    (config: MatchConfig) => {
      stopAttract();
      void audio.unlock();
      audio.blip("press");
      const engine = engineRef.current;
      const showcase = config.mode === "demo";
      engine?.setAttract(false);
      engine?.setInteractive(true);
      engine?.setShowcase(showcase);
      engine?.setCameraPreset(
        showcase ? "cinematic" : config.mode === "ai" && config.playerColor === "b" ? "black" : "white",
      );
      controller.start({
        mode: config.mode,
        difficulty: config.difficulty,
        playerColor: config.playerColor,
        clockMinutes: config.clockMinutes,
        demo: config.demo,
      });
      setPhase("playing");
    },
    [controller, stopAttract],
  );

  const returnToMenu = useCallback(() => {
    controller.stop();
    const engine = engineRef.current;
    engine?.setTacticalView(false);
    engine?.setInteractive(false);
    engine?.setShowcase(false);
    engine?.setCameraPreset("cinematic");
    setCinema(false);
    setPhase("menu");
  }, [controller]);

  // -------------------------------------------------------- showcase controls
  const handleTogglePause = useCallback(() => {
    audio.blip("press");
    controller.togglePaused();
  }, [controller]);

  const handleDemoSpeed = useCallback(
    (speed: number) => {
      audio.blip("press");
      controller.setDemoSpeed(speed);
    },
    [controller],
  );

  const handleDemoLoop = useCallback(
    (loop: boolean) => {
      audio.blip("press");
      controller.setDemoAutoRematch(loop);
    },
    [controller],
  );

  const handleDemoRestart = useCallback(() => {
    audio.blip("press");
    engineRef.current?.setCameraPreset("cinematic");
    controller.restartDemo();
  }, [controller]);

  const handleUndo = useCallback(() => {
    if (controller.undo()) {
      audio.blip("press");
      engineRef.current?.resync();
    } else {
      audio.blip("deny");
    }
  }, [controller]);

  const handleResign = useCallback(() => {
    audio.blip("deny");
    controller.resign();
  }, [controller]);

  const handleRematch = useCallback(() => {
    const current = controller.getSnapshot();
    startMatch({
      mode: current.mode === "hotseat" ? "hotseat" : "ai",
      difficulty: current.difficulty,
      playerColor: current.playerColor,
      clockMinutes: current.clock.enabled ? current.clock.initialMs / 60_000 : null,
    });
  }, [controller, startMatch]);

  const handleFullscreen = useCallback(() => {
    const element = document.documentElement;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void element.requestFullscreen().catch((error) => console.warn("[ui] fullscreen refused", error));
  }, []);

  const handleCamera = useCallback((preset: CameraPreset) => {
    audio.blip("press");
    engineRef.current?.setCameraPreset(preset);
  }, []);

  const handleFlipCamera = useCallback(() => {
    audio.blip("press");
    engineRef.current?.flipCamera();
  }, []);

  const handleToggleTactical = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    audio.blip("press");
    engine.setTacticalView(!engine.isTacticalView());
  }, []);

  const handleArena = useCallback((theme: ArenaTheme) => {
    audio.blip("press");
    setSettings((current) => (current.arena === theme ? current : { ...current, arena: theme }));
  }, []);

  const handlePreviewMove = useCallback((move: LedgerMove | null) => {
    engineRef.current?.previewMove(move ? { from: move.from, to: move.to } : null);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setShowSettings(false);
      const target = event.target as HTMLElement | null;
      const typing = target ? /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable : false;
      if (typing || event.metaKey || event.ctrlKey || event.altKey || phase !== "playing") return;
      if (event.key === "f" || event.key === "F") handleFlipCamera();
      if (event.key === "t" || event.key === "T") handleToggleTactical();
      if (event.key === "c" || event.key === "C") setCinema((hidden) => !hidden);
      if (event.key === " " && snapshot.mode === "demo") {
        event.preventDefault();
        controller.togglePaused();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controller, handleFlipCamera, handleToggleTactical, phase, snapshot.mode]);

  const skipIntro = useCallback(() => {
    engineRef.current?.skipIntro();
  }, []);

  return (
    <div
      className="mc-root fixed inset-0 select-none overflow-hidden bg-[#05060a]"
      data-arena={settings.arena}
      style={{ "--mc-vignette": ARENA_LOOKS[settings.arena].screenVignette } as CSSProperties}
    >
      <div className="mc-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
      <div className="mc-vignette" />

      {/* Overlay layer */}
      <div className="pointer-events-none absolute inset-0">
        {phase === "loading" && !unsupported ? <LoadingScreen progress={progress} /> : null}

        {unsupported ? (
          <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center px-6 text-center">
            <div className="mc-slate mc-goldleaf max-w-sm p-6">
              <h2 className="mc-display text-lg text-[#f2e2bd]">The hall needs WebGL</h2>
              <p className="mt-2 text-sm text-[#b7a88a]">
                This browser or preview surface cannot open a 3D context. Open the game in a desktop or tablet browser
                with hardware acceleration enabled.
              </p>
            </div>
          </div>
        ) : null}

        {phase === "menu" && !introPlaying ? (
          <MainMenu
            onStart={startMatch}
            onOpenSettings={() => setShowSettings(true)}
            attract={attract}
            onInteract={stopAttract}
          />
        ) : null}

        {phase === "playing" && !cinema ? (
          <Hud
            snapshot={snapshot}
            muted={settings.muted}
            fps={fps}
            onNewGame={returnToMenu}
            onUndo={handleUndo}
            onResign={handleResign}
            onToggleSound={() => setSettings((current) => ({ ...current, muted: !current.muted }))}
            onFullscreen={handleFullscreen}
            onSettings={() => setShowSettings(true)}
            onCamera={handleCamera}
            onFlipCamera={handleFlipCamera}
            cameraFlipped={cameraFlipped}
            tactical={tactical}
            onToggleTactical={handleToggleTactical}
            arena={settings.arena}
            onArena={handleArena}
            onPreviewMove={handlePreviewMove}
            onTogglePause={handleTogglePause}
            onDemoSpeed={handleDemoSpeed}
            onDemoLoop={handleDemoLoop}
            onDemoRestart={handleDemoRestart}
            onToggleCinema={() => setCinema(true)}
          />
        ) : null}

        {phase === "playing" && cinema ? (
          <button
            type="button"
            className="mc-cinema-restore pointer-events-auto"
            onClick={() => setCinema(false)}
            title="Show the interface again (C)"
            aria-label="Show the interface again"
          >
            <Clapperboard size={15} />
          </button>
        ) : null}

        {promotionOpen ? (
          <div className="mc-fade pointer-events-none absolute inset-x-0 top-1/2 flex justify-center">
            <p className="mc-display mc-slate px-4 py-2 text-xs tracking-[0.28em] text-[#f0dfb6]">
              CHOOSE THE NEW CHAMPION
            </p>
          </div>
        ) : null}

        {introPlaying ? (
          <button
            type="button"
            onClick={skipIntro}
            className="pointer-events-auto absolute inset-0 flex cursor-pointer items-end justify-center bg-transparent pb-10"
          >
            <span className="mc-display mc-pulse text-[0.68rem] tracking-[0.4em] text-[#c8ab74]">CLICK TO SKIP</span>
          </button>
        ) : null}

        {showSettings ? (
          <SettingsPanel
            settings={settings}
            autoDetected={detected}
            fps={fps}
            onChange={setSettings}
            onClose={() => setShowSettings(false)}
          />
        ) : null}

        {phase === "playing" && !cinema && snapshot.status === "over" && snapshot.result && !snapshot.demo?.autoRematch ? (
          <GameOverModal
            result={snapshot.result}
            pgn={snapshot.pgn}
            playerColor={snapshot.playerColor}
            versusComputer={snapshot.mode === "ai"}
            onRematch={handleRematch}
            onMenu={returnToMenu}
          />
        ) : null}

        {notice ? (
          <div className="mc-fade mc-slate pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 text-xs text-[#e4d3ac]">
            {notice}
          </div>
        ) : null}

        {contextLost ? (
          <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/80 px-6 text-center">
            <div className="mc-slate mc-goldleaf max-w-sm p-6">
              <h2 className="mc-display text-lg text-[#f2e2bd]">The hall went dark</h2>
              <p className="mt-2 text-sm text-[#b7a88a]">
                The graphics context was lost. Reload to relight the torches.
              </p>
              <button type="button" className="mc-btn mc-btn-primary mt-4 w-full" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LoadingScreen({ progress }: { progress: number }) {
  return (
    <div className="mc-fade absolute inset-0 flex flex-col items-center justify-center gap-5 bg-[#05060a]/85 px-6">
      <p className="mc-display text-[0.62rem] tracking-[0.5em] text-[#a89268]">MUSTERING THE ARMIES</p>
      <h1 className="mc-display mc-title-glow text-4xl text-[#f4e3bd]">KING&apos;S GAMBIT</h1>
      <div className="h-[3px] w-64 overflow-hidden rounded-full bg-[#2a251c]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#8a6522] via-[#f6dfa5] to-[#8a6522] transition-[width] duration-300"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <p className="text-xs italic text-[#7d6f57]">Carving {Math.round(progress * 6)} of 6 figures…</p>
    </div>
  );
}
