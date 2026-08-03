/**
 * Sorcery: the fire a caster gathers at the head of its staff and the ball it
 * throws across the board.
 *
 * A ball of fire is two additive billboards (a white-hot core inside a wide
 * flame envelope) plus — where the budget allows — a real point light, so the
 * bolt lights the hall, the board and the figure it is about to kill as it
 * travels. It lives in world space and is repositioned by the caller every
 * frame, which keeps it clear of the sculpt's animated bone scales.
 *
 * The light is *borrowed* from {@link SpellLightPool} and never created per
 * spell. three.js keys its shader programs on the number of visible lights in
 * the scene, so adding or removing one light forces every material in the hall
 * — thirty-two skinned figures with custom dissolve shaders among them — to
 * recompile. Doing that four times inside the sorceress' volley stalled the
 * frame loop for seconds and could take the WebGL context down with it.
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

/**
 * One point light borrowed out of the pool for the length of a single spell.
 * Releasing it only drops the intensity to zero — the light itself stays in the
 * scene graph and stays visible, so the renderer's light count never moves.
 */
export class SpellLight {
  private released = false;

  constructor(
    private readonly light: THREE.PointLight,
    private readonly onRelease: () => void,
  ) {}

  /** Places the flame and sets how hard it burns into the room. */
  set(position: THREE.Vector3, intensity: number): void {
    if (this.released) return;
    this.light.position.copy(position);
    this.light.intensity = Math.max(0, intensity);
  }

  /** Hands the slot back, dark. */
  release(): void {
    if (this.released) return;
    this.released = true;
    this.light.intensity = 0;
    this.onRelease();
  }
}

/**
 * A fixed set of point lights added to the scene once and reused by every
 * spell, judgement column and blast. Only colour, position and intensity ever
 * change, all of which are plain uniforms — so no shader is ever recompiled
 * mid-fight. When every slot is out on loan the caller simply goes unlit rather
 * than growing the set.
 */
export class SpellLightPool {
  private readonly lights: THREE.PointLight[] = [];
  private readonly free: number[] = [];

  constructor(parent: THREE.Object3D, count: number) {
    for (let i = 0; i < count; i += 1) {
      const light = new THREE.PointLight(0xffffff, 0, 5.2, 2);
      light.name = `spell_light_${i}`;
      // Never hidden: an invisible light is dropped from the render state, which
      // changes the light count exactly as removing it would.
      light.visible = true;
      light.castShadow = false;
      parent.add(light);
      this.lights.push(light);
      this.free.push(i);
    }
  }

  get size(): number {
    return this.lights.length;
  }

  /** Takes a slot, or null when the fight is already using them all. */
  acquire(color: number, distance = 5.2): SpellLight | null {
    const index = this.free.pop();
    if (index === undefined) return null;
    const light = this.lights[index];
    light.color.setHex(color);
    light.distance = distance;
    light.intensity = 0;
    return new SpellLight(light, () => {
      this.free.push(index);
    });
  }

  dispose(): void {
    for (const light of this.lights) {
      light.removeFromParent();
      light.dispose();
    }
    this.lights.length = 0;
    this.free.length = 0;
  }
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
  private readonly light: SpellLight | null;
  private readonly size: number;
  private intensity = 0;

  constructor(look: SpellLook, size: number, light: SpellLight | null = null) {
    this.size = size;
    this.light = light;
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
    this.light?.set(this.group.position, t * t * 11);
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
    this.light?.set(this.group.position, this.intensity * this.intensity * 11 * flicker);
  }

  dispose(): void {
    this.light?.release();
    (this.core.material as THREE.Material).dispose();
    (this.flame.material as THREE.Material).dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
