// Add badgeMetrics() - on-screen pixel footprint of each rank badge sprite at
// the live play camera. Legibility is a screen-space property, so a badge must
// be measured in pixels through the actual camera, not in world units.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(__dirname, "..", "src", "scene", "sceneEngine.ts");
let src = fs.readFileSync(file, "utf8");

if (src.includes("badgeMetrics")) {
  console.log("SKIP already present");
  process.exit(0);
}

const anchor = "      materials: () => {";
if (!src.includes(anchor)) { console.log("FAIL anchor missing"); process.exit(1); }

const block = [
  "      /**",
  "       * On-screen size of every rank badge, projected through the live",
  "       * camera. Legibility is screen-space: a badge is only readable if its",
  "       * rendered footprint is large enough at the real play distance.",
  "       */",
  "      badgeMetrics: () => {",
  "        const cam = this.camera;",
  "        cam.updateMatrixWorld();",
  "        const w = this.renderer.domElement.width;",
  "        const h = this.renderer.domElement.height;",
  "        const shots: Record<string, unknown>[] = [];",
  "        const a = new THREE.Vector3();",
  "        const b = new THREE.Vector3();",
  "        this.scene.traverse((node) => {",
  "          const sprite = node as THREE.Sprite;",
  "          if (!sprite.isSprite || !sprite.visible) return;",
  "          if (!node.name || node.name.indexOf('badge') === -1) return;",
  "          sprite.updateMatrixWorld();",
  "          // Project the sprite centre and a point one half-height above it;",
  "          // the pixel gap between them is the on-screen half size.",
  "          a.setFromMatrixPosition(sprite.matrixWorld);",
  "          b.copy(a);",
  "          b.y += sprite.scale.y * 0.5;",
  "          const dist = a.distanceTo(cam.position);",
  "          a.project(cam);",
  "          b.project(cam);",
  "          const ax = (a.x * 0.5 + 0.5) * w;",
  "          const ay = (-a.y * 0.5 + 0.5) * h;",
  "          const by = (-b.y * 0.5 + 0.5) * h;",
  "          const halfPx = Math.abs(ay - by);",
  "          shots.push({",
  "            name: node.name,",
  "            x: Number(ax.toFixed(1)),",
  "            y: Number(ay.toFixed(1)),",
  "            pxHeight: Number((halfPx * 2).toFixed(1)),",
  "            camDistance: Number(dist.toFixed(2)),",
  "            onScreen: ax >= 0 && ax <= w && ay >= 0 && ay <= h && a.z < 1,",
  "          });",
  "        });",
  "        shots.sort((p, q) => (q.pxHeight as number) - (p.pxHeight as number));",
  "        const visible = shots.filter((s) => s.onScreen);",
  "        const heights = visible.map((s) => s.pxHeight as number);",
  "        return {",
  "          canvas: { w, h },",
  "          badgeCount: shots.length,",
  "          onScreenCount: visible.length,",
  "          minPx: heights.length ? Math.min(...heights) : null,",
  "          maxPx: heights.length ? Math.max(...heights) : null,",
  "          medianPx: heights.length ? heights.sort((p, q) => p - q)[Math.floor(heights.length / 2)] : null,",
  "          shots: visible.slice(0, 12),",
  "        };",
  "      },",
].join("\r\n");

src = src.replace(anchor, block + "\r\n" + anchor);
fs.writeFileSync(file, src);
console.log("OK added badgeMetrics");
