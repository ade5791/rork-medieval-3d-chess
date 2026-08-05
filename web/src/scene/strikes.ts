/**
 * The visual language of a heavy blow.
 *
 * A footsoldier's kill is sparks and a shove; the ranks above it hit hard
 * enough to leave something behind — steel cutting the air, a wave rolling out
 * across the stone, or a column of light dropped on the condemned before the
 * crown even swings. Each helper builds its own throwaway object, animates it
 * off the caller's tween clock and disposes itself, so nothing here needs a
 * slot in the frame loop.
 */

import * as THREE from "three";

import { rng } from "../core/rng";
import type { SpellLight } from "./spells";

const strikeRng = rng.fork("scene:strikes");
import { crescentTexture, pillarTexture, shockwaveTexture } from "./textures";
import { Ease, type TweenManager } from "./tween";

let crescentMap: THREE.CanvasTexture | null = null;
let waveMap: THREE.CanvasTexture | null = null;
let pillarMap: THREE.CanvasTexture | null = null;
let waveGeometry: THREE.PlaneGeometry | null = null;
let pillarGeometry: THREE.CylinderGeometry | null = null;

function sharedCrescentMap(): THREE.CanvasTexture {
  if (!crescentMap) crescentMap = crescentTexture();
  return crescentMap;
}

function sharedWaveMap(): THREE.CanvasTexture {
  if (!waveMap) waveMap = shockwaveTexture();
  return waveMap;
}

function sharedPillarMap(): THREE.CanvasTexture {
  if (!pillarMap) pillarMap = pillarTexture();
  return pillarMap;
}

function sharedWaveGeometry(): THREE.PlaneGeometry {
  if (!waveGeometry) waveGeometry = new THREE.PlaneGeometry(2, 2);
  return waveGeometry;
}

function sharedPillarGeometry(): THREE.CylinderGeometry {
  if (!pillarGeometry) pillarGeometry = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true);
  return pillarGeometry;
}

/** Frees the shared maps and geometry (scene teardown). */
export function disposeStrikeAssets(): void {
  crescentMap?.dispose();
  waveMap?.dispose();
  pillarMap?.dispose();
  waveGeometry?.dispose();
  pillarGeometry?.dispose();
  crescentMap = null;
  waveMap = null;
  pillarMap = null;
  waveGeometry = null;
  pillarGeometry = null;
}

export interface SlashOptions {
  /** Colour of the steel — cold white for a blade, gold for the crown. */
  color: number;
  /** Width of the arc in world units. */
  size: number;
  /** In-plane angle of the swing, in radians. */
  tilt?: number;
  /** How long the arc stays on screen. */
  life?: number;
}

/**
 * The cut itself: a crescent of light thrown through the body on the frame the
 * blade lands, swinging a little further and stretching as it fades — a
 * billboard, so it reads from any camera angle on the board.
 */
