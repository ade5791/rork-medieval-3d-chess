import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

import {
  PIECE_ANIMATED_MODELS,
  PIECE_MODEL_ORIENTATION,
  PIECE_MODEL_URLS,
  type PieceAnimationSet,
} from "../assets/generated";
import type { Faction, PieceKind } from "../core/types";
import { BADGE_LIFT, BADGE_SCALE, TOKEN_SCALE, rankBadgeTexture, tacticalTokenTexture } from "./rankBadges";
import { radialTexture } from "./textures";
import { Ease, type TweenManager } from "./tween";
import { attachWeapons, type AttachedArms } from "./weapons";

/** Rendered height (world units, 1 unit = 1 board square) per piece kind. */
export const PIECE_HEIGHT: Record<PieceKind, number> = {
  p: 0.7,
  n: 0.86,
  b: 0.88,
  r: 0.84,
  q: 1.0,
  k: 1.12,
};

export const FACTION_ACCENT: Record<Faction, number> = {
  w: 0x6ea8ff,
  b: 0xff5a4a,
};

/** Light that burns along the dissolving edge — one hue per civilisation. */
const DISSOLVE_EMBER: Record<Faction, number> = {
  w: 0xa8ccff,
  b: 0xff7a32,
};

/** Shared uniform block driving one figure's burn-away across all its materials. */
interface DissolveUniforms {
  uDissolve: { value: number };
  uDissolveEdge: { value: number };
  uDissolveScale: { value: number };
  /** (sole line, figure height) in the sculpt's own units. */
  uDissolveSpan: { value: THREE.Vector2 };
  uDissolveEmber: { value: THREE.Color };
}

/** Cheap trilinear value noise — two octaves are enough for a burn edge. */
const DISSOLVE_NOISE = `
float dvHash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}
float dvNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = dvHash(i);
  float n100 = dvHash(i + vec3(1.0, 0.0, 0.0));
  float n010 = dvHash(i + vec3(0.0, 1.0, 0.0));
  float n110 = dvHash(i + vec3(1.0, 1.0, 0.0));
  float n001 = dvHash(i + vec3(0.0, 0.0, 1.0));
  float n101 = dvHash(i + vec3(1.0, 0.0, 1.0));
  float n011 = dvHash(i + vec3(0.0, 1.0, 1.0));
  float n111 = dvHash(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}
`;

/**
 * Injects a noise burn-away into a lit material. The surface erodes through a
 * drifting noise field with a hot rim riding the edge, so a fallen figure comes
 * apart into the air instead of blinking out.
 *
 * @param heightBias how much the burn sweeps from the soles upward (0 = even)
 */
function installDissolve(
  material: THREE.MeshStandardMaterial,
  uniforms: DissolveUniforms,
  heightBias: number,
): void {
  const bias = heightBias.toFixed(3);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vDissolveP;")
      .replace(
        "#include <project_vertex>",
        "vDissolveP = transformed;\n#include <project_vertex>",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uDissolve;
uniform float uDissolveEdge;
uniform float uDissolveScale;
uniform vec2 uDissolveSpan;
uniform vec3 uDissolveEmber;
varying vec3 vDissolveP;
${DISSOLVE_NOISE}`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
float dvGlow = 0.0;
if (uDissolve > 0.001) {
  vec3 dvP = vDissolveP * uDissolveScale;
  float dvN = dvNoise(dvP) * 0.65 + dvNoise(dvP * 2.7 + 11.3) * 0.35;
  float dvH = clamp((vDissolveP.y - uDissolveSpan.x) / max(uDissolveSpan.y, 0.0001), 0.0, 1.0);
  float dvMask = mix(dvN, dvN * 0.45 + dvH * 0.55, ${bias});
  float dvCut = mix(-uDissolveEdge, 1.0 + uDissolveEdge, uDissolve);
  if (dvMask < dvCut) discard;
  dvGlow = (1.0 - smoothstep(0.0, uDissolveEdge * 1.6, dvMask - dvCut)) *
           smoothstep(0.0, 0.06, uDissolve);
}`,
      )
      .replace(
        "#include <opaque_fragment>",
        "#include <opaque_fragment>\ngl_FragColor.rgb += uDissolveEmber * dvGlow * 3.2;",
      );
  };
  // Two materials with identical parameters but different injected source would
  // otherwise share one compiled program.
  material.customProgramCacheKey = () => `dissolve-${bias}`;
  material.needsUpdate = true;
}

const AXIS_VECTORS = {
  positiveX: new THREE.Vector3(1, 0, 0),
  negativeX: new THREE.Vector3(-1, 0, 0),
  positiveY: new THREE.Vector3(0, 1, 0),
  negativeY: new THREE.Vector3(0, -1, 0),
  positiveZ: new THREE.Vector3(0, 0, 1),
  negativeZ: new THREE.Vector3(0, 0, -1),
} as const;

type AxisName = keyof typeof AXIS_VECTORS;

function basisQuaternion(front: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
  const f = front.clone().normalize();
  const r = new THREE.Vector3().crossVectors(up, f).normalize();
  const u = new THREE.Vector3().crossVectors(f, r).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, f));
}

/**
 * Rotates a generated model so its classified local front axis points along
 * `desiredWorldForward` while its local up axis stays world up.
 */
function orientationCorrection(desiredWorldForward: THREE.Vector3): THREE.Quaternion {
  const local = basisQuaternion(
    AXIS_VECTORS[PIECE_MODEL_ORIENTATION.localFrontAxis as AxisName],
    AXIS_VECTORS[PIECE_MODEL_ORIENTATION.localUpAxis as AxisName],
  );
  const world = basisQuaternion(desiredWorldForward, new THREE.Vector3(0, 1, 0));
  return world.multiply(local.invert());
}

