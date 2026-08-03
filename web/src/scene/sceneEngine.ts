import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { GameController } from "../core/gameController";
import type { Faction, GameSnapshot, MoveEvent, PieceKind, SquareId } from "../core/types";
import { audio, type FootstepTimbre } from "../audio/audioManager";
import type { ArenaTheme } from "./arena";
import { ARENA_LOOKS, DEFAULT_ARENA } from "./arena";
import { Battlefield } from "./battlefield";
import { JungleOverlay } from "./jungle";
import { BOARD_TOP, BoardView, type HighlightKind, TILE, squareToWorld, worldToSquare } from "./board";
import { CastleHall, buildEnvironmentMap } from "./environment";
import { EffectsSystem, ShakeSystem } from "./effects";
import { FACTION_ACCENT, PieceFactory, PieceView } from "./pieces";
import { PostFX } from "./postfx";
import { QUALITY_SETTINGS, type QualityPreset } from "./quality";
import { Ease, type Easing, TweenManager, wait } from "./tween";

export type CameraPreset = "white" | "black" | "top" | "cinematic";

export interface SceneCallbacks {
  onLoadProgress: (ratio: number) => void;
  onReady: () => void;
  onPromotionOpen: (open: boolean) => void;
  onQualityAdjusted: (preset: QualityPreset) => void;
  onFps: (fps: number) => void;
  onContextLost: () => void;
  onCameraFlipped?: (flipped: boolean) => void;
  onTacticalView?: (active: boolean) => void;
}

interface CameraShot {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

const CAMERA_SHOTS: Record<CameraPreset, CameraShot> = {
  white: { position: new THREE.Vector3(0, 6.4, 8.6), target: new THREE.Vector3(0, 0.35, 0) },
  black: { position: new THREE.Vector3(0, 6.4, -8.6), target: new THREE.Vector3(0, 0.35, 0) },
  top: { position: new THREE.Vector3(0, 12.4, 0.35), target: new THREE.Vector3(0, 0.2, 0) },
  cinematic: { position: new THREE.Vector3(9.6, 3.6, 6.8), target: new THREE.Vector3(-0.4, 0.5, -0.4) },
};

/**
 * The flat tactical map: high above the board, dead centre and shot through a
 * narrow lens so the squares read as a grid instead of a receding perspective.
 */
const TACTICAL_SHOT: CameraShot = {
  position: new THREE.Vector3(0, 22, 0.55),
  target: new THREE.Vector3(0, 0, 0),
};
const TACTICAL_FOV = 28;
const DEFAULT_FOV = 46;

const PROMOTION_CHOICES: PieceKind[] = ["q", "r", "b", "n"];

/**
 * How each rank sounds when it goes down: the court and the big bodies die
 * louder and a shade lower, footsoldiers thinner and higher.
 */
const CRY_WEIGHT: Record<PieceKind, { volume: number; rate: number }> = {
  k: { volume: 1.1, rate: 0.94 },
  q: { volume: 1.05, rate: 0.98 },
  r: { volume: 1, rate: 0.92 },
  b: { volume: 0.92, rate: 1 },
  n: { volume: 0.95, rate: 1.01 },
  p: { volume: 0.85, rate: 1.05 },
};

/**
 * The colour of the motes a body leaves behind as it burns away: cold
 * soul-light for the ivory kingdom, live embers for the Sun Empire.
 */
const EMBER_COLOR: Record<Faction, number> = {
  w: 0xbcd8ff,
  b: 0xff8a3c,
};

/**
 * How heavy each rank feels against the board — drives the pitch, ring and
 * loudness of the wooden knock when a figure is lifted or set down.
 */
const WOOD_WEIGHT: Record<PieceKind, number> = {
  k: 1,
  q: 0.88,
  r: 0.82,
  b: 0.52,
  n: 0.58,
  p: 0.3,
};

/** How one rank crosses the board on its own legs. */
interface Gait {
  /** Footfalls put down per square of travel — the length of the stride. */
  stepsPerTile: number;
  /** Footfalls per second — the cadence of the march. */
  cadence: number;
  /** What the boot sounds like against the stone. */
  timbre: FootstepTimbre;
  /** Loudness of one footfall. */
  volume: number;
}

/**
 * The twelve figures do not walk alike. Footsoldiers take short, quick, scuffing
 * steps; the tower guardians tread slowly in full plate; the crown crosses the
 * board at a deliberate pace that nothing on the board hurries.
 */
const GAITS: Record<PieceKind, Gait> = {
  k: { stepsPerTile: 1.55, cadence: 1.85, timbre: "regal", volume: 1 },
  q: { stepsPerTile: 1.7, cadence: 2.1, timbre: "regal", volume: 0.88 },
  r: { stepsPerTile: 1.5, cadence: 1.95, timbre: "plate", volume: 1.12 },
  b: { stepsPerTile: 1.9, cadence: 2.45, timbre: "leather", volume: 0.78 },
  n: { stepsPerTile: 2, cadence: 2.9, timbre: "plate", volume: 0.95 },
  p: { stepsPerTile: 2, cadence: 2.7, timbre: "scuff", volume: 0.72 },
};

/**
 * A marching distance profile: a short push-off, a long stretch at constant
 * speed, then a brief settle. The stride clock runs at a fixed cadence, so an
 * eased-all-the-way curve (what a sliding piece uses) would leave the feet
 * visibly skating at both ends of the move.
 *
 * @param ramp fraction of the move spent accelerating, and again decelerating
 */
function strideEasing(ramp: number): Easing {
  const r = Math.min(0.4, Math.max(0.02, ramp));
  // Distance covered by the ramp-up + cruise + ramp-down, before normalising.
  const span = 1 - r;
  return (t: number): number => {
    if (t <= r) return t * t * 0.5 / r / span;
    if (t >= 1 - r) {
      const rest = 1 - t;
      return (span - rest * rest * 0.5 / r) / span;
    }
    return (t - r * 0.5) / span;
  };
}

/**
 * Owns every three.js object. The chess core drives it through events and the
 * animator hook; React only calls the small imperative API at the bottom.
 */
export class SceneEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private hall: CastleHall;
  private battlefield: Battlefield;
  /** Rainforest dressing — only staged by the Sun Temple map. */
  private jungle: JungleOverlay;
  private board = new BoardView();
  private effects = new EffectsSystem();
  private shake = new ShakeSystem();
  private tweens = new TweenManager();
  private factory = new PieceFactory();
  private postfx: PostFX;

  private pieces = new Map<SquareId, PieceView>();
  private captured: PieceView[] = [];
  /**
   * Figures mid-move. They are removed from `pieces` for the duration of the
   * animation, so without this set their mixers would never be ticked and the
   * strike / death clips would sit frozen on their first frame.
   */
  private motion = new Set<PieceView>();
  private promotionGroup: THREE.Group | null = null;
  private promotionViews: PieceView[] = [];
  private promotionResolve: ((kind: PieceKind) => void) | null = null;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private selected: SquareId | null = null;
  private hoveredPiece: PieceView | null = null;
  private dragging: { piece: PieceView; from: SquareId; origin: THREE.Vector3 } | null = null;
  private pointerDownAt: { x: number; y: number; square: SquareId | null } | null = null;
  private legalTargets = new Map<SquareId, boolean>();
  private previewing = false;

  private lastFrameTime = 0;
  private elapsed = 0;
  private frameId = 0;
  private running = false;
  private disposed = false;
  private frameErrors = 0;
  private blackFrameChecks = 0;

  private preset: QualityPreset;
  private arena: ArenaTheme = DEFAULT_ARENA;
  /** Travels with the camera so the near face of every figure stays readable. */
  private cameraLamp: THREE.DirectionalLight;
  private captureCinematics = true;
  private rotateBoard = true;
  private rankBadges = true;
  private interactive = true;
  private attract = false;
  /** Computer-vs-computer showcase: slow auto orbit + cinematic grade. */
  private showcase = false;
  private showcaseOrbitSpeed = 0.32;
  /** Elapsed time of the last manual camera drag (auto orbit yields to it). */
  private lastManualCameraAt = -999;
  private introPlaying = false;
  private introSkipped = false;
  private orbiting = false;
  private cameraFlipped = false;
  /** Flat top-down map: sculpts swap for counters and the world is struck. */
  private tactical = false;
  /** The 3D framing to drop back into when the map is folded away. */
  private tacticalReturn: CameraShot | null = null;
  /** Dressing hidden while the map is up, so it can be put back exactly. */
  private struck: THREE.Object3D[] = [];

