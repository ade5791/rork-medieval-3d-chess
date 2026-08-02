import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { ArenaLook } from "./arena";
import { ARENA_LOOKS, DEFAULT_ARENA } from "./arena";
import { QUALITY_SETTINGS, type QualityPreset } from "./quality";
import { clothTexture, mudTexture, smokeTexture, sparkTexture } from "./textures";

/**
 * Everything outside the hall walls: the churned war plain, the two siege
 * camps, pyres, palisades, wrecked engines, distant formations of pike and
 * the smoke-choked dusk horizon.
 *
 * Costs scale by setting `InstancedMesh.count` / draw ranges rather than by
 * rebuilding, so switching graphics preset never stalls the frame.
 */

/** Deterministic PRNG so the battlefield is laid out identically every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Courtyard stays perfectly flat; the plain rolls and rises toward the ridges. */
export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r < 20.5) return 0;
  const fade = Math.min(1, (r - 20.5) / 16);
  const rolling =
    Math.sin(x * 0.055) * Math.cos(z * 0.047) * 1.5 +
    Math.sin(x * 0.019 + z * 0.023) * 2.9 +
    Math.sin(z * 0.11 + 1.7) * 0.6;
  const rise = Math.max(0, r - 55) * 0.09;
  return rolling * fade + rise;
}

interface Campfire {
  light: THREE.PointLight;
  flame: THREE.Mesh;
  seed: number;
  base: number;
}

interface Crow {
  radius: number;
  height: number;
  speed: number;
  phase: number;
  flap: number;
}

const MAX_TROOPS = 320;
const MAX_ASH = 220;
const MAX_SMOKE = 90;
const CROW_COUNT = 11;

export class Battlefield {
  readonly group = new THREE.Group();

  /** Theme-driven handles: sky gradient, ground, fires and drifting particles. */
  private skyUniforms: { zenith: { value: THREE.Color }; horizon: { value: THREE.Color }; ember: { value: THREE.Color } } | null =
    null;
  private ridgeMaterials: THREE.MeshBasicMaterial[] = [];
  private plainMaterial: THREE.MeshStandardMaterial | null = null;
  private pyreFlameMaterials: THREE.MeshBasicMaterial[] = [];
  private glowMaterials: THREE.MeshBasicMaterial[] = [];
  private troopMaterials: THREE.MeshStandardMaterial[] = [];
  private ashMaterial: THREE.PointsMaterial | null = null;
  private smokeMaterial: THREE.PointsMaterial | null = null;
  private speckMaterial: THREE.PointsMaterial | null = null;
  private fireScale = 1;
  private speckOpacity = 0.85;
  private crowMaterial: THREE.MeshBasicMaterial | null = null;
  /** Siege engines are hidden on maps where a trebuchet makes no sense. */
  private siegeProps: THREE.Object3D[] = [];
  private showSiege = true;
  private propsEnabled = true;

  private rng = mulberry32(0x5eab17);
  private disposables: { dispose: () => void }[] = [];
  private windUniforms: { value: number }[] = [];
  private campfires: Campfire[] = [];
  private troops: THREE.InstancedMesh[] = [];
  private props: THREE.Object3D[] = [];
  private glows: THREE.Mesh[] = [];
  private crows: Crow[] = [];
  private crowMesh: THREE.InstancedMesh | null = null;
  private crowMatrix = new THREE.Matrix4();
  private crowQuat = new THREE.Quaternion();
  private crowEuler = new THREE.Euler();
  private crowPos = new THREE.Vector3();
  private crowScale = new THREE.Vector3(1, 1, 1);
  private ash: THREE.Points | null = null;
  private ashVelocity: Float32Array = new Float32Array(0);
  private smoke: THREE.Points | null = null;
  private smokeSeed: Float32Array = new Float32Array(0);
  private smokeAnchor: Float32Array = new Float32Array(0);
  private torchSpecks: THREE.Points | null = null;
  private elapsed = 0;

  constructor(quality: QualityPreset, look: ArenaLook = ARENA_LOOKS[DEFAULT_ARENA]) {
    this.group.name = "battlefield";

    this.buildSky();
    this.buildRidges();
    this.buildPlain();
    this.buildPalisade();
    this.buildCamps();
    this.buildSiegeEngines();
    this.buildDebris();
    this.buildPyres();
    this.buildFormations();
    this.buildSmoke();
    this.buildAsh();
    this.buildCrows();

    this.applyQuality(quality);
    this.applyArena(look);
  }

