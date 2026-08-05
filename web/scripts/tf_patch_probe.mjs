// Adds a measurement probe to SceneEngine: exposes window.__kg with scene stats,
// material census and a framebuffer luminance histogram. Read-only instrument.
import fs from "node:fs";

const file = "C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess/web/src/scene/sceneEngine.ts";
let src = fs.readFileSync(file, "utf8");
const nl = src.includes("\r\n") ? "\r\n" : "\n";
const L = (...lines) => lines.join(nl);

if (src.includes("installProbe()")) {
  console.log("probe: ALREADY");
  process.exit(0);
}

// Call installProbe at the end of the constructor (after handleResize()).
const anchor = "    this.handleResize();" + nl + "  }";
if (!src.includes(anchor)) {
  console.log("probe anchor: MISS");
  process.exit(1);
}
src = src.replace(anchor, L("    this.handleResize();", "    if (this.review.probe) this.installProbe();", "  }"));

// Insert the probe method just before "  // ---------------------------------------------------------------- lifecycle"
const methodAnchor = "  // ---------------------------------------------------------------- lifecycle";
const probe = L(
  "  /**",
  "   * Measurement probe for the capture harness. Exposes the real rendered state",
  "   * so a visual claim can be backed by numbers instead of an opinion: scene",
  "   * counts, a material census (albedo luminance, metalness, map channels) and",
  "   * a luminance histogram sampled off the actual framebuffer.",
  "   */",
  "  private installProbe(): void {",
  "    const srgbToLinear = (c: number): number =>",
  "      c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);",
  "",
  "    const api = {",
  "      ready: () => this.factory.isReady,",
  "      arena: () => this.arena,",
  "      preset: () => this.preset,",
  "      postEnabled: () => this.postfx.enabled,",
  "      exposure: () => this.renderer.toneMappingExposure,",
  "      info: () => ({",
  "        calls: this.renderer.info.render.calls,",
  "        triangles: this.renderer.info.render.triangles,",
  "        programs: this.renderer.info.programs?.length ?? 0,",
  "        geometries: this.renderer.info.memory.geometries,",
  "        textures: this.renderer.info.memory.textures,",
  "      }),",
  "      /** Every light actually in the graph, with its contribution. */",
  "      lights: () => {",
  "        const out: Record<string, unknown>[] = [];",
  "        this.scene.traverse((node) => {",
  "          const light = node as THREE.Light;",
  "          if (!light.isLight) return;",
  "          out.push({",
  "            type: light.type,",
  "            name: light.name,",
  "            visible: light.visible,",
  "            intensity: light.intensity,",
  "            color: `#${light.color.getHexString()}`,",
  "            luminance: light.intensity * light.color.getHSL({ h: 0, s: 0, l: 0 }).l,",
  "          });",
  "        });",
  "        return out;",
  "      },",
  "      /** Material census against the photometric bar. */",
  "      materials: () => {",
  "        const seen = new Set<string>();",
  "        const rows: Record<string, unknown>[] = [];",
  "        this.scene.traverse((node) => {",
  "          const mesh = node as THREE.Mesh;",
  "          if (!mesh.isMesh) return;",
  "          const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];",
  "          for (const raw of list) {",
  "            const m = raw as THREE.MeshStandardMaterial;",
  "            if (!m || seen.has(m.uuid)) continue;",
  "            seen.add(m.uuid);",
  "            const isStd = Boolean(m.isMeshStandardMaterial);",
  "            let lum: number | null = null;",
  "            if (m.color) {",
  "              lum =",
  "                0.2126 * srgbToLinear(m.color.r) +",
  "                0.7152 * srgbToLinear(m.color.g) +",
  "                0.0722 * srgbToLinear(m.color.b);",
  "            }",
  "            rows.push({",
  "              type: m.type,",
  "              std: isStd,",
  "              albedoLum: lum,",
  "              roughness: isStd ? m.roughness : null,",
  "              metalness: isStd ? m.metalness : null,",
  "              map: Boolean(m.map),",
  "              normalMap: Boolean(m.normalMap),",
  "              roughnessMap: Boolean(m.roughnessMap),",
  "              aoMap: Boolean(m.aoMap),",
  "            });",
  "          }",
  "        });",
  "        return rows;",
  "      },",
  "      /** Luminance histogram off the real framebuffer. */",
  "      histogram: () => {",
  "        const gl = this.renderer.getContext();",
  "        const w = gl.drawingBufferWidth;",
  "        const h = gl.drawingBufferHeight;",
  "        const px = new Uint8Array(w * h * 4);",
  "        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);",
  "        const bins = new Array(16).fill(0);",
  "        let sum = 0;",
  "        let count = 0;",
  "        let black = 0;",
  "        let clipped = 0;",
  "        for (let i = 0; i < px.length; i += 4) {",
  "          const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;",
  "          bins[Math.min(15, Math.floor(l * 16))] += 1;",
  "          sum += l;",
  "          count += 1;",
  "          if (l < 0.02) black += 1;",
  "          if (l > 0.98) clipped += 1;",
  "        }",
  "        return {",
  "          width: w,",
  "          height: h,",
  "          mean: sum / count,",
  "          blackFraction: black / count,",
  "          clippedFraction: clipped / count,",
  "          bins: bins.map((b) => b / count),",
  "        };",
  "      },",
  "      /** Frame-time distribution over n frames. */",
  "      frameTimes: () => this.probeFrameTimes.slice(),",
  "      resetFrameTimes: () => {",
  "        this.probeFrameTimes = [];",
  "      },",
  "      setArena: (theme: ArenaTheme) => this.setArena(theme),",
  "      setQuality: (preset: QualityPreset) => this.setQuality(preset),",
  "      setCamera: (preset: CameraPreset) => this.setCameraPreset(preset),",
  "    };",
  "",
  "    (window as unknown as { __kg: typeof api }).__kg = api;",
  "  }",
  "",
  methodAnchor,
);

src = src.replace(methodAnchor, probe);

// frame-time recorder field + capture in frame()
src = src.replace(
  "  private frameId = 0;",
  L("  private probeFrameTimes: number[] = [];", "  private frameId = 0;"),
);
src = src.replace(
  "    this.guardAgainstBlackFrames();",
  L(
    "    if (this.review.probe) {",
    "      this.probeFrameTimes.push(delta * 1000);",
    "      if (this.probeFrameTimes.length > 2000) this.probeFrameTimes.shift();",
    "    }",
    "    this.guardAgainstBlackFrames();",
  ),
);

fs.writeFileSync(file, src);
console.log("probe: OK");