/** Bounds as actually rendered, skinning-aware (see three-js asset guide). */
function measureModel(object: THREE.Object3D): THREE.Box3 {
  object.updateMatrixWorld(true);
  const rootInverse = object.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const childBox = new THREE.Box3();
  const toRoot = new THREE.Matrix4();
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const skinned = node as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      skinned.skeleton.update();
      skinned.computeBoundingBox();
      childBox.copy(skinned.boundingBox ?? new THREE.Box3());
    } else {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      childBox.copy(mesh.geometry.boundingBox ?? new THREE.Box3());
    }
    toRoot.multiplyMatrices(rootInverse, mesh.matrixWorld);
    box.union(childBox.applyMatrix4(toRoot));
  });
  return box;
}

/** Skeletal clips a figure can play, all bound to the same auto-rig. */
export interface PieceClips {
  idle?: THREE.AnimationClip;
  attack?: THREE.AnimationClip;
  death?: THREE.AnimationClip;
  /** Looping in-place stride used to cross the board on foot. */
  walk?: THREE.AnimationClip;
  /** Looping in-place run — the knight charging through its leap. */
  run?: THREE.AnimationClip;
}

type ClipName = keyof PieceClips;

/** The two locomotion loops, as opposed to the stance and the one-shots. */
export type MarchClip = "walk" | "run";

interface Template {
  scene: THREE.Object3D;
  scale: number;
  offset: THREE.Vector3;
  skinned: boolean;
  clips: PieceClips;
  /** Figure height in the sculpt's own units — the weapon size reference. */
  unit: number;
  /** Sole line in the sculpt's own units, so props can be kept off the floor. */
  baseY: number;
  /**
   * True when the sculpt was authored for this exact army. Those keep their own
   * painted textures; shared sculpts are re-tinted into faction livery instead.
   */
  ownLivery: boolean;
}

export interface PieceVisualOptions {
  contactShadows: boolean;
  /** Loop the combat stance. One-shots (strike / death) always play. */
  idleAnimation?: boolean;
  /** Floating rank crest above the figure's head. */
  rankBadge?: boolean;
}

/** The crown: king and queen move slower and stand taller than the soldiery. */
const ROYAL_KINDS: PieceKind[] = ["k", "q"];

/**
 * Target playback lengths. Soldiers snap through their strike; royalty takes a
 * long, deliberate beat so the blow reads as a sentence, not a scuffle.
 */
function oneShotSeconds(kind: PieceKind, name: "attack" | "death"): number {
  const royal = ROYAL_KINDS.includes(kind);
  if (name === "attack") return royal ? 1.5 : 0.95;
  return royal ? 1.15 : 0.85;
}

/**
 * One rendered figure. Follows the placement contract:
 * container (board placement) → runtime (idle sway, strikes) → visual
 * (one-time scale / orientation / centring of the generated sculpt).
 */
export class PieceView {
  readonly container = new THREE.Group();
  readonly runtime = new THREE.Group();
  readonly visual = new THREE.Group();
  readonly kind: PieceKind;
  readonly color: Faction;

  private materials: THREE.MeshStandardMaterial[] = [];
  private baseEmissive = 0.05;
  private glow: THREE.Mesh;
  private shadow: THREE.Mesh | null = null;
  private phase = Math.random() * Math.PI * 2;
  private hovered = false;
  private selected = false;
  private alarm = 0;
  /** 1 right after a blow lands, decaying — drives the red hit flash. */
  private hit = 0;
  /** 1 right after the figure sets down, decaying — flares the ground aura. */
  private aura = 0;
  /** Set once the death clip starts so nothing pulls the corpse back up. */
  private slain = false;
  /** Resting orientation (facing the enemy side) to return to after a fight. */
  private homeFacing = new THREE.Quaternion();
  /**
   * Invisible pick proxy. Raycasting the sculpt itself is both slow (tens of
   * thousands of skinned triangles per figure) and unreliable, so every figure
   * carries one cheap box that stands exactly on its square.
   */
  private readonly collider: THREE.Mesh;

  private arms: AttachedArms | null = null;
  private readonly majestic: boolean;

  /** Every mesh of the sculpt and its arms — shadows are pulled while burning. */
  private meshes: THREE.Mesh[] = [];
  /** 0 solid → 1 fully scattered. Drives the burn-away shader. */
  private dissolveAmount = 0;
  private readonly dissolveUniforms: DissolveUniforms;

  /**
   * Flat overhead counter used by the tactical view. Built the first time the
   * board is flattened, then kept for the rest of the figure's life.
   */
  private token: THREE.Mesh | null = null;
  private tokenMaterial: THREE.MeshBasicMaterial | null = null;
  /** True while the board is read from straight above as a 2D map. */
  private flat = false;
  /** Ease between sculpt and counter, so the swap is not a hard cut. */
  private tokenFade = 0;
  /** In-plane spin that keeps the stamped rank upright on screen. */
  private tokenYaw = 0;

  /** Floating rank crest; billboards itself because it is a sprite. */
  private badge: THREE.Sprite | null = null;
  private badgeWanted = true;
  private badgeOpacity = 0;
  /** Global fade applied by the tray / death choreography. */
  private fade = 1;

  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<ClipName, THREE.AnimationAction>();
  private activeOneShot: ClipName | null = null;
  private idleLooping = false;
  /** Locomotion loop currently carrying the figure across the board. */
  private marchLoop: MarchClip | null = null;
  /** Root bone + its bind translation, used to strip clip root motion. */
  private rootBone: THREE.Bone | null = null;
  private rootRest = new THREE.Vector3();
  private lockRootMotion = true;

