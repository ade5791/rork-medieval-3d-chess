import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { audio } from "../audio/audioManager";
import { GameController } from "../core/gameController";
import type { LedgerMove } from "../core/types";
import { Clapperboard } from "lucide-react";
import { ARENA_LOOKS, DEFAULT_ARENA, type ArenaTheme } from "../scene/arena";
import { DEFAULT_ERA, ERAS, type EraId } from "../scene/eras";
import { detectQualityPreset, type QualityPreset } from "../scene/quality";
import { readReviewState } from "../scene/reviewState";
import { SceneEngine, type CameraPreset } from "../scene/sceneEngine";
import { GameOverModal } from "./GameOverModal";
import { Hud } from "./Hud";
import { MainMenu, type MatchConfig } from "./MainMenu";
import { OnlineBridge } from "../net/onlineBridge";
import type { ConnectionStatus } from "../net/onlineClient";
import { normaliseRoomCode } from "../net/protocol";
import { OnlineLobby, type OnlineSession } from "./OnlineLobby";
import { SettingsPanel, type GameSettings } from "./SettingsPanel";
import { useGameSnapshot } from "./useGameSnapshot";
import "./medieval.css";

type Phase = "loading" | "menu" | "lobby" | "playing";

const ATTRACT_DELAY_MS = 30_000;

