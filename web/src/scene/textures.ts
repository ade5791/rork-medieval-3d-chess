import * as THREE from "three";

/**
 * Procedural CC0-free textures. Everything is painted into canvases at boot so
 * the game ships without texture downloads and still gets marble veining,
 * pitted basalt, engraved rank/file labels and soft particle sprites.
 */

function createCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  return { canvas, ctx };
}

function toTexture(canvas: HTMLCanvasElement, repeat = 1, srgb = true): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 8;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function grain(ctx: CanvasRenderingContext2D, size: number, amount: number, alpha: number): void {
  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * amount;
    data[i] = Math.max(0, Math.min(255, data[i] + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    data[i + 3] = Math.max(0, Math.min(255, data[i + 3] * alpha + 255 * (1 - alpha)));
  }
  ctx.putImageData(image, 0, 0);
}

/** Soft veined marble. `dark` swaps to basalt colouring. */
export function marbleTexture(dark: boolean): THREE.CanvasTexture {
  const size = 512;
  const { canvas, ctx } = createCanvas(size);
  ctx.fillStyle = dark ? "#191a20" : "#e9e2d2";
  ctx.fillRect(0, 0, size, size);

  // Broad tonal blotches.
  for (let i = 0; i < 26; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 40 + Math.random() * 150;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = dark ? 40 + Math.random() * 25 : 205 + Math.random() * 40;
    gradient.addColorStop(0, `rgba(${tone},${tone},${tone + (dark ? 6 : 0)},0.35)`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Veins: random walks with tapering width.
  const veins = dark ? 8 : 16;
  for (let v = 0; v < veins; v += 1) {
    let x = Math.random() * size;
    let y = Math.random() * size;
    let angle = Math.random() * Math.PI * 2;
    ctx.strokeStyle = dark ? "rgba(96,102,120,0.22)" : "rgba(120,116,104,0.34)";
    ctx.lineWidth = 0.6 + Math.random() * 1.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 60 + Math.floor(Math.random() * 60);
    for (let s = 0; s < steps; s += 1) {
      angle += (Math.random() - 0.5) * 0.7;
      x += Math.cos(angle) * 7;
      y += Math.sin(angle) * 7;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  grain(ctx, size, dark ? 16 : 12, 1);
  return toTexture(canvas);
}

/** Rough castle flagstone floor with mortar joints. */
export function flagstoneTexture(): THREE.CanvasTexture {
  const size = 512;
  const { canvas, ctx } = createCanvas(size);
  ctx.fillStyle = "#1b1a19";
  ctx.fillRect(0, 0, size, size);

  const cell = size / 4;
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const offset = row % 2 === 0 ? 0 : cell / 2;
      const x = (col * cell + offset) % size;
      const y = row * cell;
      const shade = 38 + Math.random() * 26;
      ctx.fillStyle = `rgb(${shade},${shade - 2},${shade - 5})`;
      ctx.fillRect(x + 3, y + 3, cell - 6, cell - 6);
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fillRect(x + 3, y + 3, cell - 6, 3);
    }
  }
  grain(ctx, size, 26, 1);
  return toTexture(canvas);
}

/** Bronze-trimmed border with engraved a–h / 1–8 labels, mapped to the base top. */
export function boardBorderTexture(): THREE.CanvasTexture {
  const size = 1024;
  const { canvas, ctx } = createCanvas(size);
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];

  ctx.fillStyle = "#221d17";
  ctx.fillRect(0, 0, size, size);

  // Carved stone ring.
  const border = size * 0.085;
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, "#4a4136");
  gradient.addColorStop(0.5, "#332c24");
  gradient.addColorStop(1, "#241f19");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // Bronze inlay line.
  ctx.strokeStyle = "#8a6a34";
  ctx.lineWidth = 6;
  ctx.strokeRect(border * 0.55, border * 0.55, size - border * 1.1, size - border * 1.1);
  ctx.strokeStyle = "rgba(214,178,102,0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(border * 0.55 + 5, border * 0.55 + 5, size - border * 1.1 - 10, size - border * 1.1 - 10);

  // Inner well (hidden by the tiles, kept dark).
  ctx.fillStyle = "#0e0c0a";
  ctx.fillRect(border, border, size - border * 2, size - border * 2);

  const inner = size - border * 2;
  const step = inner / 8;
  ctx.font = `600 ${Math.floor(border * 0.52)}px "Cinzel", Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let i = 0; i < 8; i += 1) {
    const centre = border + step * (i + 0.5);
    const engrave = (text: string, x: number, y: number): void => {
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillText(text, x + 2, y + 2);
      ctx.fillStyle = "rgba(212,175,105,0.85)";
      ctx.fillText(text, x, y);
    };
    engrave(files[i], centre, border * 0.5);
    engrave(files[i], centre, size - border * 0.5);
    engrave(String(8 - i), border * 0.5, centre);
    engrave(String(8 - i), size - border * 0.5, centre);
  }

  grain(ctx, size, 14, 1);
  return toTexture(canvas, 1);
}

/** Radial falloff used for contact shadows and glow discs. */
export function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.55, inner);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Reticle drawn on a legal destination square: a bright core dot ringed by a
 * thin halo. Crisp enough to read through torchlight and bloom.
 */
export function moveMarkerTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;

  const core = ctx.createRadialGradient(c, c, 0, c, c, size * 0.19);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(0.45, "rgba(255,255,255,0.85)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.19, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = size * 0.022;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.38, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = size * 0.01;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.44, 0, Math.PI * 2);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Target lock drawn on a capture square: four bracket arcs plus tick marks. */
export function captureMarkerTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;

  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineCap = "round";
  ctx.lineWidth = size * 0.05;
  for (let i = 0; i < 4; i += 1) {
    const start = i * (Math.PI / 2) + Math.PI * 0.12;
    ctx.beginPath();
    ctx.arc(c, c, size * 0.37, start, start + Math.PI * 0.26);
    ctx.stroke();
  }

  ctx.lineWidth = size * 0.018;
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  for (let i = 0; i < 4; i += 1) {
    const angle = i * (Math.PI / 2);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(c + dx * size * 0.15, c + dy * size * 0.15);
    ctx.lineTo(c + dx * size * 0.25, c + dy * size * 0.25);
    ctx.stroke();
  }

  const core = ctx.createRadialGradient(c, c, 0, c, c, size * 0.46);
  core.addColorStop(0, "rgba(255,255,255,0.28)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Marker for a castling destination: a ring broken by two opposing arrows,
 * reading as "these two pieces trade places".
 */
export function castleMarkerTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;

  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineCap = "round";
  ctx.lineWidth = size * 0.028;
  for (let i = 0; i < 2; i += 1) {
    const start = i * Math.PI + Math.PI * 0.14;
    ctx.beginPath();
    ctx.arc(c, c, size * 0.36, start, start + Math.PI * 0.72);
    ctx.stroke();
  }

  // Two arrow heads on the horizontal axis, pointing away from each other.
  ctx.lineWidth = size * 0.04;
  for (const dir of [-1, 1]) {
    const tip = c + dir * size * 0.42;
    ctx.beginPath();
    ctx.moveTo(tip - dir * size * 0.09, c - size * 0.075);
    ctx.lineTo(tip, c);
    ctx.lineTo(tip - dir * size * 0.09, c + size * 0.075);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = size * 0.022;
  ctx.beginPath();
  ctx.moveTo(c - size * 0.2, c);
  ctx.lineTo(c + size * 0.2, c);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Marker for a promotion square: a crown silhouette inside a spoked halo. */
export function promoteMarkerTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;

  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineCap = "round";
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    ctx.lineWidth = size * (i % 3 === 0 ? 0.022 : 0.012);
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(angle) * size * 0.33, c + Math.sin(angle) * size * 0.33);
    ctx.lineTo(c + Math.cos(angle) * size * 0.44, c + Math.sin(angle) * size * 0.44);
    ctx.stroke();
  }

  // Crown: three peaks on a banded base.
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.moveTo(c - size * 0.2, c + size * 0.08);
  ctx.lineTo(c - size * 0.24, c - size * 0.14);
  ctx.lineTo(c - size * 0.1, c - size * 0.01);
  ctx.lineTo(c, c - size * 0.19);
  ctx.lineTo(c + size * 0.1, c - size * 0.01);
  ctx.lineTo(c + size * 0.24, c - size * 0.14);
  ctx.lineTo(c + size * 0.2, c + size * 0.08);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(c - size * 0.21, c + size * 0.1, size * 0.42, size * 0.05);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Alpha mask shaped like a board tile with feathered edges — used to tint or
 * shade a single square without painting a hard black rectangle.
 */
export function tileMaskTexture(): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size);
  const inset = size * 0.045;
  const span = size - inset * 2;
  const radius = size * 0.1;

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(inset, inset, span, span, radius);
  ctx.fill();
  // Feather the rim so neighbouring shaded squares blend into one another.
  ctx.filter = "blur(4px)";
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = "none";

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Gold frame drawn under the piece the player has picked up. */
export function selectMarkerTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const inset = size * 0.1;
  const span = size - inset * 2;

  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = size * 0.026;
  ctx.strokeRect(inset, inset, span, span);

  // Corner accents so the frame reads as forged metal, not a plain box.
  ctx.lineWidth = size * 0.055;
  ctx.lineCap = "round";
  const arm = size * 0.12;
  const corners: [number, number, number, number][] = [
    [inset, inset, 1, 1],
    [size - inset, inset, -1, 1],
    [inset, size - inset, 1, -1],
    [size - inset, size - inset, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + sx * arm, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * arm);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Upward gradient for the light column standing on a highlighted square. */
export function columnTexture(): THREE.CanvasTexture {
  const size = 64;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.16)");
  gradient.addColorStop(1, "rgba(255,255,255,0.7)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Soft dot sprite for embers, dust and impact sparks. */
export function sparkTexture(): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.25, "rgba(255,226,168,0.85)");
  gradient.addColorStop(1, "rgba(255,150,60,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Expanding shockwave ring used on the square where a capture lands: a hot
 * white rim with a soft inner bloom and a few radial shards.
 */
export function shockwaveTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;

  const ring = ctx.createRadialGradient(c, c, size * 0.16, c, c, size * 0.5);
  ring.addColorStop(0, "rgba(255,255,255,0)");
  ring.addColorStop(0.55, "rgba(255,255,255,0.1)");
  ring.addColorStop(0.82, "rgba(255,255,255,0.95)");
  ring.addColorStop(0.93, "rgba(255,255,255,0.35)");
  ring.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = ring;
  ctx.fillRect(0, 0, size, size);

  // Radial shards give the wave a shattered, debris-thrown feel.
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineCap = "round";
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2 + 0.2;
    const inner = size * (0.3 + Math.random() * 0.1);
    const outer = size * (0.44 + Math.random() * 0.05);
    ctx.lineWidth = size * (0.008 + Math.random() * 0.012);
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(angle) * inner, c + Math.sin(angle) * inner);
    ctx.lineTo(c + Math.cos(angle) * outer, c + Math.sin(angle) * outer);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Soft dust ring thrown out when a figure sets down on a square: a thin bright
 * rim with a wide feathered outer haze and no debris shards — the arrival has
 * to read as weight settling, never as an explosion.
 */
export function landingRingTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;

  const halo = ctx.createRadialGradient(c, c, size * 0.1, c, c, size * 0.5);
  halo.addColorStop(0, "rgba(255,255,255,0)");
  halo.addColorStop(0.62, "rgba(255,255,255,0.06)");
  halo.addColorStop(0.8, "rgba(255,255,255,0.55)");
  halo.addColorStop(0.88, "rgba(255,255,255,0.9)");
  halo.addColorStop(0.95, "rgba(255,255,255,0.18)");
  halo.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  // A few soft lobes break the perfect circle so the ring reads as kicked dust.
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 9; i += 1) {
    const angle = (i / 9) * Math.PI * 2 + Math.random() * 0.4;
    const radius = size * (0.4 + Math.random() * 0.06);
    const blot = ctx.createRadialGradient(
      c + Math.cos(angle) * radius,
      c + Math.sin(angle) * radius,
      0,
      c + Math.cos(angle) * radius,
      c + Math.sin(angle) * radius,
      size * (0.05 + Math.random() * 0.05),
    );
    blot.addColorStop(0, "rgba(0,0,0,0.55)");
    blot.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = blot;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.globalCompositeOperation = "source-over";

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Churned battlefield earth: dark mud, cracks, gravel and wet patches. */
export function mudTexture(): THREE.CanvasTexture {
  const size = 512;
  const { canvas, ctx } = createCanvas(size);
  ctx.fillStyle = "#2a2219";
  ctx.fillRect(0, 0, size, size);

  // Broad tonal patches of drier and wetter ground.
  for (let i = 0; i < 40; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 30 + Math.random() * 120;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    const wet = Math.random() > 0.5;
    gradient.addColorStop(0, wet ? "rgba(18,15,12,0.55)" : "rgba(74,62,45,0.4)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cart ruts and cracks.
  for (let i = 0; i < 26; i += 1) {
    let x = Math.random() * size;
    let y = Math.random() * size;
    let angle = Math.random() * Math.PI * 2;
    ctx.strokeStyle = "rgba(12,10,8,0.5)";
    ctx.lineWidth = 0.8 + Math.random() * 2.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 40; s += 1) {
      angle += (Math.random() - 0.5) * 0.5;
      x += Math.cos(angle) * 9;
      y += Math.sin(angle) * 9;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Gravel and trampled stones.
  for (let i = 0; i < 420; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.6 + Math.random() * 2.4;
    const tone = 40 + Math.random() * 46;
    ctx.fillStyle = `rgba(${tone},${tone - 6},${tone - 14},0.7)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  grain(ctx, size, 30, 1);
  return toTexture(canvas);
}

/** Heraldic camp cloth: base colour with a chevron band and stitched seams. */
export function clothTexture(base: string, accent: string): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = accent;
  ctx.fillRect(0, size * 0.52, size, size * 0.12);

  // Chevrons.
  ctx.strokeStyle = accent;
  ctx.lineWidth = size * 0.035;
  for (let i = -1; i < 4; i += 1) {
    ctx.beginPath();
    ctx.moveTo(0, size * (0.16 + i * 0.26));
    ctx.lineTo(size * 0.5, size * (0.28 + i * 0.26));
    ctx.lineTo(size, size * (0.16 + i * 0.26));
    ctx.stroke();
  }

  // Vertical weave shading so the cloth catches light unevenly.
  for (let x = 0; x < size; x += 4) {
    ctx.fillStyle = `rgba(0,0,0,${0.06 + Math.random() * 0.09})`;
    ctx.fillRect(x, 0, 2, size);
  }

  grain(ctx, size, 18, 1);
  return toTexture(canvas);
}

/** Puffy soft-edged blob used for smoke plumes drifting off the pyres. */
export function smokeTexture(): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(150,142,132,0.5)");
  gradient.addColorStop(0.45, "rgba(104,98,92,0.24)");
  gradient.addColorStop(1, "rgba(60,56,52,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // A couple of offset lobes keep the puffs from reading as perfect circles.
  for (let i = 0; i < 5; i += 1) {
    const x = size * (0.3 + Math.random() * 0.4);
    const y = size * (0.3 + Math.random() * 0.4);
    const r = size * (0.14 + Math.random() * 0.16);
    const lobe = ctx.createRadialGradient(x, y, 0, x, y, r);
    lobe.addColorStop(0, "rgba(160,152,142,0.22)");
    lobe.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = lobe;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Vertical light-shaft gradient (bright at the window, fading to the floor). */
export function shaftTexture(): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, "rgba(255,224,170,0.55)");
  gradient.addColorStop(0.45, "rgba(255,206,140,0.18)");
  gradient.addColorStop(1, "rgba(255,190,120,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