  constructor(
    kind: PieceKind,
    color: Faction,
    model: THREE.Object3D,
    options: PieceVisualOptions,
    clips: PieceClips = {},
    unit = 1,
    baseY = 0,
    ownLivery = false,
  ) {
    this.kind = kind;
    this.color = color;
    this.majestic = ROYAL_KINDS.includes(kind);

    this.container.name = `piece_${color}${kind}`;
    this.container.add(this.runtime);
    this.runtime.add(this.visual);
    this.visual.add(model);
    this.container.userData.piece = this;

    this.collider = new THREE.Mesh(sharedColliderGeometry(kind), sharedColliderMaterial());
    this.collider.position.y = PIECE_HEIGHT[kind] * 0.55;
    this.collider.castShadow = false;
    this.collider.receiveShadow = false;
    this.collider.userData.piece = this;
    this.container.add(this.collider);

    const span = Math.max(unit, 1e-3);
    this.dissolveUniforms = {
      uDissolve: { value: 0 },
      uDissolveEdge: { value: 0.14 },
      // Roughly ten noise cells across the body, whatever units it was authored in.
      uDissolveScale: { value: 10 / span },
      uDissolveSpan: { value: new THREE.Vector2(baseY, span) },
      uDissolveEmber: { value: new THREE.Color(DISSOLVE_EMBER[color]) },
    };

    model.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.piece = this;
      const source = mesh.material as THREE.MeshStandardMaterial;
      const material = source.clone();
      applyFactionLook(material, color, ownLivery);
      installDissolve(material, this.dissolveUniforms, 0.85);
      mesh.material = material;
      this.materials.push(material);
      this.meshes.push(mesh);
    });

    const accent = FACTION_ACCENT[color];
    const glowMaterial = new THREE.MeshBasicMaterial({
      map: sharedGlowTexture(),
      color: accent,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glow = new THREE.Mesh(sharedDiscGeometry(), glowMaterial);
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.012;
    this.glow.renderOrder = 3;
    this.container.add(this.glow);

    if (options.contactShadows) {
      const shadowMaterial = new THREE.MeshBasicMaterial({
        map: sharedShadowTexture(),
        color: 0x000000,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      });
      this.shadow = new THREE.Mesh(sharedDiscGeometry(), shadowMaterial);
      this.shadow.rotation.x = -Math.PI / 2;
      this.shadow.position.y = 0.006;
      this.shadow.scale.setScalar(0.85);
      this.shadow.renderOrder = 1;
      this.container.add(this.shadow);
    }

    this.badgeWanted = options.rankBadge !== false;
    this.buildBadge();

    this.setupAnimations(model, clips, options.idleAnimation !== false);
    this.equipArms(model, unit, baseY);
  }

  /** Crest sprite, parked just above the figure's crown. */
  private buildBadge(): void {
    const material = new THREE.SpriteMaterial({
      map: rankBadgeTexture(this.kind, this.color),
      transparent: true,
      // Always legible: a crest hidden behind the piece in front of it would
      // defeat the whole point of putting it there.
      depthTest: false,
      depthWrite: false,
      opacity: 0,
      sizeAttenuation: true,
    });
    const badge = new THREE.Sprite(material);
    badge.scale.setScalar(BADGE_SCALE[this.kind]);
    badge.position.y = PIECE_HEIGHT[this.kind] + BADGE_LIFT;
    badge.renderOrder = 40;
    badge.visible = this.badgeWanted;
    badge.frustumCulled = false;
    this.badge = badge;
    this.container.add(badge);
  }

  /** Board-wide toggle for the floating crests. */
  setBadgeEnabled(enabled: boolean): void {
    this.badgeWanted = enabled;
    if (!this.badge) return;
    this.badge.visible = enabled && !this.slain;
    if (!enabled) {
      this.badgeOpacity = 0;
      (this.badge.material as THREE.SpriteMaterial).opacity = 0;
    }
  }

  // ------------------------------------------------------------ tactical view

  /**
   * Swaps the sculpt for a flat overhead counter. In the top-down view a
   * life-size figure hides the squares around it, so the tactical board trades
   * every statue for a painted disc lying on its tile.
   */
  setFlat(enabled: boolean): void {
    if (this.flat === enabled) return;
    this.flat = enabled;
    if (enabled && !this.token) this.buildToken();
    this.visual.visible = !enabled;
    if (this.shadow) this.shadow.visible = !enabled;
    if (this.badge) this.badge.visible = !enabled && this.badgeWanted && !this.slain;
    if (this.token) this.token.visible = enabled;
    // A strike frozen mid-clip while the board was flat has to be released.
    if (!enabled && !this.slain && this.mixer) this.playIdle(0.2);
  }

  /** Screen-up direction, in board yaw — keeps every stamped rank readable. */
  setTokenYaw(yaw: number): void {
    this.tokenYaw = yaw;
  }

  private buildToken(): void {
    const material = new THREE.MeshBasicMaterial({
      map: tacticalTokenTexture(this.kind, this.color),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      // The counter is an instrument, not lit stone: keep it out of the grade.
      toneMapped: false,
    });
    const token = new THREE.Mesh(sharedTokenGeometry(), material);
    token.rotation.x = -Math.PI / 2;
    token.position.y = 0.055;
    token.scale.setScalar(TOKEN_SCALE[this.kind]);
    token.renderOrder = 12;
    token.frustumCulled = false;
    token.visible = false;
    this.token = token;
    this.container.add(token);
    this.tokenMaterial = material;
  }

  private updateToken(delta: number, alarmPulse: number): void {
    const token = this.token;
    const material = this.tokenMaterial;
    if (!token || !material) return;

    if (this.flat) this.tokenFade = Math.min(1, this.tokenFade + delta * 5);
    else this.tokenFade = Math.max(0, this.tokenFade - delta * 7);

    token.visible = this.tokenFade > 0.01;
    if (!token.visible) return;

    token.rotation.z = this.tokenYaw;
    const settle = this.aura * this.aura;
    const pop =
      1 + (this.selected ? 0.14 : this.hovered ? 0.07 : 0) + alarmPulse * 0.2 + settle * 0.16;
    token.scale.setScalar(TOKEN_SCALE[this.kind] * pop * this.tokenFade);
    token.position.y = 0.055 + (this.selected ? 0.05 : 0);

    // Blows and the check alarm burn straight through the plate.
    const heat = Math.min(1, this.hit * this.hit + alarmPulse * 0.7);
    material.color.setRGB(1 + heat * 1.1, 1 - heat * 0.5, 1 - heat * 0.6);
    material.opacity = this.tokenFade * this.fade * (1 - this.dissolveAmount);
  }

  private updateBadge(delta: number, elapsed: number, alarmPulse: number): void {
    const badge = this.badge;
    if (!badge) return;
    const visible = this.badgeWanted && !this.slain && !this.flat;
    badge.visible = visible;
    if (!visible) return;

    const target = this.selected ? 1 : this.hovered ? 0.95 : 0.72;
    this.badgeOpacity += (target - this.badgeOpacity) * Math.min(1, delta * 6);
    const material = badge.material as THREE.SpriteMaterial;
    material.opacity = this.badgeOpacity * this.fade;

    const bob = Math.sin(elapsed * 1.5 + this.phase) * 0.022;
    badge.position.y =
      PIECE_HEIGHT[this.kind] + BADGE_LIFT + bob + (this.selected ? 0.05 : 0);
    const pop = 1 + (this.selected ? 0.16 : this.hovered ? 0.08 : 0) + alarmPulse * 0.22;
    badge.scale.setScalar(BADGE_SCALE[this.kind] * pop);
  }

  /**
   * Hands the figure its weapon once the stance pose is settled, so the prop is
   * aligned against the pose the player actually sees.
   */
  private equipArms(model: THREE.Object3D, unit: number, baseY: number): void {
    try {
      this.mixer?.update(0);
      const arms = attachWeapons(model, this.kind, this.color, unit, baseY);
      this.arms = arms;
      for (const mesh of arms.meshes) mesh.userData.piece = this;
      // Props hang off bones, so they burn on the same clock but without the
      // ground-up sweep — their local space is not the figure's.
      for (const material of arms.materials) installDissolve(material, this.dissolveUniforms, 0);
      this.meshes.push(...arms.meshes);
    } catch (error) {
      console.warn(`[pieces] could not arm "${this.kind}"`, error);
    }
  }

  private setupAnimations(model: THREE.Object3D, clips: PieceClips, idleEnabled: boolean): void {
    const entries = (Object.keys(clips) as ClipName[]).filter((name) => clips[name]);
    if (entries.length === 0) return;

    model.traverse((node) => {
      const bone = node as THREE.Bone;
      if (bone.isBone && !this.rootBone) {
        this.rootBone = bone;
        this.rootRest.copy(bone.position);
      }
      const skinned = node as THREE.SkinnedMesh;
      // Skinned bounds change every frame; culling them by the bind pose pops.
      if (skinned.isSkinnedMesh) skinned.frustumCulled = false;
    });

    this.mixer = new THREE.AnimationMixer(model);
    for (const name of entries) {
      const clip = clips[name];
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      this.actions.set(name, action);
    }

    // A finished strike returns to the stance on its own; death stays clamped.
    this.mixer.addEventListener("finished", (event) => {
      const action = (event as unknown as { action: THREE.AnimationAction }).action;
      if (this.activeOneShot === "attack" && action === this.actions.get("attack")) {
        this.playIdle(0.2);
      }
    });

    if (idleEnabled) this.playIdle(0);
    else this.poseFromIdle();
  }

  get hasAnimations(): boolean {
    return this.mixer !== null;
  }

  /** Whether this sculpt actually carries a given clip (rigs differ per rank). */
  hasClip(name: ClipName): boolean {
    return this.actions.has(name);
  }

  get isMarching(): boolean {
    return this.marchLoop !== null;
  }

  /**
   * Puts the figure on its own legs for a board move. `stepRate` is how many
   * footfalls a second the march should take; the clip is one full gait cycle
   * (two steps), so it is retimed to that cadence and the caller's stride clock
   * and the skeleton stay locked to each other. Returns false when the sculpt
   * has no such clip, so the caller can fall back to a slide.
   */
  startMarch(name: MarchClip, stepRate: number): boolean {
    const action = this.actions.get(name);
    if (!action || !this.mixer || this.slain) return false;
    const clip = action.getClip();
    const cycles = Math.max(0.15, stepRate * 0.5);
    // Clamped so a very long or very short move never turns the stride into a
    // slideshow or a sprint of blurred legs.
    const timeScale = THREE.MathUtils.clamp(cycles * clip.duration, 0.4, 2.8);

    for (const [key, other] of this.actions) {
      if (key !== name) other.fadeOut(0.16);
    }
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.paused = false;
    action.setEffectiveTimeScale(timeScale);
    action.setEffectiveWeight(1);
    action.fadeIn(0.14).play();

    this.activeOneShot = null;
    this.idleLooping = false;
    this.marchLoop = name;
    this.lockRootMotion = true;
    return true;
  }

  /** Ends the march and eases the figure back into its combat stance. */
  stopMarch(fade = 0.22): void {
    if (!this.marchLoop) return;
    this.playIdle(fade);
  }

  /** Freezes the first stance frame so "low" quality still reads as a fighter. */
  private poseFromIdle(): void {
    const idle = this.actions.get("idle");
    if (!idle || !this.mixer) return;
    idle.reset().play();
    idle.paused = true;
    this.mixer.update(0);
  }

  /** Crossfades back to the looping combat stance. */
  playIdle(fade = 0.25): void {
    // A stride left running underneath would blend into the stance and keep the
    // legs walking on the spot.
    if (this.marchLoop) {
      this.actions.get(this.marchLoop)?.fadeOut(Math.max(0.06, fade));
      this.marchLoop = null;
    }
    const idle = this.actions.get("idle");
    if (!idle) return;
    this.activeOneShot = null;
    this.lockRootMotion = true;
    if (this.idleLooping && idle.isRunning()) return;
    idle.reset();
    idle.setLoop(THREE.LoopRepeat, Infinity);
    idle.clampWhenFinished = false;
    idle.paused = false;
    // Desync the army so the whole board does not breathe in lockstep.
    idle.time = Math.random() * idle.getClip().duration;
    // Royalty holds the room: a slower, heavier breath than the soldiery.
    idle.setEffectiveTimeScale(
      this.majestic ? 0.52 + Math.random() * 0.08 : 0.9 + Math.random() * 0.2,
    );
    idle.fadeIn(fade).play();
    this.idleLooping = true;
  }

  private playOneShot(name: "attack" | "death"): number {
    const action = this.actions.get(name);
    if (!action || !this.mixer) return 0;
    const clip = action.getClip();
    const target = oneShotSeconds(this.kind, name);
    const timeScale = THREE.MathUtils.clamp(
      clip.duration / target,
      this.majestic ? 0.45 : 0.75,
      this.majestic ? 1.6 : 2.6,
    );
    const duration = clip.duration / timeScale;

    for (const [key, other] of this.actions) {
      if (key !== name) other.fadeOut(0.1);
    }
    this.marchLoop = null;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.paused = false;
    action.setEffectiveTimeScale(timeScale);
    action.setEffectiveWeight(1);
    action.fadeIn(0.08).play();

    this.activeOneShot = name;
    this.idleLooping = false;
    this.lockRootMotion = name !== "death";
    return duration;
  }

  /**
   * Starts the strike clip. Returns the playback length and the moment the
   * blade lands, so the caller can time sparks, sound and screen shake.
   */
  playAttack(): { duration: number; impact: number } {
    const duration = this.playOneShot("attack");
    // The royal wind-up is longer, so the blow lands later in the clip.
    return { duration, impact: duration * (this.majestic ? 0.56 : 0.42) };
  }

  /**
   * Starts the death clip and returns how long it runs. The figure is marked
   * slain so hover/selection lift, sway and the idle stance stop interfering
   * with the fall — the corpse holds the last frame until it is cleared away.
   */
  playDeath(): number {
    this.slain = true;
    this.marchLoop = null;
    this.hovered = false;
    this.selected = false;
    this.alarm = 0;
    this.collider.visible = false;
    if (this.badge) {
      this.badge.visible = false;
      this.badgeOpacity = 0;
      (this.badge.material as THREE.SpriteMaterial).opacity = 0;
    }
    return this.playOneShot("death");
  }

  /**
   * Lifts the figure off the floor plane: the contact shadow and team glow are
   * discs pinned to the ground, so they have to go while the body is in the air.
   */
  setAirborne(airborne: boolean): void {
    this.glow.visible = !airborne;
    if (this.shadow) this.shadow.visible = !airborne && !this.flat;
  }

  /** Back to a calm stance (used when a fallen figure reaches the tray). */
  resetPose(): void {
    this.slain = false;
    this.setDissolve(0);
    this.hit = 0;
    this.aura = 0;
    this.collider.visible = true;
    this.visual.scale.set(1, 1, 1);
    if (this.badge) this.badge.visible = this.badgeWanted;
    this.setAirborne(false);
    this.runtime.position.set(0, 0, 0);
    this.runtime.rotation.set(0, 0, 0);
    this.container.scale.setScalar(1);
    this.visual.quaternion.copy(this.homeFacing);
    if (!this.mixer) return;
    for (const action of this.actions.values()) action.stop();
    this.activeOneShot = null;
    this.idleLooping = false;
    this.marchLoop = null;
    this.lockRootMotion = true;
    this.container.rotation.set(0, 0, 0);
    this.playIdle(0);
  }

  get object(): THREE.Object3D {
    return this.container;
  }

  /** What the pointer tests against — never the sculpt itself. */
  get hitMeshes(): THREE.Mesh[] {
    return [this.collider];
  }

  setHovered(hovered: boolean): void {
    this.hovered = hovered;
  }

  setSelected(selected: boolean): void {
    this.selected = selected;
  }

  /** 0 = calm, 1 = king in check (red pulse). */
  setAlarm(value: number): void {
    this.alarm = value;
  }

  /** White-hot red flash across the figure at the moment a blow connects. */
  takeHit(): void {
    this.hit = 1;
  }

  /**
   * Vertical squash used by the landing settle: 0 stands the figure up, 1 is
   * fully compressed. Applied to the sculpt only, so the ground discs, crest
   * and board anchor all stay exactly where they belong.
   */
  setSquash(amount: number): void {
    const value = THREE.MathUtils.clamp(amount, -0.6, 1) * 0.15;
    this.visual.scale.set(1 + value * 0.6, 1 - value, 1 + value * 0.6);
  }

  /** Flares the team aura disc under the figure — the moment it takes a square. */
  flareAura(strength = 1): void {
    this.aura = Math.max(this.aura, THREE.MathUtils.clamp(strength, 0, 1.5));
  }

  get isSlain(): boolean {
    return this.slain;
  }

  /** Snaps the figure round to look at a world position (its killer, a target). */
  faceTowards(point: THREE.Vector3): void {
    const forward = point.clone().sub(this.container.position);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) return;
    this.setFacing(forward.normalize(), false);
  }

  /** Smoothly swings the figure round to face a world position. */
  async turnTowards(point: THREE.Vector3, tweens: TweenManager, duration = 0.22): Promise<void> {
    const forward = point.clone().sub(this.container.position);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) return;
    await this.turnTo(orientationCorrection(forward.normalize()), tweens, duration);
  }

  /** Swings back to the resting orientation once the fighting is over. */
  async turnHome(tweens: TweenManager, duration = 0.28): Promise<void> {
    await this.turnTo(this.homeFacing.clone(), tweens, duration);
  }

  private async turnTo(to: THREE.Quaternion, tweens: TweenManager, duration: number): Promise<void> {
    const from = this.visual.quaternion.clone();
    if (from.angleTo(to) < 0.04) return;
    await tweens.to({
      duration,
      easing: Ease.inOutCubic,
      onUpdate: (t) => {
        this.visual.quaternion.slerpQuaternions(from, to, t);
      },
    });
    this.visual.quaternion.copy(to);
  }

  /**
   * Burn-away amount: 0 leaves the figure solid, 1 scatters it completely. The
   * body erodes from the soles up through a noise field with a glowing rim, so
   * a captured figure comes apart into the air rather than being switched off.
   */
  setDissolve(amount: number): void {
    const value = THREE.MathUtils.clamp(amount, 0, 1);
    if (this.dissolveAmount === value) return;
    const wasSolid = this.dissolveAmount <= 0.02;
    this.dissolveAmount = value;
    this.dissolveUniforms.uDissolve.value = value;
    // A shadow map knows nothing about the burn, so a half-eaten body would
    // keep casting a whole one. Drop the cast the moment it starts to go.
    const solid = value <= 0.02;
    if (solid !== wasSolid) {
      for (const mesh of this.meshes) mesh.castShadow = solid;
    }
  }

  get dissolveLevel(): number {
    return this.dissolveAmount;
  }

  setOpacity(value: number): void {
    this.fade = value;
    for (const material of this.materials) {
      material.transparent = value < 1;
      material.opacity = value;
      material.depthWrite = value > 0.6;
    }
    if (this.arms) {
      for (const material of this.arms.materials) {
        material.transparent = value < 1;
        material.opacity = value;
        material.depthWrite = value > 0.6;
      }
    }
    const glowMaterial = this.glow.material as THREE.MeshBasicMaterial;
    glowMaterial.opacity = 0.16 * value;
    if (this.shadow) (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.55 * value;
    if (this.badge) {
      (this.badge.material as THREE.SpriteMaterial).opacity = this.badgeOpacity * value;
    }
    if (this.tokenMaterial) this.tokenMaterial.opacity = this.tokenFade * value;
  }

  /**
   * Points the figure along `forward`. `remember` stores it as the resting
   * orientation the figure returns to after a combat turn.
   */
  setFacing(forward: THREE.Vector3, remember = true): void {
    const quaternion = orientationCorrection(forward);
    this.visual.quaternion.copy(quaternion);
    if (remember) this.homeFacing.copy(quaternion);
  }

  update(delta: number, elapsed: number): void {
    this.hit = Math.max(0, this.hit - delta * 2.4);
    this.aura = Math.max(0, this.aura - delta * 1.8);

    if (this.slain) {
      this.updateSlain(delta);
      return;
    }

    const breath = Math.sin(elapsed * (this.majestic ? 0.7 : 1.15) + this.phase);
    const sway = Math.sin(elapsed * (this.majestic ? 0.42 : 0.7) + this.phase * 1.7);
    const lift = this.selected
      ? this.majestic
        ? 0.11
        : 0.16
      : this.hovered
        ? this.majestic
          ? 0.05
          : 0.075
        : 0;

    if (this.flat) {
      // Nothing of the sculpt is on screen: skip the skeleton entirely and just
      // let the figure stand back up under its counter.
      this.runtime.position.y += (0 - this.runtime.position.y) * Math.min(1, delta * 9);
    } else if (this.mixer) {
      this.mixer.update(delta);
      if (this.rootBone && this.lockRootMotion) {
        // Keep the figure planted on its square; clips carry their own steps.
        this.rootBone.position.x = this.rootRest.x;
        this.rootBone.position.z = this.rootRest.z;
      }
      this.runtime.position.y += (lift - this.runtime.position.y) * Math.min(1, delta * 9);
      this.runtime.rotation.z = 0;
      this.runtime.rotation.x = 0;
    } else {
      // Fallback figures keep the procedural breath and weight shift.
      const amplitude = this.majestic ? 0.45 : 1;
      this.runtime.position.y +=
        (lift + breath * 0.006 * amplitude - this.runtime.position.y) * Math.min(1, delta * 9);
      this.runtime.rotation.z = sway * 0.012 * amplitude;
      this.runtime.rotation.x = breath * 0.008 * amplitude;
    }

    const target = this.selected ? 0.5 : this.hovered ? 0.32 : 0.06;
    const alarmPulse = this.alarm > 0 ? (Math.sin(elapsed * 7) * 0.5 + 0.5) * this.alarm : 0;
    const hitGlow = this.hit * this.hit * 2.6;
    for (const material of this.materials) {
      const value = this.baseEmissive + target * 0.9 + alarmPulse * 1.5 + hitGlow;
      material.emissiveIntensity += (value - material.emissiveIntensity) * Math.min(1, delta * 8);
      if (this.hit > 0.02) material.emissive.setHex(0xff3418);
      else if (this.alarm > 0) material.emissive.setHex(0xff2a1a);
      else material.emissive.setHex(this.color === "w" ? 0x2a4d94 : 0x711a12);
    }
    if (this.arms) {
      // Steel and gems answer the same highlight, but keep their own hues.
      const boost = target * 0.8 + alarmPulse * 1.2;
      this.arms.materials.forEach((material, index) => {
        const base = this.arms?.baseEmissive[index] ?? 0;
        const value = base + boost * (base > 1 ? 0.6 : 1);
        material.emissiveIntensity += (value - material.emissiveIntensity) * Math.min(1, delta * 8);
      });
    }
    const glowMaterial = this.glow.material as THREE.MeshBasicMaterial;
    const settle = this.aura * this.aura;
    const glowTarget =
      0.16 + (this.selected ? 0.45 : this.hovered ? 0.28 : 0) + alarmPulse * 0.5 + settle * 0.55;
    glowMaterial.opacity += (glowTarget - glowMaterial.opacity) * Math.min(1, delta * 8);
    this.glow.scale.setScalar(1 + (this.selected ? 0.16 : 0) + alarmPulse * 0.25 + settle * 0.5);

    this.updateBadge(delta, elapsed, alarmPulse);
    this.updateToken(delta, alarmPulse);
  }

  /**
   * A dying figure runs only its skeleton and the fading hit flash: no breath,
   * no hover lift, no team glow — the fall has to read as a fall.
   */
  private updateSlain(delta: number): void {
    if (!this.flat) this.mixer?.update(delta);
    this.updateToken(delta, 0);
    const hitGlow = this.hit * this.hit * 3;
    for (const material of this.materials) {
      const value = this.baseEmissive + hitGlow;
      material.emissiveIntensity += (value - material.emissiveIntensity) * Math.min(1, delta * 10);
      material.emissive.setHex(this.hit > 0.02 ? 0xff3418 : this.color === "w" ? 0x2a4d94 : 0x711a12);
    }
    if (this.arms) {
      this.arms.materials.forEach((material, index) => {
        const base = this.arms?.baseEmissive[index] ?? 0;
        material.emissiveIntensity += (base - material.emissiveIntensity) * Math.min(1, delta * 10);
      });
    }
    const glowMaterial = this.glow.material as THREE.MeshBasicMaterial;
    glowMaterial.opacity = Math.max(0, glowMaterial.opacity - delta * 0.6);
  }

  dispose(): void {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot() as THREE.Object3D);
      this.mixer = null;
    }
    this.actions.clear();
    for (const material of this.materials) material.dispose();
    this.materials = [];
    if (this.arms) {
      // Weapon geometry is shared across the army; only the materials are ours.
      for (const material of this.arms.materials) material.dispose();
      this.arms = null;
    }
    (this.glow.material as THREE.Material).dispose();
    if (this.shadow) (this.shadow.material as THREE.Material).dispose();
    if (this.badge) {
      (this.badge.material as THREE.Material).dispose();
      this.badge = null;
    }
    if (this.tokenMaterial) {
      this.tokenMaterial.dispose();
      this.tokenMaterial = null;
      this.token = null;
    }
    this.container.removeFromParent();
    this.container.clear();
  }
}