  private fpsSamples: number[] = [];
  private autoAdjusted = false;
  private lastFpsReport = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private controller: GameController,
    private callbacks: SceneCallbacks,
    preset: QualityPreset,
    arena: ArenaTheme = DEFAULT_ARENA,
  ) {
    this.preset = preset;
    this.arena = arena;
    const look = ARENA_LOOKS[arena];
    const settings = QUALITY_SETTINGS[preset];

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: settings.msaaSamples > 0,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.maxPixelRatio));
    this.renderer.shadowMap.enabled = settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = look.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color(look.background);
    // Thinner, warmer haze than a sealed hall would use: the siege camps and
    // the armies beyond the broken wall have to read through it.
    this.scene.fog = new THREE.FogExp2(look.fog.color, look.fog.density);

    this.camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.1, 260);
    this.camera.position.copy(CAMERA_SHOTS.white.position);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.rotateSpeed = 0.55;
    this.controls.minDistance = 4.5;
    this.controls.maxDistance = 17;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.08;
    this.controls.enablePan = false;
    this.controls.target.copy(CAMERA_SHOTS.white.target);
    this.controls.autoRotateSpeed = 0.45;

    this.hall = new CastleHall(preset, look);
    this.scene.add(this.hall.group);
    this.battlefield = new Battlefield(preset, look);
    this.scene.add(this.battlefield.group);
    this.jungle = new JungleOverlay(preset, look);
    this.scene.add(this.jungle.group);
    this.scene.add(this.board.group);
    this.board.applyArena(look);
    this.scene.add(this.effects.group);

    // A soft lamp parented to the camera: whichever way the board is turned,
    // the faces and shields pointing at the player are never in shadow.
    this.cameraLamp = new THREE.DirectionalLight(look.lamp.color, look.lamp.intensity);
    this.cameraLamp.position.set(0, 1.5, 2.5);
    this.camera.add(this.cameraLamp);
    this.camera.add(this.cameraLamp.target);
    this.cameraLamp.target.position.set(0, 0, -1);
    this.scene.add(this.camera);

    this.scene.environment = buildEnvironmentMap(this.renderer, look);
    this.scene.environmentIntensity = look.environment.intensity;

    this.postfx = new PostFX(this.renderer, this.scene, this.camera);
    this.postfx.setGrade(look.grade);
    this.postfx.setBloom(look.bloom);
    this.postfx.setPreset(preset);

    this.bindEvents();
    this.controller.setAnimator((event) => this.animateMove(event));
    this.controller.on("state", (snapshot) => this.onState(snapshot));
    this.controller.on("reset", () => this.rebuildPieces());
    this.controller.on("illegal", ({ from }) => this.rejectMove(from));
    this.controller.on("gameover", () => void this.playEndCinematic());
    this.handleResize();
  }

  // ---------------------------------------------------------------- lifecycle

  async load(): Promise<void> {
    await this.factory.load((done, total) => this.callbacks.onLoadProgress(done / total));
    if (this.disposed) return;
    this.rebuildPieces();
    this.callbacks.onReady();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    const loop = (): void => {
      if (!this.running) return;
      this.frameId = requestAnimationFrame(loop);
      try {
        this.frame();
      } catch (error) {
        this.frameErrors += 1;
        if (this.frameErrors <= 3) console.error("[scene] frame failed", error);
        // A misbehaving effect must never take the whole hall down with it.
        if (this.frameErrors === 3) this.postfx.forceDirect("repeated frame errors");
      }
    };
    this.frameId = requestAnimationFrame(loop);
  }

  private frame(): void {
    const now = performance.now();
    const delta = Math.min(0.05, Math.max(0, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;
    this.elapsed += delta;

    this.tweens.update(delta);
    this.hall.update(delta);
    this.battlefield.update(delta, this.camera);
    this.jungle.update(delta, this.camera);
    this.board.update(delta);
    this.effects.update(delta);
    this.shake.update(delta);

    for (const piece of this.pieces.values()) piece.update(delta, this.elapsed);
    for (const piece of this.motion) piece.update(delta, this.elapsed);
    for (const piece of this.captured) piece.update(delta, this.elapsed);
    for (const piece of this.promotionViews) piece.update(delta, this.elapsed);

    if (this.promotionGroup) {
      this.promotionGroup.children.forEach((child, index) => {
        child.rotation.y = this.elapsed * 0.9 + index * 0.4;
      });
      if (this.tactical) {
        // Lay the picker flat so the four candidates face the overhead camera.
        this.promotionGroup.position.set(0, 3.4, 0);
        this.promotionGroup.rotation.set(-Math.PI / 2, 0, 0);
      } else {
        this.promotionGroup.rotation.set(0, 0, 0);
        this.promotionGroup.position.set(0, 2.6, 0);
        this.promotionGroup.lookAt(this.camera.position.x, 2.6, this.camera.position.z);
      }
    }

    if (this.tactical) this.alignTokens();

    // Auto orbit for the attract loop and the showcase, but never fight the
    // hand on the mouse: a drag suspends it for a few seconds.
    const orbitIdle = this.elapsed - this.lastManualCameraAt > 3.2;
    this.controls.autoRotate = !this.tactical && (this.attract || (this.showcase && orbitIdle));
    this.controls.autoRotateSpeed = this.attract ? 0.45 : this.showcaseOrbitSpeed;
    this.controls.update();

    this.camera.position.add(this.shake.offset);
    this.postfx.render(delta);
    this.camera.position.sub(this.shake.offset);

    this.guardAgainstBlackFrames();
    this.sampleFps(delta);
  }

  /**
   * Some GPU/driver combinations silently produce an empty frame through the
   * composer. Sample the middle of the canvas twice during the first seconds
   * and fall back to a plain forward render rather than showing a black hall.
   */
  private guardAgainstBlackFrames(): void {
    if (this.blackFrameChecks >= 2 || !this.postfx.enabled) return;
    const due = this.blackFrameChecks === 0 ? 1.2 : 2.6;
    if (this.elapsed < due) return;
    this.blackFrameChecks += 1;
    if (!this.isCentreBlack()) {
      this.blackFrameChecks = 2;
      return;
    }
    if (this.blackFrameChecks < 2) return;
    this.postfx.forceDirect("composer produced an empty frame");
  }

  private isCentreBlack(): boolean {
    const gl = this.renderer.getContext();
    const { width, height } = this.renderer.domElement;
    if (width < 8 || height < 8) return false;
    const span = 8;
    const pixels = new Uint8Array(span * span * 4);
    try {
      gl.readPixels(
        Math.floor(width / 2 - span / 2),
        Math.floor(height / 2 - span / 2),
        span,
        span,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
    } catch {
      return false;
    }
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 10 || pixels[i + 1] > 10 || pixels[i + 2] > 10) return false;
    }
    return true;
  }

  private sampleFps(delta: number): void {
    if (delta <= 0) return;
    this.fpsSamples.push(1 / delta);
    if (this.fpsSamples.length > 120) this.fpsSamples.shift();
    if (this.elapsed - this.lastFpsReport < 1) return;
    this.lastFpsReport = this.elapsed;
    const average = this.fpsSamples.reduce((sum, value) => sum + value, 0) / this.fpsSamples.length;
    this.callbacks.onFps(Math.round(average));

    // One automatic step down if the detected preset is clearly too heavy.
    if (this.autoAdjusted || this.elapsed < 8 || this.fpsSamples.length < 100) return;
    if (average >= 40) return;
    const order: QualityPreset[] = ["low", "medium", "high", "ultra"];
    const index = order.indexOf(this.preset);
    if (index <= 0) {
      this.autoAdjusted = true;
      return;
    }
    this.autoAdjusted = true;
    const next = order[index - 1];
    this.setQuality(next);
    this.callbacks.onQualityAdjusted(next);
  }

  // ------------------------------------------------------------------- pieces

  private rebuildPieces(): void {
    for (const piece of this.pieces.values()) piece.dispose();
    for (const piece of this.captured) piece.dispose();
    this.pieces.clear();
    this.captured = [];
    this.selected = null;
    this.legalTargets.clear();
    this.board.clearHighlights();
    if (!this.factory.isReady) return;

    const settings = QUALITY_SETTINGS[this.preset];
    for (const entry of this.controller.getBoard()) {
      const view = this.factory.create(entry.kind, entry.color, {
        contactShadows: settings.contactShadows,
        idleAnimation: settings.characterAnimations,
        rankBadge: this.rankBadges,
      });
      if (this.tactical) view.setFlat(true);
      view.container.position.copy(squareToWorld(entry.square));
      this.scene.add(view.container);
      this.pieces.set(entry.square, view);
    }
  }

  private trayPosition(color: Faction, index: number): THREE.Vector3 {
    const column = Math.floor(index / 8);
    const row = index % 8;
    const side = color === "b" ? 1 : -1;
    const x = side * (TILE * 4 + 0.95 + column * 0.62);
    const z = -TILE * 3.2 + row * 0.92;
    return new THREE.Vector3(x, 0, z);
  }

  private async sendToTray(piece: PieceView): Promise<void> {
    this.motion.delete(piece);
    const index = this.captured.filter((entry) => entry.color === piece.color).length;
    this.captured.push(piece);
    // The fallen figure stands back up once it reaches the tray.
    piece.resetPose();
    const destination = this.trayPosition(piece.color, index);
    piece.container.scale.setScalar(0.55);
    piece.container.position.copy(destination);
    piece.setOpacity(0);
    await this.tweens.to({
      duration: 0.5,
      easing: Ease.outCubic,
      onUpdate: (t) => piece.setOpacity(t * 0.95),
    });
  }

  // ---------------------------------------------------------------- animation

  private async animateMove(event: MoveEvent): Promise<void> {
    const piece = this.pieces.get(event.from);
    if (!piece) return;

    this.clearSelection();
    this.board.clearHighlights();
    this.pieces.delete(event.from);
    this.motion.add(piece);

    const victim = event.capture ? this.pieces.get(event.capture.square) : null;
    if (event.capture) this.pieces.delete(event.capture.square);
    if (victim) this.motion.add(victim);

    const from = squareToWorld(event.from);
    const to = squareToWorld(event.to);

    if (victim) {
      const strikeSquare = event.capture ? event.capture.square : event.to;
      // The battle beat is a camera performance — it has no meaning on the map.
      if (this.captureCinematics && !this.tactical)
        await this.playCaptureCinematic(piece, victim, from, to, strikeSquare);
      else {
        const approach = squareToWorld(event.from);
        await this.glide(piece, from, to, event.kind === "n");
        this.strikeImpact(strikeSquare, 0.8);
        await this.crumble(victim, approach);
      }
      void this.sendToTray(victim);
    } else {
      await this.glide(piece, from, to, event.kind === "n");
      audio.play("place", 0.55);
    }

    piece.container.position.copy(to);
    this.motion.delete(piece);
    this.pieces.set(event.to, piece);
    // Taking the square: dust ring, tile dip and the figure settling its weight.
    // Softer after a kill — the strike already shook the stone.
    this.landOn(piece, event.to, victim ? 0.7 : event.kind === "n" ? 1.25 : 1);
    // Arrived: face the enemy side again rather than holding the march heading.
    // A promoting figure is about to be replaced, so it is left alone.
    if (!event.promotion) void piece.turnHome(this.tweens, 0.3);

    if (event.rook) {
      const rook = this.pieces.get(event.rook.from);
      if (rook) {
        this.pieces.delete(event.rook.from);
        this.motion.add(rook);
        // The tower walks its own path after the king has taken its square, so
        // castling reads as two moves rather than one synchronised slide.
        await this.glide(rook, squareToWorld(event.rook.from), squareToWorld(event.rook.to), false);
        this.motion.delete(rook);
        this.pieces.set(event.rook.to, rook);
        audio.play("place", 0.4);
        this.landOn(rook, event.rook.to, 0.85);
        void rook.turnHome(this.tweens, 0.3);
      }
    }

    if (event.promotion) {
      piece.dispose();
      this.pieces.delete(event.to);
      const view = this.factory.create(event.promotion, event.color, {
        contactShadows: QUALITY_SETTINGS[this.preset].contactShadows,
        idleAnimation: QUALITY_SETTINGS[this.preset].characterAnimations,
        rankBadge: this.rankBadges,
      });
      if (this.tactical) view.setFlat(true);
      view.container.position.copy(to);
      view.container.scale.setScalar(0.01);
      this.scene.add(view.container);
      this.pieces.set(event.to, view);
      this.effects.spawnBurst(to.clone().setY(0.4), FACTION_ACCENT[event.color], 40, { speed: 2.6, life: 0.8 });
      this.effects.spawnFlash(to.clone().setY(0.6), 2.4, 0.4);
      await this.tweens.to({
        duration: 0.6,
        easing: Ease.outBack,
        onUpdate: (t) => view.container.scale.setScalar(Math.max(0.01, t)),
      });
      view.container.scale.setScalar(1);
      this.landOn(view, event.to, 1.3);
    }

    this.board.setHighlight(event.from, "last");
    this.board.setHighlight(event.to, "last");

    if (event.isCheck) {
      audio.play("check", 0.55);
      this.shake.add(0.2);
    }

    if (
      this.rotateBoard &&
      !this.tactical &&
      this.controller.getSnapshot().mode === "hotseat" &&
      !event.isGameOver
    ) {
      await this.swingCamera();
    }
  }

  /**
   * Moving a figure between two squares. A rigged sculpt turns to face its
   * destination, crosses the distance on its own legs and puts a real footfall
   * down on every step: the walk clip is retimed to the cadence of its rank, so
   * the skeleton and the stride clock that fires the footstep sounds and the
   * grit puffs are the same clock — nothing skates.
   *
   * The knight keeps its leap and runs through the air instead of walking.
   * Sculpts with no rig (and the low preset, where skeletal animation is off)
   * keep the old smooth slide, but still step audibly so the board is not silent.
   *
   * @param hurry cadence multiplier — above 1 the figure presses forward, which
   *   is what a charge into a standoff needs.
   */
  private async glide(piece: PieceView, from: THREE.Vector3, to: THREE.Vector3, arc: boolean, hurry = 1) {
    const settings = QUALITY_SETTINGS[this.preset];
    const distance = from.distanceTo(to);
    const gait = GAITS[piece.kind];
    const clip: "walk" | "run" = arc && piece.hasClip("run") ? "run" : "walk";
    const onFoot =
      !this.tactical && settings.characterAnimations && piece.hasAnimations && piece.hasClip(clip);

    // Longer moves take more steps rather than a faster slide.
    const tiles = Math.max(0.6, distance / TILE);
    const steps = Math.max(2, Math.round(tiles * gait.stepsPerTile * (arc ? 0.8 : 1)));
    const cadence = gait.cadence * hurry * (arc ? 1.5 : 1);
    const time = onFoot
      ? THREE.MathUtils.clamp(steps / cadence, 0.34, 2.4)
      : Math.min(0.72, 0.24 + distance * 0.055) / hurry;
    // The realised cadence, after the clamp — this is what the legs must match.
    const stepRate = steps / time;
    const height = arc ? 0.85 + distance * 0.08 : 0.06;
    const trails = settings.captureParticles >= 34 && distance > TILE * 0.6;
    let nextTrail = 0.18;
    // A fraction of a step, so the first boot lands just after the push-off
    // instead of on the frame the figure starts to move.
    let nextStep = 0.34;

    if (arc) {
      // Kicking off: grit thrown back off the tile the rider leaves behind.
      piece.flareAura(0.4);
      this.effects.spawnBurst(from.clone().setY(BOARD_TOP + 0.06), 0xc7ac82, trails ? 10 : 5, {
        speed: 1.4,
        life: 0.4,
      });
    } else if (onFoot) {
      // Nobody walks backwards: square up on the destination before setting off.
      await piece.turnTowards(to, this.tweens, Math.min(0.22, 0.5 / cadence));
    }

    const marching = onFoot && piece.startMarch(clip, stepRate);
    // A ground march holds a constant speed through the middle of the move; a
    // slide and a leap keep their eased curves.
    const easing: Easing = arc
      ? Ease.inOutCubic
      : marching
        ? strideEasing(Math.min(0.3, 1.1 / steps))
        : Ease.inOutQuart;

    await this.tweens.to({
      duration: time,
      easing,
      onUpdate: (t) => {
        piece.container.position.lerpVectors(from, to, t);
        piece.container.position.y = from.y + Math.sin(Math.PI * t) * height;
        // Footfalls: the boot itself, plus the grit it lifts off the stone. The
        // rider is in the air, so its run makes no contact until it lands.
        if (!arc && steps > 0) {
          const taken = t * steps;
          while (taken >= nextStep && nextStep <= steps) {
            this.footfall(piece, gait, Math.round(nextStep), trails);
            nextStep += 1;
          }
        }
        // A thin wake of dust follows a sliding figure or a leaping rider.
        if (trails && !marching && t >= nextTrail && t < 0.88) {
          nextTrail += arc ? 0.2 : 0.24;
          this.effects.spawnSmoke(piece.container.position.clone().setY(BOARD_TOP + 0.07), {
            count: 2,
            radius: 0.22,
            scale: arc ? 0.4 : 0.3,
            growth: 2.1,
            life: 0.55,
            speed: 0.3,
            rise: 0.1,
            color: 0x9d9078,
            opacity: arc ? 0.24 : 0.16,
          });
        }
      },
    });
    piece.container.position.copy(to);
    if (marching) piece.stopMarch(0.2);
    if (arc) this.shake.add(0.05);
  }

  /**
   * One boot going down mid-march: the step itself, panned to where the figure
   * is on screen and pitch-jittered so a long march never turns metronomic,
   * plus a small puff of grit lifted exactly where the foot struck.
   */
  private footfall(piece: PieceView, gait: Gait, index: number, dust: boolean): void {
    const at = piece.container.position;
    audio.footstep({
      pan: this.stereoPan(at),
      timbre: gait.timbre,
      // Alternating feet are never quite equal, and neither are two steps.
      volume: gait.volume * (index % 2 === 0 ? 1 : 0.93),
      jitter: (Math.random() - 0.5) * 0.16,
    });
    if (!dust) return;
    this.effects.spawnSmoke(at.clone().setY(BOARD_TOP + 0.05), {
      count: 2,
      radius: 0.16,
      scale: 0.24 + gait.volume * 0.12,
      growth: 2.2,
      life: 0.5,
      speed: 0.26,
      rise: 0.08,
      color: 0xa2947c,
      opacity: 0.15,
    });
  }

  /**
   * The arrival beat on a destination square: a dust ring rolls out from under
   * the figure, the tile dips, the team aura flares and the body takes the
   * weight with a short squash that springs back. `weight` scales the whole
   * thing — a knight dropping out of its arc lands harder than a bishop slid
   * across the board, and a victor stepping onto a corpse lands softer still.
   */
  private landOn(piece: PieceView, square: SquareId, weight = 1): void {
    const settings = QUALITY_SETTINGS[this.preset];
    const heavy = piece.kind === "k" || piece.kind === "q" || piece.kind === "r";
    const strength = Math.min(1.6, weight * (heavy ? 1.18 : 0.92));
    const centre = squareToWorld(square, BOARD_TOP + 0.05);

    this.board.land(square, FACTION_ACCENT[piece.color], strength);
    this.woodKnock(piece, centre, strength);
    this.landingSteps(piece, centre, strength);
    piece.flareAura(Math.min(1, 0.8 * strength));
    if (strength > 0.9) this.shake.add(0.035 * strength);

    const grit = Math.max(5, Math.round(settings.captureParticles * 0.2 * strength));
    this.effects.spawnBurst(centre, 0xd9bd8e, grit, { speed: 1.15 * strength, life: 0.45 });
    if (settings.captureParticles >= 34) {
      this.effects.spawnSmoke(centre.clone().setY(BOARD_TOP + 0.08), {
        count: Math.max(2, Math.round(grit * 0.25)),
        radius: 0.42,
        scale: 0.42,
        growth: 2.5,
        life: 0.75,
        speed: 0.6 * strength,
        rise: 0.1,
        color: 0xa2947c,
        opacity: 0.26,
      });
    }

    void this.settle(piece, strength);
  }

  /**
   * The soft wooden tock of a figure meeting the board, panned to the square it
   * lands on. Heavier ranks knock lower and longer; a light touch-down (a victor
   * stepping onto a cleared square) barely registers.
   */
  private woodKnock(piece: PieceView, at: THREE.Vector3, strength: number): void {
    audio.woodTap({
      pan: this.stereoPan(at),
      weight: WOOD_WEIGHT[piece.kind],
      volume: Math.min(1.05, 0.5 + strength * 0.42),
    });
  }

  /**
   * Boots taking the square. Everyone puts one foot down as they arrive; the
   * rider drops out of its leap onto both, a beat apart, which is what makes
   * the landing read as weight rather than a touch-down.
   */
  private landingSteps(piece: PieceView, at: THREE.Vector3, strength: number): void {
    const gait = GAITS[piece.kind];
    const pan = this.stereoPan(at);
    const volume = gait.volume * Math.min(1.4, 0.85 + strength * 0.45);
    audio.footstep({ pan, timbre: gait.timbre, volume });
    if (piece.kind !== "n") return;
    audio.footstep({ pan, timbre: gait.timbre, volume: volume * 1.15, delay: 0.07, jitter: -0.09 });
  }

  /** Knees taking the load: a fast compression that springs back out. */
  private async settle(piece: PieceView, strength: number): Promise<void> {
    const depth = Math.min(1, 0.5 + strength * 0.45);
    await this.tweens.to({
      duration: 0.09,
      easing: Ease.outCubic,
      onUpdate: (t) => piece.setSquash(depth * t),
    });
    await this.tweens.to({
      duration: 0.62,
      easing: Ease.outElastic,
      onUpdate: (t) => piece.setSquash(depth * (1 - t)),
    });
    piece.setSquash(0);
  }

  /** Sub-1.5s battle beat: lunge, strike, sparks, shake, crumble. */
  private async playCaptureCinematic(
    attacker: PieceView,
    victim: PieceView,
    from: THREE.Vector3,
    to: THREE.Vector3,
    strikeSquare: SquareId,
  ): Promise<void> {
    const direction = to.clone().sub(from).normalize();
    const standoff = to.clone().sub(direction.clone().multiplyScalar(TILE * 0.52));
    // En passant kills a pawn on a different square than the one moved to.
    const victimSpot = victim.container.position.clone();
    const blow = victimSpot.clone().sub(standoff).setY(0);
    if (blow.lengthSq() < 1e-6) blow.copy(direction);
    blow.normalize();

    const originalFov = this.camera.fov;
    void this.tweens.to({
      duration: 0.22,
      easing: Ease.outCubic,
      onUpdate: (t) => {
        this.camera.fov = originalFov - 5.5 * t;
        this.camera.updateProjectionMatrix();
      },
    });

    // Both fighters square up: the attacker charges in, the defender turns to
    // meet its killer so the blow never lands on the back of a head.
    await Promise.all([
      // Pressing forward into the blow: the same march, a quicker cadence.
      this.glide(attacker, from, standoff, attacker.kind === "n", 1.35),
      victim.turnTowards(standoff, this.tweens, 0.3),
    ]);
    attacker.faceTowards(victimSpot);
    // Arrival beat: the march has stopped and the figure is squared up on its
    // target. A held breath here is what makes the blow read as its own action
    // rather than the tail of the walk.
    await wait(0.1);

    // Strike: the skeletal attack clip when the rig carries one, otherwise a
    // wind-up and lunge driven off the runtime node so the board anchor stays
    // put. Note this asks for the clip itself, not merely for a rig — a figure
    // whose strike failed to download must still visibly attack.
    const strike = attacker.hasClip("attack") ? attacker.playAttack() : null;
    if (strike && strike.duration > 0) await wait(strike.impact);
    else await this.lunge(attacker, direction);

    const impact = victimSpot.clone().setY(0.55);
    audio.play("capture", 0.85);
    this.strikeImpact(strikeSquare, 1);
    this.effects.spawnFlash(impact, 2.2, 0.24);
    this.effects.spawnBurst(impact, 0xffc978, QUALITY_SETTINGS[this.preset].captureParticles, {
      speed: 3.4,
      life: 0.75,
    });
    this.shake.add(0.55);

    if (!strike || strike.duration === 0) this.recover(attacker, direction);

    // The defender goes down while the attacker finishes following through.
    const recovery = strike ? Math.min(0.45, Math.max(0, strike.duration - strike.impact)) : 0.18;
    await Promise.all([this.slay(victim, blow), wait(recovery)]);

    void this.tweens.to({
      duration: 0.45,
      easing: Ease.outCubic,
      onUpdate: (t) => {
        this.camera.fov = originalFov - 5.5 * (1 - t);
        this.camera.updateProjectionMatrix();
      },
    });

    // The corpse is thrown clear in smoke as the victor takes the square.
    await Promise.all([
      this.banish(victim, blow),
      // The last stride onto the square it has just cleared.
      this.glide(attacker, standoff, to, false, 1.5),
    ]);
    audio.play("place", 0.5);
  }

  /**
   * The strike for a figure with no attack clip — an unrigged sculpt, or one
   * whose clip never arrived. It winds up away from its target, twisting the
   * body, then drives forward into the blow; it resolves exactly as the blow
   * lands, so the impact beat the caller plays is unchanged.
   */
  private async lunge(attacker: PieceView, direction: THREE.Vector3): Promise<void> {
    const reach = TILE * 0.34;
    const wind = -reach * 0.4;
    const push = (offset: number, twist: number) => {
      attacker.runtime.position.x = direction.x * offset;
      attacker.runtime.position.z = direction.z * offset;
      attacker.runtime.rotation.y = twist;
    };

    // Weight shifts back onto the rear foot, shoulders turning out of line.
    await this.tweens.to({
      duration: 0.19,
      easing: Ease.outCubic,
      onUpdate: (t) => push(wind * t, -0.42 * t),
    });
    // Then everything unloads forward at once.
    await this.tweens.to({
      duration: 0.11,
      easing: Ease.inCubic,
      onUpdate: (t) => push(THREE.MathUtils.lerp(wind, reach, t), THREE.MathUtils.lerp(-0.42, 0.3, t)),
    });
  }

  /** Coming out of a lunge: the body unwinds back over its own square. */
  private recover(attacker: PieceView, direction: THREE.Vector3): void {
    const reach = TILE * 0.34;
    void this.tweens.to({
      duration: 0.32,
      easing: Ease.outCubic,
      onUpdate: (t) => {
        attacker.runtime.position.x = direction.x * reach * (1 - t);
        attacker.runtime.position.z = direction.z * reach * (1 - t);
        attacker.runtime.rotation.y = 0.3 * (1 - t);
      },
    });
  }

  /**
   * The death beat: a hit flinch driven off the blow direction, the full skeletal
   * death clip (the figure keeps its fallen pose), then a short hold on the body
   * before it is cleared. Unrigged sculpts fall back to a topple.
   */
  private async slay(victim: PieceView, blow: THREE.Vector3): Promise<void> {
    const settings = QUALITY_SETTINGS[this.preset];
    victim.takeHit();
    audio.bodyFall(0.8);

    const chest = victim.container.position.clone().setY(0.5);
    this.cryOut(victim, chest);
    this.effects.spawnBurst(chest, 0xff5a3a, Math.round(settings.captureParticles * 0.5), {
      speed: 2.8,
      life: 0.55,
    });

    if (!victim.hasAnimations) {
      await this.topple(victim, blow, 0.55);
      return;
    }

    const death = victim.playDeath();
    if (death <= 0) {
      await this.topple(victim, blow, 0.55);
      return;
    }

    // Knocked back off its feet, then dragged to a stop as the body settles.
    void this.tweens.to({
      duration: Math.min(0.5, death * 0.6),
      easing: Ease.outQuint,
      onUpdate: (t) => {
        victim.runtime.position.x = blow.x * t * 0.22;
        victim.runtime.position.z = blow.z * t * 0.22;
      },
    });

    await wait(death);
    // Dust kicked up as the body lands, then a beat to let the fall register.
    this.effects.spawnBurst(victim.container.position.clone().setY(0.16), 0x9c8a6a, 24, {
      speed: 1.3,
      life: 0.8,
    });
    this.effects.spawnSmoke(victim.container.position.clone().setY(0.12), {
      count: Math.max(3, Math.round(settings.captureParticles * 0.16)),
      radius: 0.42,
      scale: 0.7,
      growth: 2.2,
      life: 1,
      speed: 0.8,
      rise: 0.2,
      color: 0x8f8172,
      opacity: 0.5,
    });
    await wait(0.14);
  }

  /**
   * The exit: a fallen figure never simply blinks out. Footsoldiers and riders
   * are hurled clear of the board in a tumbling arc, the heavy court pieces are
   * dragged down into a boiling column of smoke — and in both cases the body
   * itself burns away through a noise field, thinning into embers on the air.
   */
  private async banish(victim: PieceView, blow: THREE.Vector3): Promise<void> {
    const heavy = victim.kind === "k" || victim.kind === "q" || victim.kind === "r";
    if (heavy) await this.swallow(victim);
    else await this.hurl(victim, blow);
  }

  /** Knocked off the board: ballistic arc, end-over-end tumble, smoke trail. */
  private async hurl(victim: PieceView, blow: THREE.Vector3): Promise<void> {
    const settings = QUALITY_SETTINGS[this.preset];
    const start = victim.container.position.clone();
    const rest = victim.container.quaternion.clone();
    const plume = Math.max(4, Math.round(settings.captureParticles * 0.22));

    victim.setAirborne(true);
    audio.bodyFall(0.32);
    this.shake.add(0.16);

    // Torn loose from the stone: grit off the tile and the first breath of smoke.
    this.effects.spawnBurst(start.clone().setY(0.18), 0xc0a075, Math.round(settings.captureParticles * 0.4), {
      speed: 2.6,
      life: 0.6,
    });
    this.effects.spawnSmoke(start.clone().setY(0.28), {
      count: plume,
      radius: 0.42,
      scale: 0.85,
      growth: 2.6,
      life: 1.2,
      speed: 1.1,
      rise: 0.5,
      color: 0x9b8b76,
      opacity: 0.7,
    });

    const lateral = new THREE.Vector3(-blow.z, 0, blow.x).multiplyScalar((Math.random() - 0.5) * TILE * 0.7);
    const distance = TILE * 2.5;
    const spinAxis = new THREE.Vector3(-blow.z, 0.35, blow.x).normalize();
    const spin = Math.PI * (1.7 + Math.random() * 1.1);
    const tumble = new THREE.Quaternion();
    const position = new THREE.Vector3();
    let nextTrail = 0.14;
    let nextEmber = 0.2;
    const motes = Math.max(4, Math.round(settings.captureParticles * 0.16));

    await this.tweens.to({
      duration: 0.82,
      easing: Ease.linear,
      onUpdate: (t) => {
        position.copy(start).addScaledVector(blow, distance * t).addScaledVector(lateral, t * t);
        // Hard launch that is still climbing when the body comes apart.
        position.y = start.y + Math.sin(Math.PI * t * 0.78) * 1.5;
        victim.container.position.copy(position);
        tumble.setFromAxisAngle(spinAxis, spin * t);
        victim.container.quaternion.copy(tumble).multiply(rest);
        victim.container.scale.setScalar(1 - t * 0.2);
        // Two layers of leaving: the surface burns open from the soles up while
        // whatever is left of it thins out against the light.
        victim.setDissolve(Math.max(0, (t - 0.2) / 0.74));
        victim.setOpacity(1 - 0.7 * Math.max(0, (t - 0.3) / 0.7));
        if (t >= nextEmber) {
          nextEmber += 0.09;
          // Embers peeled off the burn edge, left hanging where the body was.
          this.effects.spawnBurst(position.clone().setY(position.y + 0.3), EMBER_COLOR[victim.color], motes, {
            speed: 0.5,
            life: 1.5,
            gravity: -0.5,
            radius: 0.32,
            size: 0.085,
            growth: 0.35,
            drag: 1.9,
            rise: 0.3,
          });
        }
        if (t >= nextTrail) {
          nextTrail += 0.16;
          this.effects.spawnSmoke(position.clone().setY(position.y + 0.35), {
            count: Math.max(2, Math.round(plume * 0.4)),
            radius: 0.2,
            scale: 0.55,
            growth: 2.3,
            life: 0.9,
            speed: 0.45,
            rise: 0.3,
            color: 0x94897b,
            opacity: 0.45,
          });
        }
      },
    });

    // It never lands — the body burns through mid-flight and is gone.
    const end = position.clone();
    this.effects.spawnBurst(end, EMBER_COLOR[victim.color], motes * 3, {
      speed: 0.85,
      life: 1.9,
      gravity: -0.6,
      radius: 0.42,
      size: 0.1,
      growth: 0.3,
      drag: 1.6,
      rise: 0.45,
    });
    this.effects.spawnSmoke(end, {
      count: plume + 4,
      radius: 0.45,
      scale: 1.05,
      growth: 3,
      life: 1.3,
      speed: 1.3,
      rise: 0.45,
      color: 0x8d8174,
      opacity: 0.75,
      drift: blow.clone().multiplyScalar(0.55),
    });
    this.effects.spawnBurst(end, 0xffa561, Math.round(settings.captureParticles * 0.35), {
      speed: 2.3,
      life: 0.7,
    });

    victim.setDissolve(1);
    victim.setOpacity(0);
    victim.container.scale.setScalar(1);
    victim.container.quaternion.copy(rest);
    victim.container.position.copy(start);
    victim.setAirborne(false);
  }

  /** Court pieces go down with the board: sunk and turned into a smoke column. */
  private async swallow(victim: PieceView): Promise<void> {
    const settings = QUALITY_SETTINGS[this.preset];
    const start = victim.container.position.clone();
    const rest = victim.container.quaternion.clone();
    const plume = Math.max(5, Math.round(settings.captureParticles * 0.3));
    const up = new THREE.Vector3(0, 1, 0);
    const swirl = new THREE.Quaternion();

    audio.bodyFall(0.45);
    this.shake.add(0.12);
    this.effects.spawnSmoke(start.clone().setY(0.14), {
      count: plume,
      radius: 0.5,
      scale: 1,
      growth: 3.1,
      life: 1.5,
      speed: 1.4,
      rise: 0.85,
      color: 0x746757,
      opacity: 0.85,
    });
    this.effects.spawnBurst(start.clone().setY(0.2), 0xb59a72, Math.round(settings.captureParticles * 0.35), {
      speed: 1.8,
      life: 0.7,
    });

    let nextPuff = 0.22;
    let nextEmber = 0.16;
    const motes = Math.max(5, Math.round(settings.captureParticles * 0.2));
    await this.tweens.to({
      duration: 0.86,
      easing: Ease.inCubic,
      onUpdate: (t) => {
        victim.container.position.y = start.y - t * 0.4;
        victim.container.scale.setScalar(1 - t * 0.22);
        swirl.setFromAxisAngle(up, t * 0.8);
        victim.container.quaternion.copy(swirl).multiply(rest);
        // Royalty is unmade slowly: the burn climbs the body as it sinks and
        // what is left of it turns to haze on the way down.
        victim.setDissolve(Math.max(0, (t - 0.12) / 0.8));
        victim.setOpacity(Math.max(0.12, 1 - t * 0.85));
        if (t >= nextEmber) {
          nextEmber += 0.1;
          this.effects.spawnBurst(start.clone().setY(0.34 + t * 0.5), EMBER_COLOR[victim.color], motes, {
            speed: 0.42,
            life: 1.8,
            gravity: -0.62,
            radius: 0.3,
            size: 0.095,
            growth: 0.32,
            drag: 1.7,
            rise: 0.5,
          });
        }
        if (t >= nextPuff) {
          nextPuff += 0.24;
          this.effects.spawnSmoke(start.clone().setY(0.2), {
            count: Math.max(3, Math.round(plume * 0.45)),
            radius: 0.45,
            scale: 0.8,
            growth: 2.6,
            life: 1.2,
            speed: 1,
            rise: 0.65,
            color: 0x8b7d6d,
            opacity: 0.6,
          });
        }
      },
    });

    // The last of it goes up as a slow column of embers over its own square.
    this.effects.spawnBurst(start.clone().setY(0.5), EMBER_COLOR[victim.color], motes * 3, {
      speed: 0.35,
      life: 2.2,
      gravity: -0.7,
      radius: 0.34,
      size: 0.105,
      growth: 0.28,
      drag: 1.4,
      rise: 0.6,
    });

    // A low pool of smoke is left drifting over the square it held.
    this.effects.spawnSmoke(start.clone().setY(0.1), {
      count: Math.max(4, Math.round(plume * 0.6)),
      radius: 0.6,
      scale: 0.9,
      growth: 2.8,
      life: 1.6,
      speed: 0.7,
      rise: 0.15,
      color: 0x8f8272,
      opacity: 0.5,
    });

    victim.setDissolve(1);
    victim.setOpacity(0);
    victim.container.scale.setScalar(1);
    victim.container.quaternion.copy(rest);
    victim.container.position.copy(start);
  }

  /**
   * The figure's own dying voice. Each rank in each army has its own recorded
   * cry, panned to where the body is on screen and pitch-jittered so repeats
   * never sound identical; heavier ranks die louder and a touch lower.
   */
  private cryOut(victim: PieceView, chest: THREE.Vector3): void {
    const weight = CRY_WEIGHT[victim.kind];
    audio.deathCry(victim.color, victim.kind, {
      pan: this.stereoPan(chest),
      volume: weight.volume,
      rate: weight.rate * (0.95 + Math.random() * 0.1),
      delay: 0.03 + Math.random() * 0.05,
    });
  }

  /** Where a world point sits across the screen, as a -1..1 stereo position. */
  private stereoPan(position: THREE.Vector3): number {
    const projected = position.clone().project(this.camera);
    if (!Number.isFinite(projected.x)) return 0;
    return Math.max(-1, Math.min(1, projected.x));
  }

  /** Rigid topple for sculpts with no skeleton: knocked over, face down. */
  private async topple(victim: PieceView, blow: THREE.Vector3, duration: number): Promise<void> {
    const start = victim.container.position.clone();
    const axis = new THREE.Vector3(blow.z, 0, -blow.x).normalize();
    const fallen = new THREE.Quaternion().setFromAxisAngle(axis, -Math.PI * 0.46);
    const rest = victim.container.quaternion.clone();
    const target = fallen.multiply(rest);
    await this.tweens.to({
      duration,
      easing: Ease.outBounce,
      onUpdate: (t) => {
        victim.container.quaternion.slerpQuaternions(rest, target, t);
        victim.container.position.y = start.y + Math.sin(Math.PI * t) * 0.06;
        victim.container.position.x = start.x + blow.x * t * 0.12;
        victim.container.position.z = start.z + blow.z * t * 0.12;
      },
    });
    this.effects.spawnBurst(start.clone().setY(0.12), 0x9c8a6a, 22, { speed: 1.4, life: 0.7 });
    await wait(0.2);
    victim.container.quaternion.copy(rest);
    victim.container.position.copy(start);
  }

  /**
   * Board-level hit feedback on the square being taken: a white flash decaying
   * into a shockwave ring, the tiles jolting out of place, sparks off the stone
   * and a short camera kick.
   */
  private strikeImpact(square: SquareId, strength: number): void {
    const settings = QUALITY_SETTINGS[this.preset];
    this.board.impact(square, 0xff7a3a, strength);
    this.shake.add(0.22 * strength);
    const ground = squareToWorld(square, BOARD_TOP + 0.05);
    this.effects.spawnFlash(ground.clone().setY(BOARD_TOP + 0.18), 1.5 * strength, 0.2);
    this.effects.spawnBurst(ground, 0xffb066, Math.round(settings.captureParticles * 0.45 * strength), {
      speed: 2.1,
      life: 0.5,
    });
  }

  /**
   * Death without the cinematic: the figure still plays its death clip and is
   * knocked off its feet, just without the camera work and the stand-off.
   */
  private async crumble(victim: PieceView, killer: THREE.Vector3): Promise<void> {
    const blow = victim.container.position.clone().sub(killer).setY(0);
    if (blow.lengthSq() < 1e-6) blow.set(0, 0, 1);
    blow.normalize();
    victim.faceTowards(killer);
    await this.slay(victim, blow);
    await this.banish(victim, blow);
  }

  private async rejectMove(square: SquareId): Promise<void> {
    const piece = this.pieces.get(square);
    audio.blip("deny");
    if (!piece) return;
    await this.tweens.to({
      duration: 0.32,
      easing: Ease.linear,
      onUpdate: (t) => {
        piece.runtime.position.x = Math.sin(t * Math.PI * 6) * 0.07 * (1 - t);
      },
    });
    piece.runtime.position.x = 0;
  }

  // ------------------------------------------------------------------- camera

  async moveCameraTo(shot: CameraShot, duration = 1.1): Promise<void> {
    const fromPosition = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    this.controls.enabled = false;
    await this.tweens.to({
      duration,
      easing: Ease.inOutCubic,
      onUpdate: (t) => {
        this.camera.position.lerpVectors(fromPosition, shot.position, t);
        this.controls.target.lerpVectors(fromTarget, shot.target, t);
      },
    });
    this.controls.enabled = this.interactive;
  }

  setCameraPreset(preset: CameraPreset): void {
    // Picking a 3D shot always folds the flat map away first.
    if (this.tactical) {
      this.setTacticalView(false, CAMERA_SHOTS[preset]);
      return;
    }
    void this.moveCameraTo(CAMERA_SHOTS[preset]);
  }

  // --------------------------------------------------------- tactical 2D view

  /** True while the board is being read as a flat overhead map. */
  isTacticalView(): boolean {
    return this.tactical;
  }

  /**
   * Folds the hall away and reads the board as a 2D map: the camera climbs to
   * a narrow-lens overhead shot, every figure is replaced by a flat counter
   * stamped with its rank, and the world around the board is struck so nothing
   * can stand between the player and a square.
   */
  setTacticalView(active: boolean, exitShot?: CameraShot): void {
    if (this.tactical === active) return;
    this.tactical = active;
    this.callbacks.onTacticalView?.(active);

    if (active) {
      this.tacticalReturn = {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
      };
      this.strikeWorld();
      this.applyTacticalAtmosphere();
      for (const piece of this.allPieces()) piece.setFlat(true);
      this.alignTokens();

      this.controls.enableRotate = false;
      this.controls.autoRotate = false;
      this.controls.minDistance = 11;
      this.controls.maxDistance = 34;
      void this.flyTo(TACTICAL_SHOT, TACTICAL_FOV);
      return;
    }

    const look = ARENA_LOOKS[this.arena];
    this.restoreWorld();
    (this.scene.background as THREE.Color).setHex(look.background);
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) fog.density = look.fog.density;
    this.renderer.toneMappingExposure = look.exposure;
    for (const piece of this.allPieces()) piece.setFlat(false);

    this.controls.enableRotate = true;
    this.controls.minDistance = 4.5;
    this.controls.maxDistance = 17;
    const shot = exitShot ?? this.tacticalReturn ?? CAMERA_SHOTS.white;
    this.tacticalReturn = null;
    void this.flyTo(shot, DEFAULT_FOV);
  }

  /** Camera move that also eases the lens between the 3D and map framings. */
  private async flyTo(shot: CameraShot, fov: number): Promise<void> {
    const fromPosition = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    const fromFov = this.camera.fov;
    this.controls.enabled = false;
    await this.tweens.to({
      duration: 0.95,
      easing: Ease.inOutCubic,
      onUpdate: (t) => {
        this.camera.position.lerpVectors(fromPosition, shot.position, t);
        this.controls.target.lerpVectors(fromTarget, shot.target, t);
        this.camera.fov = fromFov + (fov - fromFov) * t;
        this.camera.updateProjectionMatrix();
      },
    });
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.controls.enabled = this.interactive;
  }

  /** A dark, theme-tinted void: no haze, nothing to read but the board. */
  private applyTacticalAtmosphere(): void {
    const look = ARENA_LOOKS[this.arena];
    (this.scene.background as THREE.Color).setHex(look.background).multiplyScalar(0.16);
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) fog.density = 0;
    this.renderer.toneMappingExposure = look.exposure * 1.12;
  }

  /**
   * Hides the staged world while keeping every light burning — the board still
   * has to be lit by the same key, fill and torches it had a moment ago.
   */
  private strikeWorld(): void {
    for (const group of [this.hall.group, this.battlefield.group, this.jungle.group]) {
      for (const child of group.children) {
        if ((child as THREE.Light).isLight || !child.visible) continue;
        child.visible = false;
        this.struck.push(child);
      }
    }
  }

  private restoreWorld(): void {
    for (const object of this.struck) object.visible = true;
    this.struck = [];
  }

  /**
   * Spins every counter so its stamped rank stays upright on screen, whichever
   * way the map has been turned.
   */
  private alignTokens(): void {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const yaw = Math.atan2(-up.x, -up.z);
    for (const piece of this.allPieces()) piece.setTokenYaw(yaw);
  }

  /** Every figure the engine currently owns, wherever it is in its life. */
  private *allPieces(): Generator<PieceView> {
    for (const piece of this.pieces.values()) yield piece;
    for (const piece of this.motion) yield piece;
    for (const piece of this.captured) yield piece;
  }

  /**
   * Orbit the camera around the board centre by `deltaTheta` radians, keeping
   * the current distance and elevation so the framing never jumps.
   */
  private async orbitBy(deltaTheta: number, duration: number): Promise<void> {
    if (this.orbiting) return;
    this.orbiting = true;
    const target = this.controls.target.clone();
    const spherical = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(target));
    const startTheta = spherical.theta;
    const wasEnabled = this.controls.enabled;
    this.controls.enabled = false;
    try {
      await this.tweens.to({
        duration,
        easing: Ease.inOutCubic,
        onUpdate: (t) => {
          spherical.theta = startTheta + deltaTheta * t;
          this.camera.position.copy(target.clone().add(new THREE.Vector3().setFromSpherical(spherical)));
          this.camera.lookAt(target);
        },
      });
    } finally {
      this.orbiting = false;
      this.controls.enabled = wasEnabled && this.interactive;
    }
  }

  /**
   * HUD control: spin the view a half turn so the player can read the board
   * from the opponent's side. Works from any preset or hand-dragged angle.
   */
  flipCamera(): void {
    if (this.orbiting) return;
    this.cameraFlipped = !this.cameraFlipped;
    this.callbacks.onCameraFlipped?.(this.cameraFlipped);
    void this.orbitBy(Math.PI, 0.95);
  }

  /** True when the view currently sits on the far side of its starting shot. */
  isCameraFlipped(): boolean {
    return this.cameraFlipped;
  }

  /** Hotseat: swing the camera round the board between turns. */
  private async swingCamera(): Promise<void> {
    await this.orbitBy(Math.PI, 1.15);
  }

  async playIntro(): Promise<void> {
    if (this.introPlaying) return;
    this.introPlaying = true;
    this.introSkipped = false;
    this.interactive = false;
    this.controls.enabled = false;
    this.postfx.setCinematic(true, 7);

    const path: CameraShot[] = [
      { position: new THREE.Vector3(13.5, 2.1, 12.5), target: new THREE.Vector3(5, 3.2, 3.5) },
      { position: new THREE.Vector3(8.5, 2.4, 10.5), target: new THREE.Vector3(0, 1.4, 0) },
      { position: new THREE.Vector3(2.6, 4.2, 9.6), target: new THREE.Vector3(0, 0.6, 0) },
      CAMERA_SHOTS.white,
    ];
    this.camera.position.copy(path[0].position);
    this.controls.target.copy(path[0].target);

    for (let i = 1; i < path.length; i += 1) {
      if (this.introSkipped) break;
      await this.moveCameraTo(path[i], i === path.length - 1 ? 2.2 : 2.4);
      this.controls.enabled = false;
    }

    this.camera.position.copy(CAMERA_SHOTS.white.position);
    this.controls.target.copy(CAMERA_SHOTS.white.target);
    this.postfx.setCinematic(false);
    this.introPlaying = false;
    this.interactive = true;
    this.controls.enabled = true;
  }

  skipIntro(): void {
    if (!this.introPlaying) return;
    this.introSkipped = true;
    this.tweens.cancelAll();
  }

  private async playEndCinematic(): Promise<void> {
    const snapshot = this.controller.getSnapshot();
    const result = snapshot.result;
    if (!result) return;
    audio.play("fanfare", 0.7);
    // The map holds its framing: no dolly, no depth of field.
    if (this.tactical) return;

    const loser: Faction | null = result.winner ? (result.winner === "w" ? "b" : "w") : null;
    let focus = new THREE.Vector3(0, 0.6, 0);
    if (loser) {
      for (const [square, piece] of this.pieces) {
        if (piece.kind === "k" && piece.color === loser) {
          focus = squareToWorld(square, 0.7);
          break;
        }
      }
    }
    this.postfx.setCinematic(true, Math.max(4, this.camera.position.distanceTo(focus) * 0.55));
    const direction = this.camera.position.clone().sub(focus).normalize();
    const shot: CameraShot = {
      position: focus.clone().add(direction.multiplyScalar(3.4)).setY(1.9),
      target: focus,
    };
    this.shake.add(0.35);
    await this.moveCameraTo(shot, 2.4);
  }

  // ---------------------------------------------------------------- promotion

  private buildPromotionPicker(color: Faction): void {
    this.closePromotionPicker();
    const group = new THREE.Group();
    const pedestalGeometry = new THREE.CylinderGeometry(0.42, 0.5, 0.2, 20);
    const pedestalMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a332a,
      roughness: 0.5,
      metalness: 0.7,
      emissive: 0x2a1c08,
      emissiveIntensity: 0.5,
    });

    PROMOTION_CHOICES.forEach((kind, index) => {
      const slot = new THREE.Group();
      slot.position.set((index - 1.5) * 1.35, 0, 0);
      const pedestal = new THREE.Mesh(pedestalGeometry, pedestalMaterial);
      pedestal.position.y = -0.1;
      pedestal.userData.promotion = kind;
      slot.add(pedestal);

      const view = this.factory.create(kind, color, {
        contactShadows: false,
        idleAnimation: true,
        rankBadge: false,
      });
      view.container.scale.setScalar(0.78);
      for (const mesh of view.hitMeshes) mesh.userData.promotion = kind;
      slot.add(view.container);
      this.promotionViews.push(view);
      group.add(slot);
    });

    group.position.set(0, 2.6, 0);
    this.scene.add(group);
    this.promotionGroup = group;
    this.postfx.setCinematic(true, this.camera.position.distanceTo(group.position));
    this.callbacks.onPromotionOpen(true);
  }

  private closePromotionPicker(): void {
    if (this.promotionGroup) {
      this.scene.remove(this.promotionGroup);
      this.promotionGroup.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) mesh.geometry.dispose();
      });
      this.promotionGroup = null;
    }
    for (const view of this.promotionViews) view.dispose();
    this.promotionViews = [];
    this.postfx.setCinematic(false);
    this.callbacks.onPromotionOpen(false);
  }

  private requestPromotion(color: Faction): Promise<PieceKind> {
    this.buildPromotionPicker(color);
    return new Promise<PieceKind>((resolve) => {
      this.promotionResolve = (kind) => {
        this.promotionResolve = null;
        this.closePromotionPicker();
        resolve(kind);
      };
    });
  }

  // -------------------------------------------------------------- interaction

  private bindEvents(): void {
    this.controls.addEventListener("start", this.onManualCamera);
    this.controls.addEventListener("change", this.onManualCameraChange);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("resize", this.handleResize);
    this.canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.onContextRestored);
  }

  private updatePointer(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  /**
   * Resolves what the pointer is over.
   *
   * Figures are life-size humans, so a sculpt covers the squares *behind* it on
   * screen. Testing the tiles alone therefore hands back the wrong square as
   * soon as the player clicks a figure's body — the click silently lands two
   * ranks further up the board. Every figure carries an invisible collider, and
   * whichever of collider/tile the ray reaches first wins.
   */
  private pickTarget(exclude?: PieceView | null): { square: SquareId | null; piece: PieceView | null } {
    const colliders: THREE.Mesh[] = [];
    for (const piece of this.pieces.values()) {
      if (piece === exclude) continue;
      colliders.push(...piece.hitMeshes);
    }
    const pieceHit = this.raycaster.intersectObjects(colliders, false)[0] ?? null;
    const tileHit = this.raycaster.intersectObjects(this.board.tiles, false)[0] ?? null;

    if (pieceHit && (!tileHit || pieceHit.distance <= tileHit.distance)) {
      const piece = (pieceHit.object.userData.piece as PieceView | undefined) ?? null;
      const square = piece ? this.squareOf(piece) : null;
      if (square) return { square, piece };
    }

    const square = tileHit
      ? ((tileHit.object.userData.square as SquareId | undefined) ?? null)
      : this.squareUnderRay();
    return { square, piece: square ? (this.pieces.get(square) ?? null) : null };
  }

  private squareUnderRay(): SquareId | null {
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.boardPlane, point)) return null;
    return worldToSquare(point.x, point.z);
  }

  private squareOf(piece: PieceView): SquareId | null {
    for (const [square, view] of this.pieces) {
      if (view === piece) return square;
    }
    return null;
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.interactive) return;
    this.updatePointer(event);

    if (this.dragging) {
      const point = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.boardPlane, point)) {
        this.dragging.piece.container.position.set(point.x, 0.42, point.z);
      }
      this.board.setHover(this.squareUnderRay());
      return;
    }

    if (this.promotionGroup) {
      this.board.setHover(null);
      return;
    }

    const { square: hoveredSquare, piece } = this.pickTarget();
    const snapshot = this.controller.getSnapshot();
    const canTouch =
      piece !== null && this.controller.isHumanTurn() && piece.color === snapshot.turn && snapshot.status === "playing";

    if (this.hoveredPiece && this.hoveredPiece !== piece) {
      this.hoveredPiece.setHovered(false);
      this.hoveredPiece = null;
    }
    if (canTouch && piece) {
      if (this.hoveredPiece !== piece) audio.blip("hover");
      piece.setHovered(true);
      this.hoveredPiece = piece;
    }

    this.board.setHover(hoveredSquare);
    this.canvas.style.cursor =
      canTouch || (this.selected && hoveredSquare !== null && this.legalTargets.has(hoveredSquare))
        ? "pointer"
        : "default";
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.interactive || event.button !== 0) return;
    this.updatePointer(event);

    if (this.promotionGroup) {
      const meshes: THREE.Object3D[] = [];
      this.promotionGroup.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) meshes.push(node);
      });
      const hits = this.raycaster.intersectObjects(meshes, false);
      let kind: PieceKind | undefined;
      for (const hit of hits) {
        let node: THREE.Object3D | null = hit.object;
        while (node && !kind) {
          kind = node.userData.promotion as PieceKind | undefined;
          node = node.parent;
        }
        if (kind) break;
      }
      if (kind && this.promotionResolve) {
        audio.blip("press");
        this.promotionResolve(kind);
      }
      return;
    }

    const { square, piece } = this.pickTarget();
    this.pointerDownAt = { x: event.clientX, y: event.clientY, square };
    if (!square) return;

    const snapshot = this.controller.getSnapshot();
    if (snapshot.status !== "playing" || !this.controller.isHumanTurn()) return;

    if (piece && piece.color === snapshot.turn) {
      this.select(square);
      this.dragging = { piece, from: square, origin: piece.container.position.clone() };
      this.controls.enabled = false;
      // Picking the figure up off the board: a dry, brighter tick, not a UI blip.
      audio.woodTap({
        pan: this.stereoPan(piece.container.position),
        weight: WOOD_WEIGHT[piece.kind],
        volume: 0.8,
        lift: true,
      });
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.interactive) return;
    const down = this.pointerDownAt;
    this.pointerDownAt = null;
    const drag = this.dragging;
    this.dragging = null;
    this.controls.enabled = this.interactive && !this.introPlaying;

    if (!down) return;
    this.updatePointer(event);
    const { square } = this.pickTarget(drag?.piece ?? null);
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y) > 8;

    if (drag) {
      if (moved) {
        // Drag and drop.
        if (square && square !== drag.from && this.legalTargets.has(square)) {
          void this.commitMove(drag.from, square);
        } else {
          drag.piece.container.position.copy(drag.origin);
          if (square && square !== drag.from) void this.rejectMove(drag.from);
        }
        return;
      }
      drag.piece.container.position.copy(drag.origin);
    }

    if (!square) {
      this.clearSelection();
      return;
    }

    if (this.selected && square !== this.selected) {
      if (this.legalTargets.has(square)) {
        void this.commitMove(this.selected, square);
        return;
      }
      const piece = this.pieces.get(square);
      const snapshot = this.controller.getSnapshot();
      if (piece && piece.color === snapshot.turn) this.select(square);
      else {
        void this.rejectMove(this.selected);
        this.clearSelection();
      }
      return;
    }

    if (this.selected === square && !drag) this.clearSelection();
  };

  private async commitMove(from: SquareId, to: SquareId): Promise<void> {
    let promotion: PieceKind | undefined;
    if (this.controller.isPromotion(from, to)) {
      const color = this.controller.getSnapshot().turn;
      this.clearSelection();
      promotion = await this.requestPromotion(color);
    }
    const ok = await this.controller.tryMove(from, to, promotion);
    if (!ok) void this.rejectMove(from);
  }

  private select(square: SquareId): void {
    this.previewing = false;
    this.clearSelection();
    const piece = this.pieces.get(square);
    if (!piece) return;
    this.selected = square;
    piece.setSelected(true);
    this.board.setHighlight(square, "select");

    // Legal squares ripple outward from the piece so the fan of options reads
    // as one motion instead of 20 markers blinking on at once.
    const origin = squareToWorld(square);
    const targets = this.controller.legalTargets(square).map((target) => ({
      ...target,
      distance: squareToWorld(target.to).distanceTo(origin),
    }));
    targets.sort((a, b) => a.distance - b.distance);
    for (const target of targets) {
      this.legalTargets.set(target.to, target.capture);
      const delay = Math.min(target.distance * 0.02, 0.14);
      // Colour-coded by move type: red for captures, violet for promotions,
      // azure for castling, emerald for a quiet advance.
      const kind: HighlightKind = target.capture
        ? "capture"
        : target.promotion
          ? "promote"
          : target.castle
            ? "castle"
            : "move";
      this.board.setHighlight(target.to, kind, target.capture || target.promotion, delay);
    }

    // Everything the piece cannot reach falls into shadow so the lit squares
    // are unmistakable even when several of them share a colour.
    this.board.setShroud([square, ...targets.map((target) => target.to)], square);
    if (targets.length > 0) audio.blip("hover");
  }

  private clearSelection(): void {
    if (this.selected) {
      const piece = this.pieces.get(this.selected);
      piece?.setSelected(false);
    }
    this.selected = null;
    this.legalTargets.clear();
    this.previewing = false;
    this.board.setShroud(null);
    this.restoreBaseHighlights();
  }

  /** Re-lights the ambient markers (last move, check) after a transient state. */
  private restoreBaseHighlights(): void {
    this.board.clearHighlights();
    const snapshot = this.controller.getSnapshot();
    if (snapshot.lastMove) {
      this.board.setHighlight(snapshot.lastMove.from, "last");
      this.board.setHighlight(snapshot.lastMove.to, "last");
    }
    this.applyCheckHighlight(snapshot);
  }

  /**
   * Lights the two squares of a move picked from the move ledger. Ignored while
   * a piece is selected so it never fights the legal-move markers.
   */
  previewMove(move: { from: SquareId; to: SquareId } | null): void {
    if (this.selected) return;
    if (!move) {
      if (!this.previewing) return;
      this.previewing = false;
      this.restoreBaseHighlights();
      return;
    }
    this.board.clearHighlights();
    this.board.setHighlight(move.from, "hint", true);
    this.board.setHighlight(move.to, "hint", true);
    this.previewing = true;
  }

  private applyCheckHighlight(snapshot: GameSnapshot): void {
    for (const piece of this.pieces.values()) piece.setAlarm(0);
    if (!snapshot.inCheck || snapshot.status !== "playing") return;
    for (const [square, piece] of this.pieces) {
      if (piece.kind === "k" && piece.color === snapshot.turn) {
        piece.setAlarm(1);
        this.board.setHighlight(square, "check", true);
        break;
      }
    }
  }

  private onState(snapshot: GameSnapshot): void {
    this.applyCheckHighlight(snapshot);
    const intensity = snapshot.inCheck ? 1 : snapshot.captured.length >= 12 ? 0.6 : 0;
    audio.setIntensity(intensity);
  }

  // ------------------------------------------------------------------ options

  /**
   * Switches the map the board is staged in. Every subsystem repaints in place
   * — no geometry is rebuilt — so the change lands within a single frame even
   * mid-game, and only the reflection probe is regenerated.
   */
  setArena(theme: ArenaTheme): void {
    if (theme === this.arena) return;
    this.arena = theme;
    const look = ARENA_LOOKS[theme];

    this.renderer.toneMappingExposure = look.exposure;
    (this.scene.background as THREE.Color).setHex(look.background);
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) {
      fog.color.setHex(look.fog.color);
      fog.density = look.fog.density;
    }

    this.hall.applyArena(look);
    this.battlefield.applyArena(look);
    this.jungle.applyArena(look);
    this.board.applyArena(look);
    this.postfx.setGrade(look.grade);
    this.postfx.setBloom(look.bloom);

    this.cameraLamp.color.setHex(look.lamp.color);
    this.cameraLamp.intensity = look.lamp.intensity;

    // Re-stage the strike against the new dressing, then put the void back.
    if (this.tactical) {
      this.restoreWorld();
      this.strikeWorld();
      this.applyTacticalAtmosphere();
    }

    const previous = this.scene.environment;
    this.scene.environment = buildEnvironmentMap(this.renderer, look);
    this.scene.environmentIntensity = look.environment.intensity;
    previous?.dispose();
  }

  /** The map currently staged. */
  getArena(): ArenaTheme {
    return this.arena;
  }

  setQuality(preset: QualityPreset): void {
    if (preset === this.preset) return;
    this.preset = preset;
    const settings = QUALITY_SETTINGS[preset];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.maxPixelRatio));
    this.renderer.shadowMap.enabled = settings.shadows;
    this.hall.applyQuality(preset);
    this.battlefield.applyQuality(preset);
    this.jungle.applyQuality(preset);
    this.postfx.setPreset(preset);
    this.handleResize();
    this.rebuildPieces();
    if (this.tactical) {
      this.restoreWorld();
      this.strikeWorld();
    }
  }

  /** Rebuilds every figure from the chess core (used after undo). */
  resync(): void {
    this.rebuildPieces();
    const snapshot = this.controller.getSnapshot();
    if (snapshot.lastMove) {
      this.board.setHighlight(snapshot.lastMove.from, "last");
      this.board.setHighlight(snapshot.lastMove.to, "last");
    }
    this.applyCheckHighlight(snapshot);
  }

  setCaptureCinematics(enabled: boolean): void {
    this.captureCinematics = enabled;
  }

  setRotateBoard(enabled: boolean): void {
    this.rotateBoard = enabled;
  }

  /** Floating rank crests above every figure on the board. */
  setRankBadges(enabled: boolean): void {
    if (this.rankBadges === enabled) return;
    this.rankBadges = enabled;
    for (const piece of this.pieces.values()) piece.setBadgeEnabled(enabled);
    for (const piece of this.motion) piece.setBadgeEnabled(enabled);
    for (const piece of this.captured) piece.setBadgeEnabled(enabled);
  }

  /**
   * Showcase presentation for computer-vs-computer demos: cinematic grading and
   * a slow orbit, while the viewer keeps full control of the camera.
   */
  setShowcase(active: boolean, orbitSpeed = 0.32): void {
    if (this.showcase === active && this.showcaseOrbitSpeed === orbitSpeed) return;
    this.showcase = active;
    this.showcaseOrbitSpeed = orbitSpeed;
    this.postfx.setCinematic(active, 9);
    if (!active) this.controls.autoRotate = false;
  }

  setAttract(active: boolean): void {
    this.attract = active;
    this.postfx.setCinematic(active, 10);
    if (active) {
      this.controls.enabled = false;
      void this.moveCameraTo(CAMERA_SHOTS.cinematic, 2);
    } else {
      this.controls.enabled = this.interactive;
    }
  }

  setInteractive(interactive: boolean): void {
    this.interactive = interactive;
    this.controls.enabled = interactive && !this.introPlaying && !this.attract;
    if (!interactive) {
      this.clearSelection();
      this.hoveredPiece?.setHovered(false);
      this.hoveredPiece = null;
    }
  }

  handleResize = (): void => {
    const parent = this.canvas.parentElement;
    const width = parent?.clientWidth ?? window.innerWidth;
    const height = parent?.clientHeight ?? window.innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.postfx.setSize(width, height);
  };

  private onManualCamera = (): void => {
    this.lastManualCameraAt = this.elapsed;
  };

  /** Damping keeps firing `change` after a drag; only count real user input. */
  private onManualCameraChange = (): void => {
    if (this.controls.autoRotate || this.orbiting) return;
    this.lastManualCameraAt = this.elapsed;
  };

  private onContextLost = (event: Event): void => {
    event.preventDefault();
    this.running = false;
    cancelAnimationFrame(this.frameId);
    this.callbacks.onContextLost();
  };

  private onContextRestored = (): void => {
    this.postfx.setPreset(this.preset);
    this.handleResize();
    this.start();
  };

  dispose(): void {
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.frameId);
    this.tweens.cancelAll();
    this.controller.setAnimator(null);
    this.controls.removeEventListener("start", this.onManualCamera);
    this.controls.removeEventListener("change", this.onManualCameraChange);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("resize", this.handleResize);
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.closePromotionPicker();
    for (const piece of this.pieces.values()) piece.dispose();
    for (const piece of this.captured) piece.dispose();
    this.pieces.clear();
    this.captured = [];
    this.effects.dispose();
    this.board.dispose();
    this.hall.dispose();
    this.battlefield.dispose();
    this.jungle.dispose();
    this.factory.dispose();
    this.postfx.dispose();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
