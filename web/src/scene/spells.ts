/**
 * Sorcery: the fire a caster gathers at the head of its staff and the ball it
 * throws across the board.
 *
 * A ball of fire is two additive billboards (a white-hot core inside a wide
 * flame envelope) plus — where the budget allows — a real point light, so the
 * bolt lights the hall, the board and the figure it is about to kill as it
 * travels. It lives in world space and is repositioned by the caller every
 * frame, which keeps it clear of the sculpt's animated bone scales.
 */

import * as THREE from "three";

import type { Faction } from "../core/types";
import { radialTexture } from "./textures";

/** How one civilisation's magic burns. */
export interface SpellLook {
  /** The white-hot centre. */
  core: number;
  /** The flame envelope around it. */
  flame: number;
  /** Motes shed while it gathers and flies. */
  ember: number;
  /** Colour it throws into the room. */
  light: number;
}

/**
 * The ivory kingdom burns cold — witchfire off a crystal staff. The Sun Empire
 * throws a piece of the sun itself.
 */
export const SPELL_LOOK: Record<Faction, SpellLook> = {
  w: { core: 0xf4f9ff, flame: 0x4f9cff, ember: 0xbcd8ff, light: 0x7cb8ff },
  b: { core: 0xfff0c6, flame: 0xff5f18, ember: 0xff9a3c, light: 0xff7a2a },
};

let coreMap: THREE.CanvasTexture | null = null;
function sharedCoreMap(): THREE.CanvasTexture {
  if (!coreMap) coreMap = radialTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)");
  return coreMap;
}

let flameMap: THREE.CanvasTexture | null = null;
function sharedFlameMap(): THREE.CanvasTexture {
  if (!flameMap) flameMap = radialTexture("rgba(255,255,255,0.75)", "rgba(255,255,255,0)");
  return flameMap;
}

/** A single ball of fire: gathering at a staff head, or in flight. */
export class SpellOrb {
  readonly group = new THREE.Group();

  private readonly core: THREE.Sprite;
  private readonly flame: THREE.Sprite;
  private readonly light: THREE.PointLight | null = null;
  private readonly size: number;
  private intensity = 0;

  constructor(look: SpellLook, size: number, withLight: boolean) {
    this.size = size;
    this.group.name = "spell_orb";

    this.flame = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sharedFlameMap(),
        color: look.flame,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      }),
    );
    this.core = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sharedCoreMap(),
        color: look.core,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      }),
    );
    this.flame.renderOrder = 6;
    this.core.renderOrder = 7;
    this.flame.frustumCulled = false;
    this.core.frustumCulled = false;
    this.group.add(this.flame, this.core);

    if (withLight) {
      this.light = new THREE.PointLight(look.light, 0, 4.6, 2);
      this.group.add(this.light);
    }

    this.setIntensity(0);
  }

  /** 0 = nothing there, 1 = a fully formed ball, above 1 = overcharged. */
  setIntensity(value: number): void {
    const t = THREE.MathUtils.clamp(value, 0, 1.6);
    this.intensity = t;
    this.core.scale.setScalar(this.size * (0.3 + t * 0.6));
    this.flame.scale.setScalar(this.size * (0.8 + t * 2));
    (this.core.material as THREE.SpriteMaterial).opacity = Math.min(1, t * 1.5);
    (this.flame.material as THREE.SpriteMaterial).opacity = Math.min(0.92, t * 0.8);
    if (this.light) this.light.intensity = t * t * 11;
  }

  /**
   * Fire is never still: the envelope flickers on two beats and rolls slowly,
   * so a held charge does not read as a decal pinned to the staff.
   */
  animate(time: number): void {
    const flicker = 1 + Math.sin(time * 33) * 0.08 + Math.sin(time * 57 + 1.4) * 0.05;
    this.flame.scale.setScalar(this.size * (0.8 + this.intensity * 2) * flicker);
    const material = this.flame.material as THREE.SpriteMaterial;
    material.rotation = time * 2.2;
    if (this.light) this.light.intensity = this.intensity * this.intensity * 11 * flicker;
  }

  dispose(): void {
    (this.core.material as THREE.Material).dispose();
    (this.flame.material as THREE.Material).dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