function applyFactionLook(
  material: THREE.MeshStandardMaterial,
  color: Faction,
  ownLivery: boolean,
): void {
  if (ownLivery && material.map) {
    // The sculpt was painted for this army — feathers, jade and gold would be
    // destroyed by a flat tint, so only the surface response is touched.
    material.color.setHex(0xffffff);
    material.roughness = Math.min(0.85, material.roughness * 0.9 + 0.18);
    material.metalness = Math.max(0.08, Math.min(0.4, material.metalness));
    material.emissive = new THREE.Color(color === "w" ? 0x2a4d94 : 0x711a12);
    material.emissiveIntensity = 0.05;
    material.envMapIntensity = 1.05;
    material.needsUpdate = true;
    return;
  }
  if (color === "w") {
    material.color.setHex(0xfff2dd);
    material.roughness = 0.34;
    material.metalness = 0.1;
    material.emissive = new THREE.Color(0x2a4d94);
  } else {
    material.color.setHex(0x34363d);
    material.roughness = 0.3;
    material.metalness = 0.55;
    material.emissive = new THREE.Color(0x711a12);
  }
  material.emissiveIntensity = 0.05;
  material.envMapIntensity = 1.15;
  material.needsUpdate = true;
}

const colliderGeometries = new Map<PieceKind, THREE.BoxGeometry>();
function sharedColliderGeometry(kind: PieceKind): THREE.BoxGeometry {
  let geometry = colliderGeometries.get(kind);
  if (!geometry) {
    geometry = new THREE.BoxGeometry(0.86, PIECE_HEIGHT[kind] * 1.1, 0.86);
    colliderGeometries.set(kind, geometry);
  }
  return geometry;
}

