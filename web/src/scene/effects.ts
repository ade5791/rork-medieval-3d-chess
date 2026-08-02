import * as THREE from "three";

import { radialTexture, smokeTexture, sparkTexture } from "./textures";

interface Burst {
  points: THREE.Points;
  velocities: Float32Array;
  life: number;
  maxLife: number;
  gravity: number;
  size: number;
  growth: number;
  drag: number;
}

export interface BurstOptions {
  speed?: number;
  life?: number;
  /** Downward pull. Negative floats the specks upward like ash. */
  gravity?: number;
  /** Scatter radius around the spawn point. */
  radius?: number;
  /** Starting point size. */
  size?: number;
  /** Size multiplier reached at the end of life. */
  growth?: number;
  /** Constant upward push added to every speck. */
  rise?: number;
  /** Air resistance; 0 keeps the initial kick for the whole life. */
  drag?: number;
}

interface Flash {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  scale: number;
}

/** One billboarded smoke lobe. Plumes are just a handful of these. */
interface Puff {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  spin: number;
  delay: number;
  life: number;
  maxLife: number;
  from: number;
  to: number;
  peak: number;
  buoyancy: number;
}

export interface SmokeOptions {
  /** Number of lobes in the plume. */
  count?: number;
  /** Radius the lobes are scattered over. */
  radius?: number;
  /** Starting sprite size. */
  scale?: number;
  /** How much each lobe swells over its life. */
  growth?: number;
  life?: number;
  /** Outward push. */
  speed?: number;
  /** Upward acceleration — how hard the plume boils up. */
  rise?: number;
  color?: number;
  opacity?: number;
  /** Constant drift added to every lobe (wind, knock-back direction). */
  drift?: THREE.Vector3;
}

/** Hard ceiling so a rapid streak of captures can never flood the scene. */
const MAX_PUFFS = 220;

/**
 * Transient combat FX: dust puffs, sparks and impact flashes.
 * Everything is pooled back into the scene graph and disposed on teardown.
 */
export class EffectsSystem {
  readonly group = new THREE.Group();

  private bursts: Burst[] = [];
  private flashes: Flash[] = [];
  private puffs: Puff[] = [];
  private sparkMap = sparkTexture();
  private flashMap = radialTexture("rgba(255,240,200,0.95)", "rgba(255,150,60,0)");
  private smokeMap = smokeTexture();

  constructor() {
    this.group.name = "effects";
  }

