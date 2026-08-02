import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

import type { ArenaLook } from "./arena";
import { ARENA_LOOKS, DEFAULT_ARENA } from "./arena";
import { QUALITY_SETTINGS, type QualityPreset } from "./quality";

/**
 * Warm/cool medieval grade: lifted blacks, split-toned highlights and shadows,
 * gentle grain and a vignette. Runs after tone mapping, before SMAA.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 1.05 },
    uGrain: { value: 0.045 },
    uLift: { value: 0.02 },
    uStrength: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uLift;
    uniform float uStrength;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = texel.rgb;
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));

      // Split tone: torchlight into highlights, moonlit steel into shadows.
      vec3 warm = vec3(1.06, 0.99, 0.88);
      vec3 cool = vec3(0.86, 0.93, 1.10);
      vec3 graded = color * mix(cool, warm, smoothstep(0.15, 0.75, luma));

      // Filmic contrast with lifted blacks.
      graded = mix(vec3(uLift), graded, 1.04);
      graded = clamp((graded - 0.5) * 1.06 + 0.5, 0.0, 1.4);

      // Vignette.
      vec2 centred = vUv - 0.5;
      float vignette = 1.0 - dot(centred, centred) * uVignette;
      graded *= clamp(vignette, 0.0, 1.0);

      // Film grain.
      float grain = (hash(vUv * 512.0 + fract(uTime) * 97.0) - 0.5) * uGrain;
      graded += grain;

      gl_FragColor = vec4(mix(color, graded, uStrength), texel.a);
    }
  `,
};

/**
 * Cinematic pipeline. Passes are rebuilt whenever the graphics preset changes so
 * each preset really does cost less — Low bypasses the composer entirely.
 */
export class PostFX {
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private bokehPass: BokehPass | null = null;
  private gradePass: ShaderPass | null = null;
  private ssaoPass: SSAOPass | null = null;
  private preset: QualityPreset;
  private grade: ArenaLook["grade"] = ARENA_LOOKS[DEFAULT_ARENA].grade;
  private bloom: ArenaLook["bloom"] = ARENA_LOOKS[DEFAULT_ARENA].bloom;
  private cinematic = false;
  private elapsed = 0;
  /** Set when a pass misbehaves on this GPU — from then on we render straight. */
  private direct = false;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    this.preset = "high";
  }

  get enabled(): boolean {
    return this.composer !== null;
  }

  setPreset(preset: QualityPreset): void {
    this.preset = preset;
    this.build();
  }

  private build(): void {
    this.dispose();
    const settings = QUALITY_SETTINGS[this.preset];
    if (this.direct || !settings.postFx) return;

    const size = new THREE.Vector2();
    this.renderer.getSize(size);

    const composer = new EffectComposer(this.renderer);
    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.setSize(size.x, size.y);

    const renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(renderPass);

    // SSAO only multiplies occlusion onto the buffer the RenderPass filled —
    // it never draws the beauty pass itself, so RenderPass must stay enabled.
    if (settings.ssao) {
      const ssao = new SSAOPass(this.scene, this.camera, size.x, size.y);
      ssao.kernelRadius = 0.35;
      ssao.minDistance = 0.0015;
      ssao.maxDistance = 0.12;
      composer.addPass(ssao);
      this.ssaoPass = ssao;
    }

    if (settings.bloom) {
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        this.bloom.strength,
        this.bloom.radius,
        this.bloom.threshold,
      );
      composer.addPass(bloom);
      this.bloomPass = bloom;
    }

    if (settings.dof) {
      const bokeh = new BokehPass(this.scene, this.camera, { focus: 11, aperture: 0.0016, maxblur: 0.008 });
      bokeh.enabled = false;
      composer.addPass(bokeh);
      this.bokehPass = bokeh;
    }

    composer.addPass(new OutputPass());

    if (settings.grade) {
      const grade = new ShaderPass(GradeShader);
      composer.addPass(grade);
      this.gradePass = grade;
      this.pushGrade();
    }

    if (settings.smaa) {
      composer.addPass(new SMAAPass());
    }

    this.composer = composer;
  }

  /**
   * Arena themes carry their own grade: the dusk siege keeps the heavy vignette
   * and grain, daylight maps pull both right back so the sculpts stay crisp.
   */
  setGrade(grade: ArenaLook["grade"]): void {
    this.grade = grade;
    this.pushGrade();
  }

  /**
   * Daylight maps need a much higher bloom threshold: their tiles already sit
   * near white after tone mapping, so a dusk-tuned threshold makes the whole
   * board glow and washes the sculpts out.
   */
  setBloom(bloom: ArenaLook["bloom"]): void {
    this.bloom = bloom;
    if (!this.bloomPass) return;
    this.bloomPass.strength = bloom.strength;
    this.bloomPass.radius = bloom.radius;
    this.bloomPass.threshold = bloom.threshold;
  }

  private pushGrade(): void {
    if (!this.gradePass) return;
    const uniforms = this.gradePass.uniforms as unknown as Record<string, { value: number }>;
    uniforms.uVignette.value = this.grade.vignette;
    uniforms.uGrain.value = this.grade.grain;
    uniforms.uLift.value = this.grade.lift;
    uniforms.uStrength.value = this.grade.strength;
  }

  /** Enables depth of field for the intro, promotion picker and checkmate dolly. */
  setCinematic(active: boolean, focus = 11): void {
    this.cinematic = active;
    if (!this.bokehPass) return;
    this.bokehPass.enabled = active;
    const uniforms = this.bokehPass.uniforms as unknown as Record<string, { value: number }>;
    if (uniforms.focus) uniforms.focus.value = focus;
  }

  get isCinematic(): boolean {
    return this.cinematic;
  }

  setSize(width: number, height: number): void {
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(width, height);
    if (this.ssaoPass) this.ssaoPass.setSize(width, height);
  }

  /**
   * Permanently drops back to a plain forward render. Used when the composer
   * throws or produces an empty frame on the player's GPU.
   */
  forceDirect(reason: string): void {
    if (this.direct) return;
    this.direct = true;
    console.warn(`[postfx] disabling post-processing: ${reason}`);
    this.dispose();
  }

  render(delta: number): void {
    this.elapsed += delta;
    if (this.gradePass) {
      (this.gradePass.uniforms as unknown as Record<string, { value: number }>).uTime.value = this.elapsed;
    }
    if (this.composer) {
      try {
        this.composer.render(delta);
        return;
      } catch (error) {
        this.forceDirect(`composer error (${String(error)})`);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloomPass = null;
    this.bokehPass = null;
    this.gradePass = null;
    this.ssaoPass = null;
  }
}