let colliderMaterial: THREE.MeshBasicMaterial | null = null;
function sharedColliderMaterial(): THREE.MeshBasicMaterial {
  // `visible: false` keeps the box out of every render pass while the
  // raycaster still hits it.
  if (!colliderMaterial) colliderMaterial = new THREE.MeshBasicMaterial({ visible: false });
  return colliderMaterial;
}

let discGeometry: THREE.PlaneGeometry | null = null;
function sharedDiscGeometry(): THREE.PlaneGeometry {
  if (!discGeometry) discGeometry = new THREE.PlaneGeometry(0.95, 0.95);
  return discGeometry;
}

let tokenGeometry: THREE.PlaneGeometry | null = null;
function sharedTokenGeometry(): THREE.PlaneGeometry {
  if (!tokenGeometry) tokenGeometry = new THREE.PlaneGeometry(1, 1);
  return tokenGeometry;
}

let glowTexture: THREE.Texture | null = null;
function sharedGlowTexture(): THREE.Texture {
  if (!glowTexture) glowTexture = radialTexture("rgba(255,255,255,0.9)", "rgba(255,255,255,0)");
  return glowTexture;
}

let shadowTexture: THREE.Texture | null = null;
function sharedShadowTexture(): THREE.Texture {
  if (!shadowTexture) shadowTexture = radialTexture("rgba(0,0,0,0.85)", "rgba(0,0,0,0)");
  return shadowTexture;
}