  /** Dust/ember puff — used when a figure crumbles or a strike lands. */
  spawnBurst(position: THREE.Vector3, color: number, count: number, options?: BurstOptions): void {
    if (count <= 0) return;
    const speed = options?.speed ?? 2.2;
    const life = options?.life ?? 0.9;
    const radius = options?.radius ?? 0;
    const rise = options?.rise ?? 0;
    const size = options?.size ?? 0.13;

    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const scatterTheta = Math.random() * Math.PI * 2;
      const scatter = radius * Math.pow(Math.random(), 0.55);
      positions[i * 3] = position.x + Math.cos(scatterTheta) * scatter;
      positions[i * 3 + 1] = position.y + (Math.random() - 0.5) * radius * 1.4;
      positions[i * 3 + 2] = position.z + Math.sin(scatterTheta) * scatter;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.9);
      const magnitude = speed * (0.35 + Math.random() * 0.85);
      velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * magnitude;
      velocities[i * 3 + 1] = Math.abs(Math.cos(phi)) * magnitude * 1.15 + rise * (0.5 + Math.random());
      velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * magnitude;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      size,
      map: this.sparkMap,
      color,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.group.add(points);
    this.bursts.push({
      points,
      velocities,
      life: 0,
      maxLife: life,
      gravity: options?.gravity ?? 3.4,
      size,
      growth: options?.growth ?? 1.9,
      drag: options?.drag ?? 0,
    });
  }

  /** Bright additive pop at the point of impact. */
  spawnFlash(position: THREE.Vector3, scale = 1.6, life = 0.28): void {
    const material = new THREE.SpriteMaterial({
      map: this.flashMap,
      color: 0xfff0c8,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 1,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.setScalar(scale * 0.4);
    this.group.add(sprite);
    this.flashes.push({ sprite, life: 0, maxLife: life, scale });
  }

  /**
   * Boiling smoke plume: soft lobes that swell, drift and rise while fading.
   * Used for the body being swallowed / hurled away on a capture.
   */
  spawnSmoke(position: THREE.Vector3, options?: SmokeOptions): void {
    const count = Math.max(0, Math.round(options?.count ?? 8));
    if (count <= 0) return;
    const radius = options?.radius ?? 0.3;
    const scale = options?.scale ?? 0.7;
    const growth = options?.growth ?? 2.4;
    const maxLife = options?.life ?? 1.1;
    const speed = options?.speed ?? 0.9;
    const rise = options?.rise ?? 0.7;
    const color = options?.color ?? 0x8b8175;
    const peak = options?.opacity ?? 0.85;
    const drift = options?.drift;

    for (let i = 0; i < count; i += 1) {
      if (this.puffs.length >= MAX_PUFFS) return;
      const theta = Math.random() * Math.PI * 2;
      const spread = Math.pow(Math.random(), 0.6);
      const offset = new THREE.Vector3(
        Math.cos(theta) * radius * spread,
        (Math.random() - 0.25) * radius * 0.8,
        Math.sin(theta) * radius * spread,
      );

      const material = new THREE.SpriteMaterial({
        map: this.smokeMap,
        color,
        transparent: true,
        depthWrite: false,
        opacity: 0,
        rotation: Math.random() * Math.PI * 2,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.copy(position).add(offset);
      const size = scale * (0.7 + Math.random() * 0.6);
      sprite.scale.setScalar(size);
      sprite.renderOrder = 2;
      this.group.add(sprite);

      const velocity = new THREE.Vector3(offset.x, 0, offset.z)
        .normalize()
        .multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      velocity.y = speed * (0.2 + Math.random() * 0.4);
      if (drift) velocity.add(drift);

      this.puffs.push({
        sprite,
        velocity,
        spin: (Math.random() - 0.5) * 1.5,
        delay: Math.random() * maxLife * 0.18,
        life: 0,
        maxLife: maxLife * (0.75 + Math.random() * 0.5),
        from: size,
        to: size * growth,
        peak: peak * (0.6 + Math.random() * 0.55),
        buoyancy: rise * (0.7 + Math.random() * 0.6),
      });
    }
  }

  update(delta: number): void {
    for (let i = this.puffs.length - 1; i >= 0; i -= 1) {
      const puff = this.puffs[i];
      if (puff.delay > 0) {
        puff.delay -= delta;
        continue;
      }
      puff.life += delta;
      const t = Math.min(1, puff.life / puff.maxLife);
      // Air drag bleeds the initial kick off while buoyancy keeps it climbing.
      const drag = Math.max(0, 1 - delta * 1.6);
      puff.velocity.multiplyScalar(drag);
      puff.velocity.y += puff.buoyancy * delta;
      puff.sprite.position.addScaledVector(puff.velocity, delta);

      const eased = 1 - Math.pow(1 - t, 2.2);
      puff.sprite.scale.setScalar(puff.from + (puff.to - puff.from) * eased);
      const material = puff.sprite.material as THREE.SpriteMaterial;
      // Quick swell in, long thinning out.
      const fade = t < 0.16 ? t / 0.16 : Math.pow(1 - (t - 0.16) / 0.84, 1.5);
      material.opacity = Math.max(0, puff.peak * fade);
      material.rotation += puff.spin * delta;

      if (t >= 1) {
        this.group.remove(puff.sprite);
        material.dispose();
        this.puffs.splice(i, 1);
      }
    }

    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const burst = this.bursts[i];
      burst.life += delta;
      const t = burst.life / burst.maxLife;
      const attribute = burst.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      const array = attribute.array as Float32Array;
      const drag = burst.drag > 0 ? Math.max(0, 1 - burst.drag * delta) : 1;
      for (let p = 0; p < burst.velocities.length; p += 3) {
        burst.velocities[p + 1] -= burst.gravity * delta;
        if (drag < 1) {
          burst.velocities[p] *= drag;
          burst.velocities[p + 1] *= drag;
          burst.velocities[p + 2] *= drag;
        }
        array[p] += burst.velocities[p] * delta;
        array[p + 1] += burst.velocities[p + 1] * delta;
        array[p + 2] += burst.velocities[p + 2] * delta;
      }
      attribute.needsUpdate = true;
      const material = burst.points.material as THREE.PointsMaterial;
      material.opacity = Math.max(0, 1 - t);
      material.size = burst.size * (1 + (burst.growth - 1) * t);
      if (t >= 1) {
        this.group.remove(burst.points);
        burst.points.geometry.dispose();
        material.dispose();
        this.bursts.splice(i, 1);
      }
    }

    for (let i = this.flashes.length - 1; i >= 0; i -= 1) {
      const flash = this.flashes[i];
      flash.life += delta;
      const t = flash.life / flash.maxLife;
      const material = flash.sprite.material as THREE.SpriteMaterial;
      material.opacity = Math.max(0, 1 - t);
      flash.sprite.scale.setScalar(flash.scale * (0.4 + t * 1.3));
      if (t >= 1) {
        this.group.remove(flash.sprite);
        material.dispose();
        this.flashes.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const burst of this.bursts) {
      burst.points.geometry.dispose();
      (burst.points.material as THREE.Material).dispose();
    }
    for (const flash of this.flashes) (flash.sprite.material as THREE.Material).dispose();
    for (const puff of this.puffs) (puff.sprite.material as THREE.Material).dispose();
    this.bursts = [];
    this.flashes = [];
    this.puffs = [];
    this.sparkMap.dispose();
    this.flashMap.dispose();
    this.smokeMap.dispose();
    this.group.clear();
  }
}

/** Decaying positional camera shake, applied after the controls update. */
export class ShakeSystem {
  private trauma = 0;
  private elapsed = 0;
  readonly offset = new THREE.Vector3();

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(delta: number): void {
    this.elapsed += delta;
    if (this.trauma <= 0) {
      this.offset.set(0, 0, 0);
      return;
    }
    this.trauma = Math.max(0, this.trauma - delta * 1.9);
    const magnitude = this.trauma * this.trauma * 0.32;
    this.offset.set(
      Math.sin(this.elapsed * 47) * magnitude,
      Math.sin(this.elapsed * 61 + 1.3) * magnitude * 0.7,
      Math.sin(this.elapsed * 53 + 2.1) * magnitude,
    );
  }
}