export async function spawnSlash(
  scene: THREE.Object3D,
  tweens: TweenManager,
  at: THREE.Vector3,
  options: SlashOptions,
): Promise<void> {
  const life = options.life ?? 0.22;
  const tilt = options.tilt ?? -0.7;
  const material = new THREE.SpriteMaterial({
    map: sharedCrescentMap(),
    color: options.color,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    opacity: 1,
    rotation: tilt,
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(at);
  sprite.renderOrder = 8;
  sprite.frustumCulled = false;
  sprite.scale.set(options.size * 0.72, options.size * 0.72, 1);
  scene.add(sprite);

  try {
    await tweens.to({
      duration: life,
      easing: Ease.outCubic,
      onUpdate: (t) => {
        // Opens fast, keeps travelling as it thins out.
        const spread = options.size * (0.72 + t * 0.66);
        sprite.scale.set(spread, spread * (1 - t * 0.22), 1);
        material.rotation = tilt + t * 0.85;
        material.opacity = t < 0.18 ? t / 0.18 : Math.pow(1 - (t - 0.18) / 0.82, 1.6);
      },
    });
  } finally {
    sprite.removeFromParent();
    material.dispose();
  }
}

export interface GroundWaveOptions {
  color: number;
  /** Radius the wave reaches, in world units. */
  radius: number;
  /** Height of the plane above the floor. */
  height: number;
  life?: number;
  /** Second, wider echo rolling out behind the first. */
  echo?: boolean;
}

/**
 * Force going into the floor: a ring of light rolling outward from the point of
 * impact and dying as it widens. What a hammer or a sceptre leaves behind — a
 * blade never gets one.
 */
export async function spawnGroundWave(
  scene: THREE.Object3D,
  tweens: TweenManager,
  at: THREE.Vector3,
  options: GroundWaveOptions,
): Promise<void> {
  const life = options.life ?? 0.5;
  const material = new THREE.MeshBasicMaterial({
    map: sharedWaveMap(),
    color: options.color,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.95,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(sharedWaveGeometry(), material);
  ring.rotation.x = -Math.PI / 2;
  ring.rotation.z = strikeRng.next() * Math.PI;
  ring.position.set(at.x, options.height, at.z);
  ring.renderOrder = 7;
  ring.scale.setScalar(0.18);
  scene.add(ring);

  const echo = options.echo === true ? ring.clone() : null;
  let echoMaterial: THREE.MeshBasicMaterial | null = null;
  if (echo) {
    echoMaterial = material.clone();
    echoMaterial.opacity = 0.5;
    echo.material = echoMaterial;
    echo.position.y = options.height + 0.004;
    scene.add(echo);
  }

  try {
    await tweens.to({
      duration: life,
      easing: Ease.linear,
      onUpdate: (t) => {
        const eased = 1 - Math.pow(1 - t, 2.4);
        ring.scale.setScalar(0.18 + eased * options.radius * 0.5);
        material.opacity = Math.pow(1 - t, 1.6) * 0.95;
        ring.rotation.z += 0.006;
        if (echo && echoMaterial) {
          // The echo leaves later and travels further, so the stone reads as
          // still ringing after the blow.
          const lag = Math.max(0, (t - 0.22) / 0.78);
          const spread = 1 - Math.pow(1 - lag, 2.2);
          echo.scale.setScalar(0.18 + spread * options.radius * 0.76);
          echoMaterial.opacity = Math.pow(1 - lag, 2) * 0.45;
        }
      },
    });
  } finally {
    ring.removeFromParent();
    material.dispose();
    if (echo) {
      echo.removeFromParent();
      echoMaterial?.dispose();
    }
  }
}

export interface PillarOptions {
  color: number;
  /** Radius of the column at the floor. */
  radius: number;
  /** How far it climbs out of frame. */
  height: number;
  /** Floor level the column stands on. */
  floor: number;
  /** How long it holds over the condemned before it lets go. */
  hold: number;
  /**
   * A light borrowed from the scene's spell-light pool, or null to run the
   * column unlit. Never create one here: changing the scene's light count
   * recompiles every material in the hall.
   */
  light: SpellLight | null;
}

/**
 * Judgement: a column of light dropped straight down onto a square, held while
 * the sentence is carried out, then pulled back up into nothing. Reserved for
 * the crown — nothing else on the board is allowed to summon it.
 */
export async function spawnPillar(
  scene: THREE.Object3D,
  tweens: TweenManager,
  at: THREE.Vector3,
  options: PillarOptions,
): Promise<void> {
  const material = new THREE.MeshBasicMaterial({
    map: sharedPillarMap(),
    color: options.color,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0,
    side: THREE.DoubleSide,
  });
  const column = new THREE.Mesh(sharedPillarGeometry(), material);
  column.renderOrder = 6;
  column.position.set(at.x, options.floor + options.height * 0.5, at.z);
  column.scale.set(options.radius, options.height, options.radius);
  scene.add(column);

  const light = options.light;
  const lightAt = new THREE.Vector3(at.x, options.floor + 0.9, at.z);

  const setSpread = (radius: number, opacity: number): void => {
    column.scale.set(radius, options.height, radius);
    material.opacity = opacity;
    light?.set(lightAt, opacity * 9);
  };

  try {
    // Slams down wide, then snaps tight around the body.
    await tweens.to({
      duration: 0.16,
      easing: Ease.outQuint,
      onUpdate: (t) => setSpread(options.radius * (2.4 - t * 1.4), t * 0.95),
    });
    // Held: the light breathes rather than sitting there as a decal.
    await tweens.to({
      duration: Math.max(0.05, options.hold),
      easing: Ease.linear,
      onUpdate: (t) => {
        const pulse = 1 + Math.sin(t * Math.PI * 6) * 0.06;
        setSpread(options.radius * pulse, 0.95 - t * 0.12);
      },
    });
    // Withdrawn upward, thinning as it goes.
    await tweens.to({
      duration: 0.32,
      easing: Ease.inCubic,
      onUpdate: (t) => {
        column.scale.set(options.radius * (1 - t * 0.55), options.height, options.radius * (1 - t * 0.55));
        material.opacity = 0.83 * (1 - t);
        light?.set(lightAt, 7.5 * (1 - t));
      },
    });
  } finally {
    column.removeFromParent();
    material.dispose();
    light?.release();
  }
}