/** One army's roster key — the ivory kingdom or the Sun Empire. */
type TemplateKey = `${Faction}${PieceKind}`;

type LoadedGltf = Awaited<ReturnType<GLTFLoader["loadAsync"]>>;

/**
 * Download budget for the sculpts. Twelve rigs with five clips each is over
 * seventy GLBs; firing them all at once made the browser drop requests
 * (`TypeError: Failed to fetch`), which silently cost figures their strike and
 * death clips — a capture then skipped the attack entirely. Everything now
 * queues through a small window and is retried before it is given up on.
 */
const MAX_PARALLEL_DOWNLOADS = 6;
let activeDownloads = 0;
const downloadQueue: (() => void)[] = [];

async function withDownloadSlot<T>(job: () => Promise<T>): Promise<T> {
  while (activeDownloads >= MAX_PARALLEL_DOWNLOADS) {
    await new Promise<void>((resolve) => downloadQueue.push(resolve));
  }
  activeDownloads += 1;
  try {
    return await job();
  } finally {
    activeDownloads -= 1;
    downloadQueue.shift()?.();
  }
}

/** Queued GLB fetch with exponential back-off — transient drops are retried. */
async function loadGltf(loader: GLTFLoader, url: string, attempts = 3): Promise<LoadedGltf> {
  let last: unknown = new Error(`could not load ${url}`);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await withDownloadSlot(() => loader.loadAsync(url));
    } catch (error) {
      last = error;
      if (attempt === attempts - 1) break;
      // Jittered back-off so a whole army does not retry on the same frame.
      const delay = 240 * 2 ** attempt + Math.random() * 200;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
  throw last;
}