export function GameShell() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SceneEngine | null>(null);
  const attractTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const controller = useMemo(() => new GameController(), []);
  const snapshot = useGameSnapshot(controller);

  const review = useMemo(() => readReviewState(), []);
  const detected = useMemo<QualityPreset>(
    () => review.quality ?? detectQualityPreset(),
    [review.quality],
  );
  const [settings, setSettings] = useState<GameSettings>(() => ({
    quality: detected,
    era: review.era ?? DEFAULT_ERA,
    // The era names its battleground; an explicit ?arena= still wins.
    arena: review.arena ?? ERAS[review.era ?? DEFAULT_ERA].arena,
    captureCinematics: true,
    rotateBoard: true,
    rankBadges: true,
    muted: false,
  }));

  /**
   * The era the mounted engine was built with. Era changes the piece roster,
   * which the factory resolves once at load time, so this drives a full engine
   * remount rather than a live repaint (unlike arena).
   */
  const eraAtBoot: EraId = settings.era;

  /** Shared invite link: ?room=ABCDE opens the lobby straight onto Join. */
  const invitedRoom = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      const code = new URLSearchParams(window.location.search).get("room");
      if (!code) return null;
      const clean = normaliseRoomCode(code);
      return clean.length === 5 ? clean : null;
    } catch {
      return null;
    }
  }, []);

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
  /** Set when the player hand-picks a graphics preset. See handlePickQuality. */
  const [qualityPinned, setQualityPinned] = useState(false);
  /** Showcase recording: strips every panel so the capture is board-only. */
  const [cinema, setCinema] = useState(false);
  /** Pending staged review move - cleared on unmount so it cannot leak. */
  const stagedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ------------------------------------------------------------------ online
  /** Live online session. Null in every offline mode. */
  const onlineRef = useRef<OnlineSession | null>(null);
  const bridgeRef = useRef<OnlineBridge | null>(null);
  const [online, setOnline] = useState<{ code: string; color: "w" | "b" } | null>(null);
  const [netStatus, setNetStatus] = useState<ConnectionStatus>("idle");

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
        eraAtBoot === DEFAULT_ERA ? DEFAULT_ARENA : ERAS[eraAtBoot].arena,
        eraAtBoot,
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
      // Review capture: no intro, no attract, straight to a staged board so
      // every screenshot of a build lands on the identical frame.
      if (review.review || review.fen) {
        engine.setInteractive(true);
        engine.setCameraPreset("white");
        controller.start({
          mode: "hotseat",
          difficulty: "medium",
          playerColor: "w",
          clockMinutes: null,
          // Deterministic combat review state. The sculpts are in the scene's
          // piece map by this point, so a staged move actually animates -
          // playing it any earlier made animateMove early-return.
          fen: review.fen,
        });
        setPhase("playing");
        // Play the single move this scenario exists to exercise.
        if (review.play) {
          const [from, to] = review.play;
          stagedTimer.current = setTimeout(() => {
            void controller.tryMove(from, to);
          }, 700);
        }
        return;
      }
      if (invitedRoom) {
        // Shared invite link - skip the intro and go straight to the lobby.
        setPhase("lobby");
        return;
      }
      setIntroPlaying(true);
      await engine.playIntro();
      setIntroPlaying(false);
    });

    return () => {
      if (stagedTimer.current) clearTimeout(stagedTimer.current);
      stagedTimer.current = null;
      engineRef.current = null;
      engine.dispose();
    };
  }, [controller, detected, eraAtBoot, review.review, review.fen, review.play, invitedRoom]);

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
    engine.setUserQualityPin(qualityPinned);
    engine.setArena(settings.arena);
    engine.setCaptureCinematics(settings.captureCinematics);
    engine.setRotateBoard(settings.rotateBoard);
    engine.setRankBadges(settings.rankBadges);
    audio.setMuted(settings.muted);
  }, [settings, qualityPinned]);

  // ------------------------------------------------ manual graphics choice
  /**
   * Any click on a Graphics chip is an explicit choice, so it pins the preset
   * and disarms the adaptive step-down. The step-down path itself updates
   * settings via setSettings directly and therefore never pins - first-load
   * auto-detection keeps its guard, a hand-picked preset does not.
   */
  const handlePickQuality = useCallback((preset: QualityPreset) => {
    setQualityPinned(true);
    setSettings((current) =>
      current.quality === preset ? current : { ...current, quality: preset },
    );
    setNotice(`Graphics locked to ${preset} - automatic step-down is off.`);
    setTimeout(() => setNotice(null), 5000);
  }, []);

  /** Back to the boot-time guess with the adaptive guard re-armed. */
  const resetQualityAuto = useCallback(() => {
    setQualityPinned(false);
    setSettings((current) =>
      current.quality === detected ? current : { ...current, quality: detected },
    );
    setNotice("Graphics back on auto - steps down if the frame rate drops.");
    setTimeout(() => setNotice(null), 5000);
  }, [detected]);

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
    // A staged review session must never be taken over by attract mode - it
    // called controller.start() and reset the position mid-scenario.
    if (review.review || review.fen || phase !== "menu" || attract || introPlaying) return;
    if (onlineRef.current) return;
    scheduleAttract();
    return () => {
      if (attractTimer.current) clearTimeout(attractTimer.current);
    };
  }, [phase, attract, introPlaying, scheduleAttract, review.review]);

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

  /** Tears down the online session. Safe to call when there is none. */
  const endOnline = useCallback(() => {
    bridgeRef.current?.dispose();
    bridgeRef.current = null;
    engineRef.current?.setMoveSink(null);
    const session = onlineRef.current;
    onlineRef.current = null;
    if (session) {
      session.client.leave();
      session.client.dispose();
    }
    setOnline(null);
    setNetStatus("idle");
  }, []);

  // A live socket must never outlive the shell. Declared after endOnline so
  // the cleanup closure cannot capture it in its temporal dead zone.
  useEffect(() => () => endOnline(), [endOnline]);

  /** The lobby confirmed a seat - take ownership and start the match. */
  const handleSeated = useCallback(
    (session: OnlineSession) => {
      stopAttract();
      void audio.unlock();
      onlineRef.current = session;
      setOnline({ code: session.code, color: session.color });

      const engine = engineRef.current;
      engine?.setAttract(false);
      engine?.setInteractive(true);
      engine?.setShowcase(false);
      engine?.setCameraPreset(session.color === "b" ? "black" : "white");

      const bridge = new OnlineBridge(session.client, controller, {
        onResync: () => engineRef.current?.resync(),
        onNotice: (text) => {
          setNotice(text);
          setTimeout(() => setNotice(null), 4000);
        },
      });
      bridgeRef.current = bridge;

      // Moves now leave the board and go to the relay; the figure only walks
      // when the server echoes the move back.
      engine?.setMoveSink((from, to, promotion) => bridge.submitMove(from, to, promotion));

      // The client is already connected by the time the shell takes it over,
      // so the initial "status" event has been emitted and missed. Seed from
      // the live value first, then subscribe for subsequent transitions.
      setNetStatus(session.client.getStatus());
      const offStatus = session.client.on("status", ({ status }) => setNetStatus(status));
      session.client.on("failed", ({ fatal, message }) => {
        if (!fatal) return;
        setNotice(message);
        setTimeout(() => setNotice(null), 5000);
      });
      void offStatus;

      setPhase("playing");
    },
    [controller, stopAttract],
  );

  const returnToMenu = useCallback(() => {
    endOnline();
    controller.stop();
    const engine = engineRef.current;
    engine?.setTacticalView(false);
    engine?.setInteractive(false);
    engine?.setShowcase(false);
    engine?.setCameraPreset("cinematic");
    setCinema(false);
    setPhase("menu");
  }, [controller, endOnline]);

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
    // Online: only the relay may end the game, so the local controller is not
    // touched - the authoritative result comes back over the socket.
    if (bridgeRef.current) {
      bridgeRef.current.resign();
      return;
    }
    controller.resign();
  }, [controller]);

  const handleRematch = useCallback(() => {
    if (bridgeRef.current) {
      bridgeRef.current.requestRematch();
      setNotice("Rematch offered - waiting for your opponent.");
      setTimeout(() => setNotice(null), 4000);
      return;
    }
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
        {/* Keyed on the era: dispose() force-loses the old canvas's GL context,
            so a rebooted engine must get a fresh canvas element or renderer
            construction fails and falsely trips the unsupported gate. */}
        <canvas key={eraAtBoot} ref={canvasRef} />
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
                This browser cannot open a 3D (WebGL) context, so the hall cannot be drawn.
              </p>
              <ul className="mt-3 space-y-1 text-left text-xs text-[#b7a88a]">
                <li>Firefox: Settings &gt; General &gt; Performance &gt; enable &quot;Use hardware acceleration&quot;, then restart the browser.</li>
                <li>Firefox: in about:config, make sure webgl.disabled is false.</li>
                <li>Chrome/Edge: Settings &gt; System &gt; enable &quot;Use graphics acceleration&quot;, then relaunch.</li>
                <li>Remote-desktop and some VM sessions block 3D - try directly on the machine.</li>
                <li>Update your graphics driver if the steps above do not help.</li>
              </ul>
            </div>
          </div>
        ) : null}

        {phase === "menu" && !introPlaying ? (
          <MainMenu
            onStart={startMatch}
            onPlayOnline={() => setPhase("lobby")}
            onOpenSettings={() => setShowSettings(true)}
            attract={attract}
            onInteract={stopAttract}
          />
        ) : null}

        {phase === "lobby" ? (
          <OnlineLobby onSeated={handleSeated} onClose={() => setPhase("menu")} />
        ) : null}

        {phase === "playing" && online ? (
          <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2">
            <span className="mc-net" data-state={netStatus}>
              <span className="mc-net-dot" />
              {netStatus === "connected"
                ? `HALL ${online.code}`
                : netStatus === "reconnecting"
                  ? "RECONNECTING"
                  : netStatus === "connecting"
                    ? "CONNECTING"
                    : "OFFLINE"}
            </span>
          </div>
        ) : null}

        {phase === "playing" && online && !snapshot.networkReady && snapshot.status === "playing" ? (
          <div className="mc-fade mc-slate pointer-events-none absolute bottom-32 left-1/2 -translate-x-1/2 px-4 py-2 text-xs italic text-[#e4d3ac]">
            Awaiting your opponent...
          </div>
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
            qualityPinned={qualityPinned}
            onChange={setSettings}
            onPickQuality={handlePickQuality}
            onResetQualityAuto={resetQualityAuto}
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