  private track<T extends { dispose: () => void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  // ------------------------------------------------------------------- sky

  /** Dusk battle sky: indigo zenith bleeding into an ember-lit smoke band. */
  private buildSky(): void {
    const geometry = this.track(new THREE.SphereGeometry(108, 32, 20));
    const material = this.track(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          zenith: { value: new THREE.Color(0x0a0d1a) },
          horizon: { value: new THREE.Color(0x2a1c16) },
          ember: { value: new THREE.Color(0xa8481a) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vPosition;
          void main() {
            vPosition = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 zenith;
          uniform vec3 horizon;
          uniform vec3 ember;
          varying vec3 vPosition;

          // Cheap value noise for the smoke banding across the sky.
          float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
          float noise(vec2 p) {
            vec2 i = floor(p); vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                       mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
          }

          void main() {
            vec3 dir = normalize(vPosition);
            float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
            vec3 color = mix(horizon, zenith, pow(h, 0.55));

            // Fires below the horizon line push warm light up into the haze.
            float glow = pow(max(0.0, 1.0 - abs(h - 0.5) * 6.0), 2.4);
            float side = smoothstep(-0.6, 0.9, dir.x * 0.6 + dir.z * 0.8);
            color += ember * glow * (0.35 + side * 0.75);

            // Torn smoke banks.
            float bands = noise(vec2(atan(dir.z, dir.x) * 3.0, h * 7.0));
            color = mix(color, color * 0.55 + vec3(0.06, 0.05, 0.05), bands * 0.45 * (1.0 - h));
            gl_FragColor = vec4(color, 1.0);
          }
        `,
      }),
    );
    this.skyUniforms = material.uniforms as unknown as {
      zenith: { value: THREE.Color };
      horizon: { value: THREE.Color };
      ember: { value: THREE.Color };
    };
    const dome = new THREE.Mesh(geometry, material);
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);
  }

  /**
   * Two jagged mountain silhouettes. Fog is disabled and the haze is baked into
   * vertex colours instead, so the ridges stay readable behind the fogged plain.
   */
  private buildRidges(): void {
    const layers: { radius: number; height: number; jag: number; top: number; base: number }[] = [
      { radius: 96, height: 30, jag: 7, top: 0x1b2130, base: 0x2b2a2c },
      { radius: 74, height: 22, jag: 5.4, top: 0x11141d, base: 0x20201f },
    ];

    for (const layer of layers) {
      const segments = 96;
      const geometry = this.track(
        new THREE.CylinderGeometry(layer.radius, layer.radius, layer.height, segments, 1, true),
      );
      const position = geometry.getAttribute("position") as THREE.BufferAttribute;
      const colors = new Float32Array(position.count * 3);
      const topColor = new THREE.Color(layer.top);
      const baseColor = new THREE.Color(layer.base);
      const half = layer.height / 2;

      // Displace the upper rim into peaks; ring wraps so first/last must match.
      const peaks: number[] = [];
      for (let i = 0; i <= segments; i += 1) {
        const t = (i / segments) * Math.PI * 2;
        peaks.push(
          (Math.sin(t * 3.1) * 0.5 + Math.sin(t * 7.7 + 1.2) * 0.32 + Math.sin(t * 13.3 + 2.6) * 0.18) * layer.jag,
        );
      }

      for (let i = 0; i < position.count; i += 1) {
        const y = position.getY(i);
        const isTop = y > 0;
        const angle = Math.atan2(position.getZ(i), position.getX(i));
        const index = Math.round(((angle + Math.PI) / (Math.PI * 2)) * segments) % segments;
        if (isTop) position.setY(i, half + peaks[index]);
        const shade = isTop ? topColor : baseColor;
        colors[i * 3] = shade.r;
        colors[i * 3 + 1] = shade.g;
        colors[i * 3 + 2] = shade.b;
      }
      position.needsUpdate = true;
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

      const material = this.track(
        new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }),
      );
      this.ridgeMaterials.push(material);
      const ridge = new THREE.Mesh(geometry, material);
      ridge.position.y = layer.height / 2 - 8;
      ridge.renderOrder = -9;
      this.group.add(ridge);
    }
  }

  // ----------------------------------------------------------------- ground

  private buildPlain(): void {
    const map = this.track(mudTexture());
    map.repeat.set(64, 64);
    const geometry = this.track(new THREE.PlaneGeometry(320, 320, 110, 110));
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      position.setZ(i, terrainHeight(x, -y));
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();

    const material = this.track(
      new THREE.MeshStandardMaterial({ map, color: 0x6b6055, roughness: 1, metalness: 0 }),
    );
    this.plainMaterial = material;
    const plain = new THREE.Mesh(geometry, material);
    plain.rotation.x = -Math.PI / 2;
    plain.position.y = -0.7;
    plain.receiveShadow = true;
    this.group.add(plain);
  }

  /** Sharpened stakes leaning outward, ringing the courtyard with gaps. */
  private buildPalisade(): void {
    const stake = this.track(new THREE.CylinderGeometry(0.06, 0.16, 2.4, 5));
    stake.translate(0, 1.1, 0);
    const tip = new THREE.ConeGeometry(0.09, 0.45, 5);
    tip.translate(0, 2.5, 0);
    const geometry = this.track(mergeGeometries([stake, tip], false) ?? stake);
    tip.dispose();

    const material = this.track(new THREE.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 0.95 }));
    const count = 132;
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    let placed = 0;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      // Three breaches where the line was overrun.
      const gap = Math.abs(Math.sin(angle * 1.5)) < 0.22 || Math.abs(Math.cos(angle * 2.1)) < 0.12;
      if (gap && this.rng() > 0.25) continue;
      const radius = 21.5 + this.rng() * 1.4;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      dummy.position.set(x, terrainHeight(x, z) - 0.75, z);
      dummy.rotation.set(
        (this.rng() - 0.5) * 0.22,
        this.rng() * Math.PI,
        -Math.cos(angle) * 0.16 + (this.rng() - 0.5) * 0.3,
      );
      dummy.scale.setScalar(0.8 + this.rng() * 0.6);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      placed += 1;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  // ------------------------------------------------------------------ camps

  /** Two war camps of pavilion tents with wind-blown banners, one per army. */
  private buildCamps(): void {
    const canvasGeo = new THREE.ConeGeometry(2.4, 3.1, 8, 1, true);
    canvasGeo.translate(0, 1.55, 0);
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.07, 4.4, 5);
    poleGeo.translate(0, 2.2, 0);
    const tentGeometry = this.track(mergeGeometries([canvasGeo, poleGeo], false) ?? canvasGeo);
    canvasGeo.dispose();
    poleGeo.dispose();

    const sides: { sign: number; cloth: THREE.CanvasTexture; tint: number; banner: number }[] = [
      { sign: 1, cloth: this.track(clothTexture("#4a4438", "#2f4a86")), tint: 0xb9b0a0, banner: 0x2f4a86 },
      { sign: -1, cloth: this.track(clothTexture("#3a3229", "#7a2320")), tint: 0x8a8076, banner: 0x8c2a24 },
    ];

    for (const side of sides) {
      side.cloth.repeat.set(2, 1);
      const material = this.track(
        new THREE.MeshStandardMaterial({
          map: side.cloth,
          color: side.tint,
          roughness: 0.95,
          metalness: 0,
          side: THREE.DoubleSide,
        }),
      );
      const tents = new THREE.InstancedMesh(tentGeometry, material, 9);
      tents.castShadow = true;
      tents.receiveShadow = true;
      const dummy = new THREE.Object3D();

      for (let i = 0; i < 9; i += 1) {
        const spread = (i - 4) / 4;
        const angle = Math.PI / 2 + spread * 1.05 + (this.rng() - 0.5) * 0.12;
        const radius = 28 + this.rng() * 12;
        const x = Math.cos(angle) * radius * side.sign;
        const z = Math.sin(angle) * radius * side.sign;
        dummy.position.set(x, terrainHeight(x, z) - 0.7, z);
        dummy.rotation.set(0, this.rng() * Math.PI, 0);
        dummy.scale.setScalar(0.85 + this.rng() * 0.5);
        dummy.updateMatrix();
        tents.setMatrixAt(i, dummy.matrix);

        // Every third tent gets a standard planted next to it.
        if (i % 3 === 0) this.addBanner(x + side.sign * 2.6, z, side.banner);
      }
      tents.instanceMatrix.needsUpdate = true;
      this.props.push(tents);
      this.group.add(tents);
    }
  }

  /** Pole + cloth banner whose vertices ripple in a shader-driven wind. */
  private addBanner(x: number, z: number, color: number): void {
    const ground = terrainHeight(x, z) - 0.7;
    const poleMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2c2118, roughness: 0.85 }));
    const poleGeo = this.track(new THREE.CylinderGeometry(0.07, 0.09, 6.4, 6));
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, ground + 3.2, z);
    pole.castShadow = true;
    this.group.add(pole);

    const clothGeo = this.track(new THREE.PlaneGeometry(1.7, 2.6, 8, 10));
    clothGeo.translate(0.85, 0, 0);
    const time = { value: 0 };
    const material = this.track(
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.92,
        metalness: 0,
        side: THREE.DoubleSide,
        emissive: new THREE.Color(color).multiplyScalar(0.12),
      }),
    );
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
          float grip = clamp(position.x / 1.7, 0.0, 1.0);
          float wave = sin(uTime * 2.6 + position.x * 2.4 + position.y * 1.1);
          transformed.z += wave * 0.34 * grip;
          transformed.y += sin(uTime * 1.9 + position.x * 3.1) * 0.09 * grip;
        `,
      );
    };
    this.windUniforms.push(time);

    const banner = new THREE.Mesh(clothGeo, material);
    banner.position.set(x, ground + 4.7, z);
    banner.rotation.y = this.rng() * Math.PI;
    banner.castShadow = true;
    this.props.push(banner);
    this.group.add(banner);
  }

  // --------------------------------------------------------- siege machines

  private buildSiegeEngines(): void {
    const timber = this.track(new THREE.MeshStandardMaterial({ color: 0x241b13, roughness: 0.95 }));
    const iron = this.track(new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.6, metalness: 0.55 }));
    const beamGeo = this.track(new THREE.BoxGeometry(1, 1, 1));
    const wheelGeo = this.track(new THREE.TorusGeometry(0.9, 0.16, 6, 14));

    const beam = (
      parent: THREE.Group,
      sx: number,
      sy: number,
      sz: number,
      px: number,
      py: number,
      pz: number,
      rot: THREE.Vector3,
    ): void => {
      const mesh = new THREE.Mesh(beamGeo, timber);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(px, py, pz);
      mesh.rotation.set(rot.x, rot.y, rot.z);
      mesh.castShadow = true;
      parent.add(mesh);
    };

    const wheel = (parent: THREE.Group, px: number, py: number, pz: number): void => {
      const mesh = new THREE.Mesh(wheelGeo, iron);
      mesh.position.set(px, py, pz);
      mesh.rotation.y = Math.PI / 2;
      mesh.castShadow = true;
      parent.add(mesh);
    };

    // --- Trebuchet, arm still cocked over its wrecked frame.
    const trebuchet = new THREE.Group();
    beam(trebuchet, 0.5, 7, 0.5, -1.4, 3.5, 0, new THREE.Vector3(0, 0, 0.32));
    beam(trebuchet, 0.5, 7, 0.5, 1.4, 3.5, 0, new THREE.Vector3(0, 0, -0.32));
    beam(trebuchet, 5, 0.6, 0.6, 0, 0.4, 1.4, new THREE.Vector3(0, 0, 0));
    beam(trebuchet, 5, 0.6, 0.6, 0, 0.4, -1.4, new THREE.Vector3(0, 0, 0));
    beam(trebuchet, 12, 0.42, 0.42, 1.6, 6.2, 0, new THREE.Vector3(0, 0, -0.55));
    beam(trebuchet, 1.7, 1.7, 1.7, -3.9, 2.2, 0, new THREE.Vector3(0, 0.4, 0));
    wheel(trebuchet, -2, 0.2, 1.8);
    wheel(trebuchet, -2, 0.2, -1.8);
    this.placeProp(trebuchet, 2.35, 37, 0.9);

    // --- Siege tower, scorched and listing.
    const tower = new THREE.Group();
    beam(tower, 4.4, 11, 4, 0, 5.5, 0, new THREE.Vector3(0, 0, 0));
    beam(tower, 4.8, 0.4, 4.4, 0, 8.4, 0, new THREE.Vector3(0, 0, 0));
    beam(tower, 4.2, 0.4, 5.4, 0, 10.6, 2.4, new THREE.Vector3(-0.7, 0, 0));
    wheel(tower, 1.6, 0.1, 1.8);
    wheel(tower, -1.6, 0.1, 1.8);
    wheel(tower, 1.6, 0.1, -1.8);
    wheel(tower, -1.6, 0.1, -1.8);
    tower.rotation.z = 0.09;
    this.placeProp(tower, -1.15, 42, -0.6);

    // --- Battering ram under a shattered canopy.
    const ram = new THREE.Group();
    beam(ram, 7, 0.7, 0.7, 0, 1.5, 0, new THREE.Vector3(0, 0, 0.06));
    beam(ram, 7.4, 0.3, 3.4, 0, 2.9, 0, new THREE.Vector3(0.12, 0, 0));
    beam(ram, 0.4, 2.6, 0.4, -2.6, 1.5, 1.4, new THREE.Vector3(0, 0, 0));
    beam(ram, 0.4, 2.6, 0.4, 2.6, 1.5, -1.4, new THREE.Vector3(0, 0, 0.2));
    wheel(ram, 2.4, 0.1, 1.6);
    wheel(ram, -2.4, 0.1, -1.6);
    this.placeProp(ram, 3.9, 31, 0.2);

    // --- Toppled catapult on the opposite flank.
    const catapult = new THREE.Group();
    beam(catapult, 4.4, 0.6, 0.6, 0, 0.9, 1, new THREE.Vector3(0.5, 0, 0));
    beam(catapult, 4.4, 0.6, 0.6, 0, 1.6, -1, new THREE.Vector3(0.5, 0, 0));
    beam(catapult, 6, 0.4, 0.4, 0.6, 2.4, 0, new THREE.Vector3(0, 0, 1.1));
    wheel(catapult, 1.8, 0.6, 1.4);
    catapult.rotation.x = 0.5;
    this.placeProp(catapult, -2.6, 34, 2.4);
  }