/**
 * Loads every generated sculpt once, normalises each to its board height and
 * hands out cheap clones.
 *
 * The two armies are different civilisations, so each faction has its own six
 * sculpts. A faction with no roster of its own (or one whose download fails)
 * falls back to the other army's sculpt, then to a procedural figure — the
 * board always fills, whatever the network does.
 */
export class PieceFactory {
  private templates = new Map<TemplateKey, Template>();
  private loader = new GLTFLoader();
  private loaded = false;

  get isReady(): boolean {
    return this.loaded;
  }

  async load(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const kinds = Object.keys(PIECE_MODEL_URLS.w) as PieceKind[];
    const factions: Faction[] = ["w", "b"];
    const jobs: { faction: Faction; kind: PieceKind }[] = [];
    for (const faction of factions) {
      for (const kind of kinds) {
        // Only load a second roster where the faction really owns a sculpt.
        if (faction === "b" && !PIECE_MODEL_URLS.b[kind]) continue;
        jobs.push({ faction, kind });
      }
    }

    let done = 0;
    await Promise.all(
      jobs.map(async ({ faction, kind }) => {
        try {
          this.templates.set(`${faction}${kind}`, await this.loadRoster(faction, kind));
        } catch (error) {
          console.warn(`[pieces] no sculpt for "${faction}${kind}"`, error);
        } finally {
          done += 1;
          onProgress?.(done, jobs.length);
        }
      }),
    );

    // Anything still missing borrows the other army's figure.
    for (const kind of kinds) {
      for (const faction of factions) {
        if (this.templates.has(`${faction}${kind}`)) continue;
        const other = this.templates.get(`${faction === "w" ? "b" : "w"}${kind}`);
        if (other) this.templates.set(`${faction}${kind}`, { ...other, ownLivery: false });
        else this.templates.set(`${faction}${kind}`, this.normalize(buildProceduralFigure(kind), kind, {}, false));
      }
    }
    this.loaded = true;
  }

