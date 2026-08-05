import * as THREE from "three";

import { flagstoneTexture, marbleTexture, shaftTexture, sparkTexture } from "./textures";
import { marbleSurface, stoneSurface } from "./detail";
import type { ArenaLook } from "./arena";
import { ARENA_LOOKS, DEFAULT_ARENA } from "./arena";
import type { QualityPreset } from "./quality";
import { QUALITY_SETTINGS } from "./quality";

interface Torch {
  light: THREE.PointLight;
  flame: THREE.Mesh;
  seed: number;
  base: number;
}

/**
 * The torch-lit stone hall the board sits in: flagstone floor, pillar ring with
 * arches, high windows with volumetric-feeling shafts, drifting dust, ember
 * particles and four flickering torches against one warm key light.
 */
export class CastleHall {
  readonly group = new THREE.Group();
  readonly keyLight: THREE.DirectionalLight;

  private hemi: THREE.HemisphereLight;
  private fillLight: THREE.DirectionalLight;
  private torches: Torch[] = [];
  private dust: THREE.Points | null = null;
  private embers: THREE.Points | null = null;
  private shafts: THREE.Mesh[] = [];
  private emberVelocities: Float32Array = new Float32Array(0);
  private dustPhase: Float32Array = new Float32Array(0);
  private disposables: { dispose: () => void }[] = [];
  private elapsed = 0;

  /** Materials the arena theme repaints. */
  private floorMaterial: THREE.MeshStandardMaterial | null = null;
  private daisMaterial: THREE.MeshStandardMaterial | null = null;
  private pillarMaterial: THREE.MeshStandardMaterial | null = null;
  private wallMaterial: THREE.MeshStandardMaterial | null = null;
  private rubbleMaterial: THREE.MeshStandardMaterial | null = null;
  private windowMaterial: THREE.MeshBasicMaterial | null = null;
  private flameMaterials: THREE.MeshBasicMaterial[] = [];
  private look: ArenaLook = ARENA_LOOKS[DEFAULT_ARENA];

  constructor(private quality: QualityPreset, look: ArenaLook = ARENA_LOOKS[DEFAULT_ARENA]) {
    this.group.name = "castle_hall";
    this.look = look;

    this.hemi = new THREE.HemisphereLight(0x4a5f8a, 0x140f0b, 0.55);
    this.group.add(this.hemi);

    this.keyLight = new THREE.DirectionalLight(0xffd7a1, 2.6);
    this.keyLight.position.set(-9, 15, 7);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.camera.near = 1;
    this.keyLight.shadow.camera.far = 45;
    this.keyLight.shadow.camera.left = -9;
    this.keyLight.shadow.camera.right = 9;
    this.keyLight.shadow.camera.top = 9;
    this.keyLight.shadow.camera.bottom = -9;
    this.keyLight.shadow.bias = -0.0008;
    this.keyLight.shadow.normalBias = 0.02;
    this.group.add(this.keyLight);
    this.group.add(this.keyLight.target);

    // A cool fill from the opposite side separates the black army from the fog.
    this.fillLight = new THREE.DirectionalLight(0x5f7fbf, 0.5);
    this.fillLight.position.set(8, 6, -9);
    this.group.add(this.fillLight);

    this.buildFloor();
    this.buildColonnade();
    this.buildTorches();
    this.applyQuality(quality);
    this.applyArena(look);
  }