  private placeProp(object: THREE.Group, angle: number, radius: number, spin: number): void {
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    object.position.set(x, terrainHeight(x, z) - 0.7, z);
    object.rotation.y += spin;
    this.props.push(object);
    this.siegeProps.push(object);
    this.group.add(object);
  }

  // ----------------------------------------------------------------- debris

  /** Spears in the mud, dropped shields, broken wheels and shattered rock. */
  private buildDebris(): void {
    const shaft = new THREE.CylinderGeometry(0.045, 0.045, 2.6, 4);
    shaft.translate(0, 1.1, 0);
    const head = new THREE.ConeGeometry(0.11, 0.5, 4);
    head.translate(0, 2.6, 0);
    const spearGeo = this.track(mergeGeometries([shaft, head], false) ?? shaft);
    shaft.dispose();
    head.dispose();

    const spearMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2f2519, roughness: 0.85, metalness: 0.25 }));
    this.scatter(spearGeo, spearMat, 90, 24, 60, (dummy) => {
      dummy.rotation.set((this.rng() - 0.5) * 0.9, this.rng() * Math.PI, (this.rng() - 0.5) * 0.9);
      dummy.scale.setScalar(0.8 + this.rng() * 0.6);
    });

    const shieldGeo = this.track(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 12));
    const shieldMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x53402c, roughness: 0.8, metalness: 0.2 }),
    );
    this.scatter(shieldGeo, shieldMat, 46, 23, 52, (dummy) => {
      dummy.rotation.set(Math.PI / 2 - 0.35 - this.rng() * 1.2, this.rng() * Math.PI, this.rng() * 0.6);
      dummy.position.y += 0.1;
    });

    const rockGeo = this.track(new THREE.IcosahedronGeometry(0.55, 0));
    const rockMat = this.track(new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 1 }));
    this.scatter(rockGeo, rockMat, 70, 22, 62, (dummy) => {
      dummy.rotation.set(this.rng() * 3, this.rng() * 3, this.rng() * 3);
      dummy.scale.set(0.5 + this.rng() * 1.6, 0.4 + this.rng() * 0.9, 0.5 + this.rng() * 1.6);
    });

    const wheelGeo = this.track(new THREE.TorusGeometry(0.85, 0.13, 5, 12));
    const wheelMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 0.95 }));
    this.scatter(wheelGeo, wheelMat, 14, 26, 55, (dummy) => {
      dummy.rotation.set(Math.PI / 2 - this.rng() * 0.5, this.rng() * Math.PI, 0);
      dummy.position.y += 0.2;
    });
  }

  private scatter(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    count: number,
    minRadius: number,
    maxRadius: number,
    decorate: (dummy: THREE.Object3D) => void,
  ): void {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i += 1) {
      const angle = this.rng() * Math.PI * 2;
      const radius = minRadius + this.rng() * (maxRadius - minRadius);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      dummy.position.set(x, terrainHeight(x, z) - 0.7, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      decorate(dummy);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.props.push(mesh);
    this.group.add(mesh);
  }

  // ------------------------------------------------------------------ fires

  /** Camp pyres: stone ring, burning logs, a warm point light and a glow disc. */
  private buildPyres(): void {
    const stoneMat = this.track(new THREE.MeshStandardMaterial({ color: 0x3d372f, roughness: 1 }));
    const logMat = this.track(new THREE.MeshStandardMaterial({ color: 0x1d150e, roughness: 1 }));
    const ringGeo = this.track(new THREE.TorusGeometry(1.15, 0.24, 5, 12));
    const logGeo = this.track(new THREE.CylinderGeometry(0.16, 0.2, 1.8, 5));
    const flameGeo = this.track(new THREE.ConeGeometry(0.7, 1.9, 8));
    const glowGeo = this.track(new THREE.PlaneGeometry(9, 9));
    const glowMap = this.track(sparkTexture());

    const spots: [number, number][] = [
      [0.75, 25],
      [2.5, 27.5],
      [3.85, 26],
      [5.55, 29],
    ];

    spots.forEach(([angle, radius], index) => {
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = terrainHeight(x, z) - 0.7;

      const ring = new THREE.Mesh(ringGeo, stoneMat);
      ring.position.set(x, y + 0.12, z);
      ring.rotation.x = Math.PI / 2;
      ring.receiveShadow = true;
      this.group.add(ring);

      for (let i = 0; i < 3; i += 1) {
        const log = new THREE.Mesh(logGeo, logMat);
        log.position.set(x, y + 0.24, z);
        log.rotation.set(Math.PI / 2 - 0.28, (i / 3) * Math.PI, 0);
        log.castShadow = true;
        this.group.add(log);
      }

      const flameMat = this.track(
        new THREE.MeshBasicMaterial({ color: 0xff8a2c, transparent: true, opacity: 0.92, fog: false }),
      );
      this.pyreFlameMaterials.push(flameMat);
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(x, y + 1.1, z);
      this.group.add(flame);

      const glowMat = this.track(
        new THREE.MeshBasicMaterial({
          map: glowMap,
          color: 0xff8632,
          transparent: true,
          opacity: 0.4,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
      );
      this.glowMaterials.push(glowMat);
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.set(x, y + 1.4, z);
      glow.renderOrder = 3;
      this.glows.push(glow);
      this.group.add(glow);

      const light = new THREE.PointLight(0xff7a26, 34, 26, 2);
      light.position.set(x, y + 1.8, z);
      this.group.add(light);

      this.campfires.push({ light, flame, seed: index * 5.3, base: 34 });
    });
  }

  // -------------------------------------------------------------- formations

  /** Two armies drawn up beyond the camps as instanced pike silhouettes. */
  private buildFormations(): void {
    const legs = new THREE.CylinderGeometry(0.15, 0.2, 0.55, 5);
    legs.translate(0, 0.28, 0);
    const torso = new THREE.CylinderGeometry(0.19, 0.26, 0.72, 6);
    torso.translate(0, 0.92, 0);
    const head = new THREE.SphereGeometry(0.15, 6, 5);
    head.translate(0, 1.42, 0);
    const pike = new THREE.CylinderGeometry(0.035, 0.035, 3.1, 4);
    pike.rotateZ(0.13);
    pike.translate(0.3, 1.5, 0);
    const soldier = this.track(mergeGeometries([legs, torso, head, pike], false) ?? torso);
    legs.dispose();
    torso.dispose();
    head.dispose();
    pike.dispose();

    const armies: { angle: number; tint: number; emissive: number }[] = [
      { angle: Math.PI / 2, tint: 0x3a4055, emissive: 0x16224a },
      { angle: -Math.PI / 2, tint: 0x342a28, emissive: 0x3a1210 },
    ];

    const specks: number[] = [];
    const dummy = new THREE.Object3D();

    for (const army of armies) {
      const material = this.track(
        new THREE.MeshStandardMaterial({
          color: army.tint,
          roughness: 0.95,
          metalness: 0.2,
          emissive: new THREE.Color(army.emissive),
          emissiveIntensity: 0.5,
        }),
      );
      this.troopMaterials.push(material);
      const mesh = new THREE.InstancedMesh(soldier, material, MAX_TROOPS);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;

      const cols = 20;
      for (let i = 0; i < MAX_TROOPS; i += 1) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        // Ranks curve around the board so both blocks face the courtyard.
        const spread = (col - (cols - 1) / 2) * 0.055;
        const angle = army.angle + spread + (this.rng() - 0.5) * 0.012;
        const radius = 52 + row * 1.9 + (this.rng() - 0.5) * 0.8;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const y = terrainHeight(x, z) - 0.7;
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, -angle + Math.PI + (this.rng() - 0.5) * 0.2, 0);
        dummy.scale.setScalar(0.95 + this.rng() * 0.25);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        // Every few soldiers carries a torch: cheap flickering light specks.
        if (i % 7 === 0) specks.push(x, y + 2.1, z);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.troops.push(mesh);
      this.group.add(mesh);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(specks), 3));
    const material = this.track(
      new THREE.PointsMaterial({
        size: 0.9,
        map: this.track(sparkTexture()),
        color: 0xffa445,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: true,
      }),
    );
    this.speckMaterial = material;
    this.torchSpecks = new THREE.Points(geometry, material);
    this.torchSpecks.frustumCulled = false;
    this.group.add(this.torchSpecks);
  }

  // ------------------------------------------------------------ atmospherics

  /** Slow grey plumes rising off the pyres and the burning engines. */
  private buildSmoke(): void {
    const anchors: [number, number][] = [
      [Math.cos(2.35) * 37, Math.sin(2.35) * 37],
      [Math.cos(-1.15) * 42, Math.sin(-1.15) * 42],
      [Math.cos(0.75) * 25, Math.sin(0.75) * 25],
      [Math.cos(3.85) * 26, Math.sin(3.85) * 26],
      [Math.cos(-2.6) * 34, Math.sin(-2.6) * 34],
    ];

    const positions = new Float32Array(MAX_SMOKE * 3);
    this.smokeSeed = new Float32Array(MAX_SMOKE);
    this.smokeAnchor = new Float32Array(MAX_SMOKE * 2);
    for (let i = 0; i < MAX_SMOKE; i += 1) {
      const [ax, az] = anchors[i % anchors.length];
      this.smokeAnchor[i * 2] = ax;
      this.smokeAnchor[i * 2 + 1] = az;
      this.smokeSeed[i] = this.rng();
      positions[i * 3] = ax;
      positions[i * 3 + 1] = 1 + this.rng() * 24;
      positions[i * 3 + 2] = az;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = this.track(
      new THREE.PointsMaterial({
        size: 11,
        map: this.track(smokeTexture()),
        color: 0x6b6560,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        fog: false,
      }),
    );
    this.smokeMaterial = material;
    this.smoke = new THREE.Points(geometry, material);
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = -5;
    this.group.add(this.smoke);
  }

  /** Warm ash and cinders blown across the courtyard from the fires. */
  private buildAsh(): void {
    const positions = new Float32Array(MAX_ASH * 3);
    this.ashVelocity = new Float32Array(MAX_ASH);
    for (let i = 0; i < MAX_ASH; i += 1) {
      positions[i * 3] = (this.rng() - 0.5) * 70;
      positions[i * 3 + 1] = this.rng() * 16;
      positions[i * 3 + 2] = (this.rng() - 0.5) * 70;
      this.ashVelocity[i] = 0.25 + this.rng() * 0.8;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = this.track(
      new THREE.PointsMaterial({
        size: 0.14,
        map: this.track(sparkTexture()),
        color: 0xffb066,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.ashMaterial = material;
    this.ash = new THREE.Points(geometry, material);
    this.ash.frustumCulled = false;
    this.group.add(this.ash);
  }

  /** Carrion birds wheeling over the field. */
  private buildCrows(): void {
    const geometry = this.track(new THREE.BufferGeometry());
    const vertices = new Float32Array([
      0, 0, 0, -0.55, 0.16, -0.3, -0.55, 0.16, 0.3, 0, 0, 0, 0.42, 0.1, -0.26, 0.42, 0.1, 0.26,
    ]);
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();

    const material = this.track(
      new THREE.MeshBasicMaterial({ color: 0x0d0c0f, side: THREE.DoubleSide, fog: true }),
    );
    this.crowMaterial = material;
    const mesh = new THREE.InstancedMesh(geometry, material, CROW_COUNT);
    mesh.frustumCulled = false;
    for (let i = 0; i < CROW_COUNT; i += 1) {
      this.crows.push({
        radius: 22 + this.rng() * 26,
        height: 12 + this.rng() * 9,
        speed: 0.12 + this.rng() * 0.16,
        phase: this.rng() * Math.PI * 2,
        flap: 6 + this.rng() * 4,
      });
    }
    this.crowMesh = mesh;
    this.props.push(mesh);
    this.group.add(mesh);
  }

  // ---------------------------------------------------------------- runtime

  /**
   * Repaints the world outside the walls for an arena theme: sky gradient,
   * mountain haze, ground tint, how hard the camp fires burn and how visible
   * their ash and smoke are against the new sky.
   */
  applyArena(look: ArenaLook): void {
    if (this.skyUniforms) {
      this.skyUniforms.zenith.value.setHex(look.sky.zenith);
      this.skyUniforms.horizon.value.setHex(look.sky.horizon);
      this.skyUniforms.ember.value.setHex(look.sky.ember);
    }
    for (const material of this.ridgeMaterials) material.color.setRGB(...look.ridge);
    this.plainMaterial?.color.setHex(look.ground);

    this.fireScale = look.fire;
    for (const flame of this.pyreFlameMaterials) flame.opacity = 0.92 * Math.max(0.4, look.fire);
    for (const glow of this.glowMaterials) glow.opacity = 0.4 * look.fire;

    if (this.ashMaterial) {
      this.ashMaterial.color.setHex(look.ash.color);
      this.ashMaterial.opacity = look.ash.opacity;
    }
    if (this.smokeMaterial) {
      this.smokeMaterial.color.setHex(look.smoke.color);
      this.smokeMaterial.opacity = look.smoke.opacity;
    }
    this.speckOpacity = 0.85 * Math.max(0.3, look.fire);
    if (this.speckMaterial) this.speckMaterial.opacity = this.speckOpacity;

    this.crowMaterial?.color.setHex(look.birds);
    this.showSiege = look.siegeEngines;
    this.refreshProps();

    // The distant blocks of pike need to stay silhouettes, not glowing embers,
    // once the sun is up.
    const tints = [look.troops.ivory, look.troops.obsidian];
    this.troopMaterials.forEach((material, index) => {
      material.color.setHex(tints[index] ?? tints[0]);
      material.emissiveIntensity = look.troops.emissive;
    });
  }

  applyQuality(preset: QualityPreset): void {
    const settings = QUALITY_SETTINGS[preset];

    for (const mesh of this.troops) {
      mesh.count = Math.min(MAX_TROOPS, settings.troopCount);
      mesh.visible = settings.troopCount > 0;
    }

    this.campfires.forEach((fire, index) => {
      const active = index < settings.campfires;
      fire.light.visible = active;
      fire.light.intensity = active ? fire.base * this.fireScale : 0;
    });
    for (const glow of this.glows) glow.visible = settings.campfires > 0;

    if (this.ash) {
      this.ash.visible = settings.ashCount > 0;
      this.ash.geometry.setDrawRange(0, Math.min(MAX_ASH, settings.ashCount));
    }
    if (this.smoke) {
      this.smoke.visible = settings.smokeCount > 0;
      this.smoke.geometry.setDrawRange(0, Math.min(MAX_SMOKE, settings.smokeCount));
    }
    if (this.torchSpecks) this.torchSpecks.visible = settings.troopCount > 0;

    this.propsEnabled = settings.battleProps;
    this.refreshProps();
  }

  /**
   * The Low preset keeps the terrain, camps silhouette and sky but drops the
   * scattered props, banners and birds that add draw calls for little gain;
   * on top of that, some maps stage no siege engines at all.
   */
  private refreshProps(): void {
    for (const prop of this.props) {
      if (this.troops.includes(prop as THREE.InstancedMesh)) continue;
      const isSiege = this.siegeProps.includes(prop);
      prop.visible = this.propsEnabled && (!isSiege || this.showSiege);
    }
  }

  update(delta: number, camera: THREE.Camera): void {
    this.elapsed += delta;

    for (const uniform of this.windUniforms) uniform.value = this.elapsed;

    for (const fire of this.campfires) {
      if (!fire.light.visible) continue;
      const t = this.elapsed * 5.4 + fire.seed;
      const flicker = 0.7 + Math.sin(t) * 0.14 + Math.sin(t * 2.7) * 0.1 + Math.sin(t * 6.3) * 0.05;
      fire.light.intensity = fire.base * flicker * this.fireScale;
      fire.flame.scale.set(0.85 + flicker * 0.3, 0.8 + flicker * 0.55, 0.85 + flicker * 0.3);
    }

    for (const glow of this.glows) {
      if (!glow.visible) continue;
      glow.quaternion.copy(camera.quaternion);
      const material = glow.material as THREE.MeshBasicMaterial;
      material.opacity = (0.3 + Math.sin(this.elapsed * 3.1 + glow.position.x) * 0.09) * this.fireScale;
    }

    if (this.torchSpecks) {
      const material = this.torchSpecks.material as THREE.PointsMaterial;
      material.opacity = this.speckOpacity * (0.8 + Math.sin(this.elapsed * 2.3) * 0.16);
    }

    if (this.ash?.visible) {
      const attribute = this.ash.geometry.getAttribute("position") as THREE.BufferAttribute;
      const array = attribute.array as Float32Array;
      const count = this.ash.geometry.drawRange.count;
      for (let i = 0; i < count; i += 1) {
        array[i * 3] += Math.sin(this.elapsed * 0.6 + i) * 0.006 + 0.012;
        array[i * 3 + 1] += this.ashVelocity[i] * delta * 0.6;
        array[i * 3 + 2] += Math.cos(this.elapsed * 0.5 + i * 0.7) * 0.006;
        if (array[i * 3 + 1] > 17) {
          array[i * 3 + 1] = 0.2;
          array[i * 3] = (Math.random() - 0.5) * 70;
          array[i * 3 + 2] = (Math.random() - 0.5) * 70;
        }
      }
      attribute.needsUpdate = true;
    }

    if (this.smoke?.visible) {
      const attribute = this.smoke.geometry.getAttribute("position") as THREE.BufferAttribute;
      const array = attribute.array as Float32Array;
      const count = this.smoke.geometry.drawRange.count;
      for (let i = 0; i < count; i += 1) {
        const drift = 1.4 + this.smokeSeed[i];
        array[i * 3 + 1] += delta * drift;
        array[i * 3] += delta * (1.1 + this.smokeSeed[i] * 0.8);
        array[i * 3 + 2] += delta * 0.35;
        if (array[i * 3 + 1] > 30) {
          array[i * 3 + 1] = 1;
          array[i * 3] = this.smokeAnchor[i * 2] + (Math.random() - 0.5) * 2.4;
          array[i * 3 + 2] = this.smokeAnchor[i * 2 + 1] + (Math.random() - 0.5) * 2.4;
        }
      }
      attribute.needsUpdate = true;
    }

    if (this.crowMesh?.visible) {
      this.crows.forEach((crow, index) => {
        const angle = crow.phase + this.elapsed * crow.speed;
        const x = Math.cos(angle) * crow.radius;
        const z = Math.sin(angle) * crow.radius;
        const bob = Math.sin(this.elapsed * 0.9 + crow.phase) * 0.9;
        this.crowPos.set(x, crow.height + bob, z);
        this.crowEuler.set(
          Math.sin(this.elapsed * crow.flap + crow.phase) * 0.5,
          -angle + Math.PI / 2,
          Math.sin(this.elapsed * 0.8 + crow.phase) * 0.25,
        );
        this.crowQuat.setFromEuler(this.crowEuler);
        const flap = 0.55 + Math.abs(Math.sin(this.elapsed * crow.flap + crow.phase)) * 0.6;
        this.crowScale.set(1, 1, flap);
        this.crowMatrix.compose(this.crowPos, this.crowQuat, this.crowScale);
        this.crowMesh?.setMatrixAt(index, this.crowMatrix);
      });
      this.crowMesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const mesh of [...this.troops, this.crowMesh]) mesh?.dispose();
    for (const points of [this.ash, this.smoke, this.torchSpecks]) points?.geometry.dispose();
    for (const item of this.disposables) item.dispose();
    this.disposables = [];
    this.troops = [];
    this.props = [];
    this.siegeProps = [];
    this.glows = [];
    this.campfires = [];
    this.group.clear();
  }
}