  /** Rigged sculpt when the army has one, else its static GLB. */
  private async loadRoster(faction: Faction, kind: PieceKind): Promise<Template> {
    const animated = PIECE_ANIMATED_MODELS[faction][kind];
    const still = PIECE_MODEL_URLS[faction][kind];
    if (animated) {
      try {
        return await this.loadAnimated(kind, animated);
      } catch (error) {
        console.warn(`[pieces] rig failed for "${faction}${kind}", using the still sculpt`, error);
      }
    }
    if (!still) throw new Error(`no sculpt url for ${faction}${kind}`);
    const gltf = await loadGltf(this.loader, still);
    return this.normalize(gltf.scene, kind, {}, true);
  }

  /**
   * Rigged sculpt + one GLB per clip. The clips share the auto-rig skeleton, so
   * they bind straight onto the rigged scene — no retargeting.
   */
  private async loadAnimated(kind: PieceKind, set: PieceAnimationSet): Promise<Template> {
    const rigged = await loadGltf(this.loader, set.rigged, 4);
    const names: (keyof PieceClips)[] = ["idle", "attack", "death", "walk", "run"];
    // The combat beat is built on these two: losing either turns a capture into
    // a figure that dies without ever being struck, so they get extra attempts.
    const critical: (keyof PieceClips)[] = ["attack", "death"];
    const clips: PieceClips = {};
    await Promise.all(
      names.map(async (name) => {
        const url = set[name];
        if (!url) return;
        try {
          const gltf = await loadGltf(this.loader, url, critical.includes(name) ? 5 : 3);
          const source = gltf.animations[0];
          if (!source) return;
          const clip = source.clone();
          clip.name = name;
          clips[name] = clip;
        } catch (error) {
          console.warn(`[pieces] clip "${name}" missing for "${kind}"`, error);
        }
      }),
    );
    return this.normalize(rigged.scene, kind, clips, true);
  }

  private normalize(
    scene: THREE.Object3D,
    kind: PieceKind,
    clips: PieceClips,
    ownLivery: boolean,
  ): Template {
    const box = measureModel(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const height = Math.max(0.0001, size.y);
    const scale = PIECE_HEIGHT[kind] / height;

    const centre = new THREE.Vector3();
    box.getCenter(centre);
    const offset = new THREE.Vector3(-centre.x * scale, -box.min.y * scale, -centre.z * scale);

    let skinned = false;
    scene.traverse((node) => {
      if ((node as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
    });

    return { scene, scale, offset, skinned, clips, unit: height, baseY: box.min.y, ownLivery };
  }

  create(kind: PieceKind, color: Faction, options: PieceVisualOptions): PieceView {
    const template = this.templates.get(`${color}${kind}`);
    if (!template) throw new Error(`piece template "${color}${kind}" not loaded`);

    // Skinned meshes must never share a skeleton between instances.
    const model = template.skinned ? SkeletonUtils.clone(template.scene) : template.scene.clone(true);
    model.scale.setScalar(template.scale);
    model.position.copy(template.offset);

    const view = new PieceView(
      kind,
      color,
      model,
      options,
      template.clips,
      template.unit,
      template.baseY,
      template.ownLivery,
    );
    view.setFacing(new THREE.Vector3(0, 0, color === "w" ? -1 : 1));
    return view;
  }

  dispose(): void {
    for (const template of this.templates.values()) {
      template.scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material.dispose();
      });
    }
    this.templates.clear();
  }
}

/**
 * Primitive-built humanoid used only if a generated sculpt fails to download —
 * head, torso, arms and a kind-specific silhouette so the game stays playable.
 */
export function buildProceduralFigure(kind: PieceKind): THREE.Object3D {
  const group = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xe8e0cf, roughness: 0.5, metalness: 0.1 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.12, 20), stone);
  base.position.y = 0.06;
  group.add(base);

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.44, 6, 14), stone);
  body.position.y = 0.48;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 14), stone);
  head.position.y = 0.88;
  group.add(head);

  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.3, 4, 8), stone);
    arm.position.set(side * 0.23, 0.55, 0);
    arm.rotation.z = side * 0.24;
    group.add(arm);
  }

  if (kind === "k" || kind === "q") {
    const crown = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.11, kind === "k" ? 0.16 : 0.1, 8, 1, true),
      stone,
    );
    crown.position.y = kind === "k" ? 1.03 : 0.99;
    group.add(crown);
  }
  if (kind === "b") {
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.3, 12), stone);
    hood.position.y = 0.94;
    group.add(hood);
  }
  if (kind === "r") {
    const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.18, 8), stone);
    helm.position.y = 1;
    group.add(helm);
  }
  if (kind === "n") {
    const plume = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 8), stone);
    plume.position.set(0, 1.04, -0.02);
    group.add(plume);
  }
  return group;
}