  private track<T extends { dispose: () => void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  private buildFloor(): void {
    const map = this.track(flagstoneTexture());
    map.repeat.set(8, 8);
    // Shared authored relief: the flagstones were a flat albedo before.
    const stone = stoneSurface();
    stone.normalMap.repeat.set(8, 8);
    stone.roughnessMap.repeat.set(8, 8);
    // A paved courtyard rather than an endless floor: the war plain takes over
    // past the ruined wall line.
    const geometry = this.track(new THREE.CircleGeometry(20.5, 64));
    const material = this.track(
      new THREE.MeshStandardMaterial({
        map,
        color: 0x6a6155,
        roughness: 0.95,
        metalness: 0.02,
        normalMap: stone.normalMap,
        normalScale: new THREE.Vector2(0.85, 0.85),
        roughnessMap: stone.roughnessMap,
      }),
    );
    this.floorMaterial = material;
    const floor = new THREE.Mesh(geometry, material);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.62;
    floor.receiveShadow = true;
    this.group.add(floor);

    const marble = marbleSurface();
    // Dais the board rests on.
    const daisGeo = this.track(new THREE.CylinderGeometry(9.4, 10.4, 0.5, 48, 1));
    const daisMat = this.track(
      new THREE.MeshStandardMaterial({
        map: this.track(marbleTexture(true)),
        color: 0x5b5449,
        roughness: 0.85,
        normalMap: marble.normalMap,
        normalScale: new THREE.Vector2(0.5, 0.5),
        roughnessMap: marble.roughnessMap,
      }),
    );
    this.daisMaterial = daisMat;
    const dais = new THREE.Mesh(daisGeo, daisMat);
    dais.position.y = -0.62;
    dais.receiveShadow = true;
    this.group.add(dais);
  }

  private buildColonnade(): void {
    const pillarStone = stoneSurface();
    const stone = this.track(
      new THREE.MeshStandardMaterial({
        map: this.track(flagstoneTexture()),
        color: 0x554e44,
        roughness: 0.92,
        metalness: 0.02,
        normalMap: pillarStone.normalMap,
        normalScale: new THREE.Vector2(1.05, 1.05),
        roughnessMap: pillarStone.roughnessMap,
      }),
    );
    this.pillarMaterial = stone;
    const pillarGeo = this.track(new THREE.CylinderGeometry(0.62, 0.72, 10, 14, 1));
    const capitalGeo = this.track(new THREE.BoxGeometry(1.7, 0.5, 1.7));
    const archGeo = this.track(new THREE.TorusGeometry(2.1, 0.34, 8, 20, Math.PI));

    const radius = 12.5;
    const count = 12;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      const pillar = new THREE.Mesh(pillarGeo, stone);
      pillar.position.set(x, 4.4, z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      this.group.add(pillar);

      const capital = new THREE.Mesh(capitalGeo, stone);
      capital.position.set(x, 9.6, z);
      capital.rotation.y = -angle;
      this.group.add(capital);

      const base = new THREE.Mesh(capitalGeo, stone);
      base.position.set(x, -0.5, z);
      base.scale.set(1.2, 0.9, 1.2);
      this.group.add(base);

      // Arch spanning to the next pillar.
      const next = ((i + 1) / count) * Math.PI * 2;
      const mid = (angle + next) / 2;
      const arch = new THREE.Mesh(archGeo, stone);
      arch.position.set(Math.cos(mid) * radius, 9.5, Math.sin(mid) * radius);
      arch.rotation.y = -mid + Math.PI / 2;
      this.group.add(arch);
    }

    // Curtain wall: one intact stretch carrying the high windows, the rest
    // battered down to waist-height stumps so the war outside reads through.
    const wallMat = this.track(
      new THREE.MeshStandardMaterial({
        map: this.track(flagstoneTexture()),
        // Was 0x2e2a26 (linear luminance 0.0167) - under the 0.02 albedo
        // floor, so it read as a black hole rather than dark stone.
        color: 0x3a352f,
        roughness: 1,
        side: THREE.DoubleSide,
        normalMap: pillarStone.normalMap,
        normalScale: new THREE.Vector2(1.15, 1.15),
        roughnessMap: pillarStone.roughnessMap,
      }),
    );
    this.wallMaterial = wallMat;
    const wallMap = wallMat.map;
    if (wallMap) wallMap.repeat.set(10, 3);

    /** Arc of curtain wall centred on `centre` (same angle space as the pillars). */
    const wallArc = (centre: number, span: number, height: number): void => {
      const geometry = this.track(
        new THREE.CylinderGeometry(17, 17.4, height, Math.max(6, Math.round(span * 12)), 1, true, Math.PI / 2 - centre - span / 2, span),
      );
      const arc = new THREE.Mesh(geometry, wallMat);
      arc.position.y = height / 2 - 0.6;
      arc.castShadow = true;
      arc.receiveShadow = true;
      this.group.add(arc);
    };

    // Intact northern wall behind the windows.
    wallArc(-Math.PI / 2, 1.9, 20);

    // Ruined remainder: alternating stumps and open breaches.
    const ruins: [number, number, number][] = [
      [-0.28, 0.72, 6.4],
      [0.62, 0.5, 3.1],
      [1.42, 0.66, 5.2],
      [2.15, 0.42, 2.2],
      [2.95, 0.8, 7.1],
      [3.72, 0.34, 1.8],
      [4.35, 0.62, 4.6],
      [5.1, 0.44, 2.6],
    ];
    for (const [centre, span, height] of ruins) wallArc(centre, span, height);

    // Rubble heaped where the wall came down.
    const rubbleGeo = this.track(new THREE.IcosahedronGeometry(0.9, 0));
    const rubbleMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0x3b352d,
        roughness: 1,
        normalMap: pillarStone.normalMap,
        normalScale: new THREE.Vector2(1.3, 1.3),
        roughnessMap: pillarStone.roughnessMap,
      }),
    );
    this.rubbleMaterial = rubbleMat;
    const rubble = new THREE.InstancedMesh(rubbleGeo, rubbleMat, 54);
    rubble.castShadow = true;
    rubble.receiveShadow = true;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 54; i += 1) {
      const angle = (i / 54) * Math.PI * 2 + Math.sin(i * 3.7) * 0.05;
      const distance = 16.4 + Math.sin(i * 2.3) * 1.6;
      dummy.position.set(Math.cos(angle) * distance, -0.62 + Math.abs(Math.sin(i * 5.1)) * 0.4, Math.sin(angle) * distance);
      dummy.rotation.set(i * 1.7, i * 0.9, i * 2.3);
      dummy.scale.set(0.4 + Math.abs(Math.sin(i)) * 0.9, 0.3 + Math.abs(Math.cos(i * 1.3)) * 0.5, 0.4 + Math.abs(Math.cos(i)) * 0.9);
      dummy.updateMatrix();
      rubble.setMatrixAt(i, dummy.matrix);
    }
    rubble.instanceMatrix.needsUpdate = true;
    this.group.add(rubble);

    // High windows: emissive quads that read as openings and feed the bloom pass.
    const windowGeo = this.track(new THREE.PlaneGeometry(2.2, 4.4));
    const windowMat = this.track(
      new THREE.MeshBasicMaterial({ color: 0xffd9a6, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    this.windowMaterial = windowMat;
    const shaftMat = this.track(
      new THREE.MeshBasicMaterial({
        map: this.track(shaftTexture()),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        opacity: 0.75,
      }),
    );
    const shaftGeo = this.track(new THREE.PlaneGeometry(3.4, 18));

    for (let i = 0; i < 3; i += 1) {
      const angle = -Math.PI / 2 + (i - 1) * 0.42;
      const x = Math.cos(angle) * 16.4;
      const z = Math.sin(angle) * 16.4;
      const win = new THREE.Mesh(windowGeo, windowMat);
      win.position.set(x, 11.5, z);
      win.lookAt(0, 11.5, 0);
      this.group.add(win);

      const shaft = new THREE.Mesh(shaftGeo, shaftMat.clone());
      shaft.position.set(x * 0.55, 6.4, z * 0.55);
      shaft.rotation.set(-0.42, angle + Math.PI / 2, 0);
      shaft.renderOrder = 2;
      this.shafts.push(shaft);
      this.group.add(shaft);
    }
  }

  private buildTorches(): void {
    const bracketMat = this.track(new THREE.MeshStandardMaterial({
        // Wrought iron: metals are binary. 0.6 was a non-physical blend and
        // the albedo sat under the 0.02 floor.
        color: 0x3a2f22,
        roughness: 0.62,
        metalness: 1,
      }));
    const bowlGeo = this.track(new THREE.CylinderGeometry(0.42, 0.22, 0.42, 12));
    const stemGeo = this.track(new THREE.CylinderGeometry(0.1, 0.14, 3.4, 8));
    const flameGeo = this.track(new THREE.SphereGeometry(0.3, 12, 12));

    const positions: [number, number][] = [
      [-8.6, 8.6],
      [8.6, 8.6],
      [-8.6, -8.6],
      [8.6, -8.6],
    ];

    positions.forEach(([x, z], index) => {
      const stem = new THREE.Mesh(stemGeo, bracketMat);
      stem.position.set(x, 1.1, z);
      stem.castShadow = true;
      this.group.add(stem);

      const bowl = new THREE.Mesh(bowlGeo, bracketMat);
      bowl.position.set(x, 2.95, z);
      this.group.add(bowl);

      const flameMat = this.track(
        new THREE.MeshBasicMaterial({ color: 0xffa63c, transparent: true, opacity: 0.95 }),
      );
      this.flameMaterials.push(flameMat);
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(x, 3.25, z);
      flame.scale.set(1, 1.6, 1);
      this.group.add(flame);

      const light = new THREE.PointLight(0xff7a2a, 26, 22, 2);
      light.position.set(x, 3.4, z);
      this.group.add(light);

      this.torches.push({ light, flame, seed: index * 12.7, base: 26 });
    });
  }

  private buildParticles(dustCount: number, emberCount: number): void {
    this.disposeParticles();
    const sprite = this.track(sparkTexture());

    if (dustCount > 0) {
      const positions = new Float32Array(dustCount * 3);
      this.dustPhase = new Float32Array(dustCount);
      for (let i = 0; i < dustCount; i += 1) {
        positions[i * 3] = (Math.random() - 0.5) * 22;
        positions[i * 3 + 1] = Math.random() * 9;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 22;
        this.dustPhase[i] = Math.random() * Math.PI * 2;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        size: 0.055,
        map: sprite,
        color: this.look.dust.color,
        transparent: true,
        opacity: this.look.dust.opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      });
      this.dust = new THREE.Points(geometry, material);
      this.dust.frustumCulled = false;
      this.group.add(this.dust);
    }

    if (emberCount > 0) {
      const positions = new Float32Array(emberCount * 3);
      this.emberVelocities = new Float32Array(emberCount);
      const anchors: [number, number][] = [
        [-8.6, 8.6],
        [8.6, 8.6],
        [-8.6, -8.6],
        [8.6, -8.6],
      ];
      for (let i = 0; i < emberCount; i += 1) {
        const [ax, az] = anchors[i % anchors.length];
        positions[i * 3] = ax + (Math.random() - 0.5) * 0.7;
        positions[i * 3 + 1] = 3.2 + Math.random() * 3;
        positions[i * 3 + 2] = az + (Math.random() - 0.5) * 0.7;
        this.emberVelocities[i] = 0.35 + Math.random() * 0.7;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        size: 0.09,
        map: sprite,
        color: 0xff9a3c,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.embers = new THREE.Points(geometry, material);
      this.embers.frustumCulled = false;
      this.group.add(this.embers);
    }
  }

  private disposeParticles(): void {
    for (const points of [this.dust, this.embers]) {
      if (!points) continue;
      this.group.remove(points);
      points.geometry.dispose();
      (points.material as THREE.Material).dispose();
    }
    this.dust = null;
    this.embers = null;
  }

  applyQuality(preset: QualityPreset): void {
    this.quality = preset;
    const settings = QUALITY_SETTINGS[preset];
    this.keyLight.castShadow = settings.shadows;
    this.keyLight.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
    if (this.keyLight.shadow.map) {
      this.keyLight.shadow.map.dispose();
      this.keyLight.shadow.map = null;
    }
    for (const shaft of this.shafts) shaft.visible = settings.lightShafts;
    this.buildParticles(settings.dustCount, settings.emberCount);
  }

  /**
   * Relights the hall for an arena theme: lamps, stone tints, glass, shafts and
   * torch strength. Daylight themes keep the torches burning but pull them right
   * back so they read as decoration rather than the only source of light.
   */
  applyArena(look: ArenaLook): void {
    this.look = look;

    this.hemi.color.setHex(look.hemi.sky);
    this.hemi.groundColor.setHex(look.hemi.ground);
    this.hemi.intensity = look.hemi.intensity;

    this.keyLight.color.setHex(look.keyLight.color);
    this.keyLight.intensity = look.keyLight.intensity;
    this.keyLight.position.set(...look.keyLight.position);

    this.fillLight.color.setHex(look.fill.color);
    this.fillLight.intensity = look.fill.intensity;
    this.fillLight.position.set(...look.fill.position);

    this.floorMaterial?.color.setHex(look.stone.floor);
    this.daisMaterial?.color.setHex(look.stone.dais);
    this.pillarMaterial?.color.setHex(look.stone.pillar);
    this.wallMaterial?.color.setHex(look.stone.wall);
    this.rubbleMaterial?.color.setHex(look.stone.rubble);

    if (this.windowMaterial) {
      this.windowMaterial.color.setHex(look.window.color);
      this.windowMaterial.opacity = look.window.opacity;
    }
    for (const shaft of this.shafts) {
      const material = shaft.material as THREE.MeshBasicMaterial;
      material.color.setHex(look.shaft.color);
    }
    for (const flame of this.flameMaterials) flame.opacity = 0.95 * look.torch.flame;

    if (this.dust) {
      const material = this.dust.material as THREE.PointsMaterial;
      material.color.setHex(look.dust.color);
      material.opacity = look.dust.opacity;
    }
    if (this.embers) {
      const material = this.embers.material as THREE.PointsMaterial;
      material.opacity = 0.85 * Math.max(0.35, look.torch.flame);
    }
  }

  update(delta: number): void {
    this.elapsed += delta;

    const torchScale = this.look.torch.intensity;
    for (const torch of this.torches) {
      // Layered sines approximate flame noise without a texture lookup.
      const t = this.elapsed * 6 + torch.seed;
      const flicker = 0.72 + Math.sin(t) * 0.12 + Math.sin(t * 2.37) * 0.09 + Math.sin(t * 5.11) * 0.06;
      torch.light.intensity = torch.base * flicker * torchScale;
      const scale = 0.9 + flicker * 0.28;
      torch.flame.scale.set(scale, scale * 1.65, scale);
    }

    if (this.dust) {
      const attribute = this.dust.geometry.getAttribute("position") as THREE.BufferAttribute;
      const array = attribute.array as Float32Array;
      for (let i = 0; i < this.dustPhase.length; i += 1) {
        const phase = this.dustPhase[i] + this.elapsed * 0.25;
        array[i * 3] += Math.sin(phase) * 0.0016;
        array[i * 3 + 1] += 0.0035 + Math.cos(phase * 0.7) * 0.001;
        array[i * 3 + 2] += Math.cos(phase * 1.3) * 0.0016;
        if (array[i * 3 + 1] > 9.5) array[i * 3 + 1] = 0.1;
      }
      attribute.needsUpdate = true;
    }

    if (this.embers) {
      const attribute = this.embers.geometry.getAttribute("position") as THREE.BufferAttribute;
      const array = attribute.array as Float32Array;
      for (let i = 0; i < this.emberVelocities.length; i += 1) {
        array[i * 3 + 1] += this.emberVelocities[i] * delta;
        array[i * 3] += Math.sin(this.elapsed * 2 + i) * 0.004;
        if (array[i * 3 + 1] > 8.5) {
          array[i * 3 + 1] = 3.1;
        }
      }
      attribute.needsUpdate = true;
    }

    const shaftPeak = this.look.shaft.opacity;
    for (const shaft of this.shafts) {
      const material = shaft.material as THREE.MeshBasicMaterial;
      material.opacity = shaftPeak * (0.78 + Math.sin(this.elapsed * 0.7 + shaft.position.x) * 0.17);
    }
  }

  dispose(): void {
    this.disposeParticles();
    for (const item of this.disposables) item.dispose();
    this.disposables = [];
    this.group.clear();
  }
}

/**
 * PMREM environment built from a procedural gradient dome plus warm emissive
 * panels, so armour and polished marble reflect the hall instead of a void.
 */
export function buildEnvironmentMap(
  renderer: THREE.WebGLRenderer,
  look: ArenaLook = ARENA_LOOKS[DEFAULT_ARENA],
): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const scene = new THREE.Scene();
  const domeGeometry = new THREE.SphereGeometry(30, 24, 16);
  const domeMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(look.environment.top) },
      bottomColor: { value: new THREE.Color(look.environment.bottom) },
      glowColor: { value: new THREE.Color(look.environment.glow) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPosition;
      void main() {
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform vec3 glowColor;
      varying vec3 vPosition;
      void main() {
        float h = normalize(vPosition).y * 0.5 + 0.5;
        vec3 color = mix(bottomColor, topColor, pow(h, 0.8));
        color += glowColor * pow(1.0 - abs(h - 0.35) * 2.2, 4.0) * 0.6;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(domeGeometry, domeMaterial);
  scene.add(dome);

  const panelGeometry = new THREE.PlaneGeometry(6, 6);
  const warm = new THREE.MeshBasicMaterial({ color: look.environment.warm });
  const cool = new THREE.MeshBasicMaterial({ color: look.environment.cool });
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const panel = new THREE.Mesh(panelGeometry, i % 2 === 0 ? warm : cool);
    panel.position.set(Math.cos(angle) * 12, 4 + (i % 2) * 4, Math.sin(angle) * 12);
    panel.lookAt(0, 4, 0);
    scene.add(panel);
  }

  const target = pmrem.fromScene(scene, 0.04);
  domeGeometry.dispose();
  domeMaterial.dispose();
  panelGeometry.dispose();
  warm.dispose();
  cool.dispose();
  pmrem.dispose();
  return target.texture;
}
