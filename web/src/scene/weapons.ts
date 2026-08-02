/**
 * Hand-held arms for the generated warriors.
 *
 * The Meshy sculpts are unarmed by design (held props break auto-rigging), so
 * every figure gets a procedurally built weapon parented to its hand bone.
 * Geometry is authored once per weapon at "figure height = 1" and cached, then
 * each instance scales it by the figure's own height and cancels the bone's
 * accumulated scale/rotation so the prop sits in the fist at any pose.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { Faction, PieceKind } from "../core/types";

type WeaponRole =
  | "steel"
  | "gold"
  | "wood"
  | "leather"
  | "cloth"
  | "gem"
  /** Volcanic glass — the Sun Empire's cutting edge. */
  | "obsidian"
  /** Polished jade and turquoise inlay. */
  | "jade"
  /** Dyed quetzal and macaw plumes. */
  | "feather"
  /** Carved basalt maul heads. */
  | "stone";

interface Part {
  geometry: THREE.BufferGeometry;
  role: WeaponRole;
}

type WeaponId =
  | "greatsword"
  | "scepter"
  | "crystalStaff"
  | "warhammer"
  | "longsword"
  | "spear"
  | "roundShield"
  | "heaterShield"
  | "towerShield"
  // Sun Empire
  | "royalMacuahuitl"
  | "macuahuitl"
  | "tepoztopilli"
  | "serpentStaff"
  | "sunScepter"
  | "stoneMaul"
  | "chimalli"
  | "greatChimalli";

interface WeaponSpec {
  build: () => Part[];
  /** Distance from the prop's own origin up to the fist, in figure heights. */
  grip: number;
  /**
   * Rest direction, in "body" axes: x = away from the spine on the holding
   * side, y = up, z = the figure's front. Mirrored per hand at mount time.
   */
  aim: THREE.Vector3;
  /** Shift from the wrist joint, same axes as `aim`, in figure heights. */
  offset: THREE.Vector3;
  /** Shields orient their face (+Z) along `aim`; shafts orient their length (+Y). */
  shield?: boolean;
  /** Half-height of a shield, so its rim can be kept off the floor. */
  half?: number;
}

// ------------------------------------------------------------------ geometry

/**
 * Flat diamond cross-section blade.
 *
 * `base` is where the ricasso starts — always *above* the hilt, otherwise the
 * blade grows down through the grip and the crossguard ends up mid-blade.
 */
function blade(
  length: number,
  width: number,
  thickness: number,
  taper: number,
  base: number,
): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.5 * taper, 0.5, length, 4, 1);
  geometry.rotateY(Math.PI / 4);
  geometry.scale(width, 1, thickness);
  geometry.translate(0, base + length / 2, 0);
  return geometry;
}

/** Leaf-shaped spearhead: a widening shoulder under a tapering point. */
function leafHead(length: number, width: number, thickness: number, base: number): THREE.BufferGeometry {
  const shoulder = new THREE.CylinderGeometry(0.5, 0.14, length * 0.34, 4, 1);
  shoulder.rotateY(Math.PI / 4);
  shoulder.scale(width, 1, thickness);
  shoulder.translate(0, base + length * 0.17, 0);
  const point = new THREE.CylinderGeometry(0.02, 0.5, length * 0.66, 4, 1);
  point.rotateY(Math.PI / 4);
  point.scale(width, 1, thickness);
  point.translate(0, base + length * 0.34 + length * 0.33, 0);
  const merged = mergeGeometries([shoulder.toNonIndexed(), point.toNonIndexed()], false);
  shoulder.dispose();
  point.dispose();
  return merged ?? new THREE.BufferGeometry();
}

function shaft(length: number, radius: number, topRadius = radius * 0.9): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(topRadius, radius, length, 10, 1);
  geometry.translate(0, length / 2, 0);
  return geometry;
}

function box(w: number, h: number, d: number, y: number, x = 0, z = 0): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.translate(x, y, z);
  return geometry;
}

function ball(radius: number, y: number, x = 0, z = 0): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(radius, 14, 10);
  geometry.translate(x, y, z);
  return geometry;
}

function ring(radius: number, tube: number, y: number): THREE.BufferGeometry {
  const geometry = new THREE.TorusGeometry(radius, tube, 8, 18);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

/**
 * One obsidian tooth set into the edge of a macuahuitl or a spear head, apex
 * pointing away from the shaft.
 */
function tooth(size: number, y: number, x: number): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(size * 0.5, size, 3);
  geometry.rotateZ(x > 0 ? -Math.PI / 2 : Math.PI / 2);
  geometry.translate(x + Math.sign(x) * size * 0.5, y, 0);
  return geometry;
}

/** A row of teeth down both edges of a blade of `length`, starting at `base`. */
function toothedEdges(count: number, base: number, length: number, size: number, half: number): THREE.BufferGeometry[] {
  const teeth: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i += 1) {
    const y = base + ((i + 0.5) / count) * length;
    teeth.push(tooth(size, y, half));
    teeth.push(tooth(size, y, -half));
  }
  return teeth;
}

/** Feather plumes hanging from a ring of radius `radius` at height `y`. */
function plumes(count: number, radius: number, y: number, length: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
    const geometry = new THREE.BoxGeometry(0.022, length * (1 - Math.abs(t) * 0.35), 0.009);
    geometry.rotateZ(t * 0.22);
    geometry.translate(t * radius, y - length * 0.5, 0.004);
    out.push(geometry);
  }
  return out;
}

/** Triangular rays fanned around a sun disc lying in the plane of its face. */
function sunRays(count: number, radius: number, y: number, length: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const geometry = new THREE.ConeGeometry(0.016, length, 4);
    geometry.rotateZ(-angle);
    geometry.translate(
      Math.sin(angle) * (radius + length * 0.4),
      y + Math.cos(angle) * (radius + length * 0.4),
      0,
    );
    out.push(geometry);
  }
  return out;
}

/** Round feather-fringed chimalli, built from closed solids only. */
function chimalliParts(radius: number, fringe: number): Part[] {
  const board = new THREE.CylinderGeometry(radius, radius, 0.018, 30);
  board.rotateX(Math.PI / 2);
  const dome = new THREE.ConeGeometry(radius, 0.04, 30);
  dome.rotateX(Math.PI / 2);
  dome.translate(0, 0, 0.028);
  const rim = new THREE.TorusGeometry(radius * 1.02, 0.012, 8, 28);
  const inlay = new THREE.TorusGeometry(radius * 0.66, 0.013, 8, 26);
  inlay.translate(0, 0, 0.018);
  const boss = new THREE.SphereGeometry(radius * 0.2, 14, 10);
  boss.translate(0, 0, 0.042);
  const bars: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI;
    const bar = new THREE.BoxGeometry(radius * 1.25, 0.022, 0.01);
    bar.rotateZ(angle);
    bar.translate(0, 0, 0.022);
    bars.push(bar);
  }
  const fringeParts: THREE.BufferGeometry[] = [];
  const count = 7;
  for (let i = 0; i < count; i += 1) {
    const t = (i / (count - 1)) * 2 - 1;
    const feather = new THREE.BoxGeometry(0.026, fringe * (1 - Math.abs(t) * 0.4), 0.01);
    feather.rotateZ(t * 0.18);
    feather.translate(t * radius * 0.82, -radius - fringe * 0.4, 0.004);
    fringeParts.push(feather);
  }
  return [
    { geometry: board, role: "wood" },
    { geometry: dome, role: "wood" },
    { geometry: rim, role: "gold" },
    { geometry: inlay, role: "jade" },
    { geometry: boss, role: "gold" },
    ...bars.map((geometry) => ({ geometry, role: "jade" as const })),
    ...fringeParts.map((geometry) => ({ geometry, role: "feather" as const })),
  ];
}

/**
 * Macuahuitl: a flat hardwood paddle with obsidian blades set down both edges.
 * `size` scales the whole weapon, `royal` adds the emperor's feather tassels.
 */
function macuahuitlParts(size: number, royal: boolean): Part[] {
  const grip = 0.16 * size;
  const paddle = 0.44 * size;
  const halfWidth = 0.046 * size;
  const parts: Part[] = [
    { geometry: shaft(grip, 0.019 * size, 0.017 * size), role: "wood" },
    { geometry: ball(0.03 * size, -0.014 * size), role: "obsidian" },
    { geometry: ring(0.023 * size, 0.008 * size, grip * 0.45), role: "leather" },
    { geometry: box(halfWidth * 2, paddle, 0.026 * size, grip + paddle / 2), role: "wood" },
    { geometry: box(halfWidth * 2.05, 0.026 * size, 0.03 * size, grip + 0.03 * size), role: "jade" },
    { geometry: box(halfWidth * 1.5, 0.024 * size, 0.03 * size, grip + paddle - 0.03 * size), role: "gold" },
    ...toothedEdges(6, grip + 0.05 * size, paddle - 0.09 * size, 0.058 * size, halfWidth).map(
      (geometry) => ({ geometry, role: "obsidian" as const }),
    ),
    { geometry: spike(0.038 * size, 0.075 * size, grip + paddle), role: "obsidian" },
  ];
  if (royal) {
    parts.push(
      ...plumes(5, 0.05 * size, grip * 0.3, 0.17 * size).map((geometry) => ({
        geometry,
        role: "feather" as const,
      })),
    );
  }
  return parts;
}

function spike(radius: number, height: number, y: number, tilt = 0): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(radius, height, 10);
  geometry.translate(0, height / 2, 0);
  if (tilt !== 0) geometry.rotateX(tilt);
  geometry.translate(0, y, 0);
  return geometry;
}

/** Extruded shield plate whose face normal is +Z and whose up is +Y. */
function shieldPlate(shape: THREE.Shape, depth: number, bevel: number): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 12,
  });
  geometry.center();
  return geometry;
}

function heaterShape(width: number, height: number): THREE.Shape {
  const shape = new THREE.Shape();
  const hw = width / 2;
  shape.moveTo(-hw, height * 0.5);
  shape.lineTo(hw, height * 0.5);
  shape.quadraticCurveTo(hw, -height * 0.1, 0, -height * 0.5);
  shape.quadraticCurveTo(-hw, -height * 0.1, -hw, height * 0.5);
  return shape;
}

function towerShape(width: number, height: number): THREE.Shape {
  const shape = new THREE.Shape();
  const hw = width / 2;
  const hh = height / 2;
  shape.moveTo(-hw, hh * 0.72);
  shape.quadraticCurveTo(0, hh * 1.06, hw, hh * 0.72);
  shape.lineTo(hw, -hh * 0.62);
  shape.quadraticCurveTo(0, -hh * 1.05, -hw, -hh * 0.62);
  shape.closePath();
  return shape;
}

// ------------------------------------------------------------------- weapons

const WEAPONS: Record<WeaponId, WeaponSpec> = {
  /** King: ceremonial two-handed sword, held blade-up like a standard. */
  greatsword: {
    grip: 0.12,
    aim: new THREE.Vector3(-0.05, 1, 0.14),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => [
      { geometry: shaft(0.22, 0.019, 0.017), role: "leather" },
      { geometry: ball(0.033, -0.014), role: "gold" },
      { geometry: ring(0.026, 0.008, 0.205), role: "gold" },
      { geometry: box(0.25, 0.026, 0.036, 0.234), role: "gold" },
      { geometry: ball(0.024, 0.234, 0.125), role: "gold" },
      { geometry: ball(0.024, 0.234, -0.125), role: "gold" },
      { geometry: ball(0.021, 0.234, 0, 0.026), role: "gem" },
      { geometry: box(0.05, 0.05, 0.03, 0.262), role: "gold" },
      { geometry: blade(0.5, 0.086, 0.021, 0.16, 0.28), role: "steel" },
    ],
  },
  /** Queen: gold sceptre crowned with a faction-coloured crystal. */
  scepter: {
    grip: 0.16,
    aim: new THREE.Vector3(-0.04, 1, 0.1),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => [
      { geometry: shaft(0.5, 0.016, 0.014), role: "gold" },
      { geometry: ball(0.026, 0.0), role: "gold" },
      { geometry: ring(0.024, 0.007, 0.14), role: "gold" },
      { geometry: ring(0.024, 0.007, 0.32), role: "gold" },
      { geometry: ring(0.036, 0.009, 0.5), role: "gold" },
      { geometry: ball(0.045, 0.552), role: "gem" },
      { geometry: spike(0.018, 0.06, 0.585), role: "gold" },
    ],
  },
  /** Bishop: tall cleric staff with a floating crystal in a gold claw. */
  crystalStaff: {
    grip: 0.34,
    aim: new THREE.Vector3(-0.03, 1, 0.07),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => [
      { geometry: shaft(0.7, 0.015, 0.013), role: "wood" },
      { geometry: ring(0.019, 0.008, 0.3), role: "leather" },
      { geometry: ring(0.019, 0.008, 0.37), role: "leather" },
      { geometry: ring(0.021, 0.008, 0.685), role: "gold" },
      { geometry: spike(0.028, 0.08, 0.69), role: "gold" },
      { geometry: ball(0.042, 0.775), role: "gem" },
      { geometry: ring(0.048, 0.007, 0.775), role: "gold" },
      { geometry: spike(0.011, 0.028, -0.028, Math.PI), role: "steel" },
    ],
  },
  /** Rook: siege warhammer, heavy enough to sell the hammer-swing clip. */
  warhammer: {
    grip: 0.16,
    aim: new THREE.Vector3(-0.05, 1, 0.14),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => [
      { geometry: shaft(0.46, 0.019, 0.017), role: "wood" },
      { geometry: shaft(0.15, 0.021), role: "leather" },
      { geometry: box(0.13, 0.12, 0.19, 0.52), role: "steel" },
      { geometry: box(0.145, 0.026, 0.2, 0.575), role: "gold" },
      { geometry: box(0.145, 0.026, 0.2, 0.465), role: "gold" },
      { geometry: spike(0.035, 0.1, 0.58), role: "steel" },
    ],
  },
  /** Knight: arming sword with a winged crossguard. */
  longsword: {
    grip: 0.075,
    aim: new THREE.Vector3(-0.07, 1, 0.18),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => [
      { geometry: shaft(0.14, 0.017, 0.015), role: "leather" },
      { geometry: ball(0.026, -0.012), role: "gold" },
      { geometry: box(0.19, 0.023, 0.03, 0.153), role: "gold" },
      { geometry: ball(0.019, 0.153, 0.095), role: "gold" },
      { geometry: ball(0.019, 0.153, -0.095), role: "gold" },
      { geometry: box(0.042, 0.04, 0.026, 0.18), role: "gold" },
      { geometry: blade(0.42, 0.072, 0.019, 0.2, 0.196), role: "steel" },
    ],
  },
  /** Pawn: ash spear with a steel leaf head and a rag binding. */
  spear: {
    grip: 0.3,
    aim: new THREE.Vector3(-0.03, 1, 0.06),
    offset: new THREE.Vector3(0.018, 0, 0.028),
    build: () => [
      { geometry: shaft(0.68, 0.013, 0.011), role: "wood" },
      { geometry: ring(0.017, 0.007, 0.26), role: "cloth" },
      { geometry: ring(0.017, 0.007, 0.32), role: "cloth" },
      { geometry: shaft(0.045, 0.019, 0.016).translate(0, 0.655, 0), role: "steel" },
      { geometry: leafHead(0.19, 0.062, 0.016, 0.695), role: "steel" },
      { geometry: spike(0.013, 0.038, -0.036, Math.PI), role: "steel" },
    ],
  },
  /**
   * Pawn off-hand: domed round shield.
   *
   * Built from closed solids only — an open sphere cap reads as a bare hoop the
   * moment the figure turns its back to the camera (back faces are culled).
   */
  roundShield: {
    grip: 0,
    shield: true,
    half: 0.155,
    aim: new THREE.Vector3(0.36, 0.05, 1),
    offset: new THREE.Vector3(0.045, 0.015, 0.055),
    build: () => {
      const board = new THREE.CylinderGeometry(0.142, 0.142, 0.018, 30);
      board.rotateX(Math.PI / 2);
      const dome = new THREE.ConeGeometry(0.142, 0.055, 30);
      dome.rotateX(Math.PI / 2);
      dome.translate(0, 0, 0.036);
      const rim = new THREE.TorusGeometry(0.145, 0.012, 8, 28);
      const boss = new THREE.SphereGeometry(0.032, 14, 10);
      boss.translate(0, 0, 0.055);
      const rivets: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 8; i += 1) {
        const angle = (i / 8) * Math.PI * 2;
        const rivet = new THREE.SphereGeometry(0.0105, 8, 6);
        rivet.translate(Math.cos(angle) * 0.118, Math.sin(angle) * 0.118, 0.019);
        rivets.push(rivet);
      }
      return [
        { geometry: board, role: "cloth" },
        { geometry: dome, role: "cloth" },
        { geometry: rim, role: "steel" },
        { geometry: boss, role: "steel" },
        ...rivets.map((geometry) => ({ geometry, role: "steel" as const })),
      ];
    },
  },
  /** Knight off-hand: heater shield with a metal rim and bronze boss. */
  heaterShield: {
    grip: 0,
    shield: true,
    half: 0.17,
    aim: new THREE.Vector3(0.4, 0.04, 1),
    offset: new THREE.Vector3(0.05, 0.02, 0.055),
    build: () => {
      const plate = shieldPlate(heaterShape(0.24, 0.32), 0.022, 0.008);
      const rim = shieldPlate(heaterShape(0.268, 0.352), 0.012, 0.006);
      rim.translate(0, 0, -0.012);
      const boss = new THREE.SphereGeometry(0.028, 12, 10);
      boss.translate(0, 0, 0.024);
      const band = box(0.19, 0.022, 0.016, 0.052, 0, 0.018);
      return [
        { geometry: plate, role: "cloth" },
        { geometry: rim, role: "steel" },
        { geometry: band, role: "steel" },
        { geometry: boss, role: "gold" },
      ];
    },
  },
  /** Rook off-hand: gate-guardian tower shield. */
  towerShield: {
    grip: 0,
    shield: true,
    half: 0.23,
    aim: new THREE.Vector3(0.34, 0.03, 1),
    offset: new THREE.Vector3(0.055, 0.02, 0.06),
    build: () => {
      const plate = shieldPlate(towerShape(0.3, 0.46), 0.026, 0.01);
      const rim = shieldPlate(towerShape(0.328, 0.494), 0.014, 0.007);
      rim.translate(0, 0, -0.014);
      const bandTop = box(0.28, 0.028, 0.018, 0.13, 0, 0.02);
      const bandLow = box(0.28, 0.028, 0.018, -0.13, 0, 0.02);
      const boss = new THREE.SphereGeometry(0.036, 12, 10);
      boss.translate(0, 0, 0.028);
      return [
        { geometry: plate, role: "cloth" },
        { geometry: rim, role: "steel" },
        { geometry: bandTop, role: "steel" },
        { geometry: bandLow, role: "steel" },
        { geometry: boss, role: "gold" },
      ];
    },
  },

  // ------------------------------------------------------------ Sun Empire

  /** Emperor: an oversized ceremonial macuahuitl hung with feather tassels. */
  royalMacuahuitl: {
    grip: 0.1,
    aim: new THREE.Vector3(-0.05, 1, 0.14),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => macuahuitlParts(1.2, true),
  },
  /** Jaguar warrior: the standard obsidian-toothed war club. */
  macuahuitl: {
    grip: 0.085,
    aim: new THREE.Vector3(-0.07, 1, 0.18),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => macuahuitlParts(0.94, false),
  },
  /** Foot warrior: obsidian-edged thrusting spear. */
  tepoztopilli: {
    grip: 0.3,
    aim: new THREE.Vector3(-0.03, 1, 0.06),
    offset: new THREE.Vector3(0.018, 0, 0.028),
    build: () => [
      { geometry: shaft(0.64, 0.013, 0.011), role: "wood" },
      { geometry: ring(0.017, 0.007, 0.26), role: "feather" },
      { geometry: ring(0.017, 0.007, 0.33), role: "jade" },
      { geometry: box(0.072, 0.2, 0.016, 0.735), role: "wood" },
      ...toothedEdges(4, 0.65, 0.16, 0.05, 0.036).map((geometry) => ({
        geometry,
        role: "obsidian" as const,
      })),
      { geometry: spike(0.032, 0.075, 0.833), role: "obsidian" },
      { geometry: spike(0.013, 0.036, -0.034, Math.PI), role: "obsidian" },
      ...plumes(3, 0.026, 0.6, 0.1).map((geometry) => ({ geometry, role: "feather" as const })),
    ],
  },
  /** Serpent priest: feathered-serpent staff with a jade skull orb. */
  serpentStaff: {
    grip: 0.34,
    aim: new THREE.Vector3(-0.03, 1, 0.07),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => [
      { geometry: shaft(0.66, 0.015, 0.013), role: "wood" },
      { geometry: ring(0.019, 0.008, 0.27), role: "feather" },
      { geometry: ring(0.019, 0.008, 0.35), role: "jade" },
      { geometry: ring(0.026, 0.009, 0.645), role: "gold" },
      { geometry: ball(0.048, 0.712), role: "jade" },
      { geometry: box(0.052, 0.042, 0.09, 0.706, 0, 0.058), role: "jade" },
      { geometry: box(0.046, 0.016, 0.072, 0.681, 0, 0.05), role: "gold" },
      { geometry: ball(0.013, 0.73, 0.032, 0.028), role: "gem" },
      { geometry: ball(0.013, 0.73, -0.032, 0.028), role: "gem" },
      { geometry: ring(0.058, 0.013, 0.685), role: "feather" },
      { geometry: spike(0.022, 0.11, 0.752), role: "feather" },
      { geometry: spike(0.011, 0.03, -0.03, Math.PI), role: "obsidian" },
    ],
  },
  /** Priestess queen: gold sun disc raised on a jade-banded rod. */
  sunScepter: {
    grip: 0.16,
    aim: new THREE.Vector3(-0.04, 1, 0.1),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => {
      const disc = new THREE.CylinderGeometry(0.072, 0.072, 0.018, 22);
      disc.rotateX(Math.PI / 2);
      disc.translate(0, 0.54, 0);
      return [
        { geometry: shaft(0.46, 0.016, 0.014), role: "gold" },
        { geometry: ball(0.026, 0.0), role: "obsidian" },
        { geometry: ring(0.024, 0.007, 0.13), role: "jade" },
        { geometry: ring(0.024, 0.007, 0.31), role: "jade" },
        { geometry: disc, role: "gold" },
        ...sunRays(10, 0.072, 0.54, 0.05).map((geometry) => ({ geometry, role: "gold" as const })),
        { geometry: ball(0.03, 0.54, 0, 0.016), role: "jade" },
        { geometry: ball(0.03, 0.54, 0, -0.016), role: "jade" },
        ...plumes(5, 0.05, 0.45, 0.16).map((geometry) => ({ geometry, role: "feather" as const })),
      ];
    },
  },
  /** Temple guardian: basalt maul faced with obsidian blades. */
  stoneMaul: {
    grip: 0.16,
    aim: new THREE.Vector3(-0.05, 1, 0.14),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => [
      { geometry: shaft(0.44, 0.02, 0.018), role: "wood" },
      { geometry: shaft(0.15, 0.022), role: "leather" },
      { geometry: ring(0.03, 0.009, 0.42), role: "gold" },
      { geometry: box(0.13, 0.16, 0.18, 0.52), role: "stone" },
      { geometry: box(0.032, 0.17, 0.19, 0.52, 0.079), role: "obsidian" },
      { geometry: box(0.032, 0.17, 0.19, 0.52, -0.079), role: "obsidian" },
      { geometry: box(0.15, 0.024, 0.2, 0.44), role: "jade" },
      { geometry: spike(0.04, 0.1, 0.6), role: "obsidian" },
    ],
  },
  /** Feather-fringed chimalli carried by the empire's line troops. */
  chimalli: {
    grip: 0,
    shield: true,
    half: 0.2,
    aim: new THREE.Vector3(0.36, 0.05, 1),
    offset: new THREE.Vector3(0.045, 0.015, 0.055),
    build: () => chimalliParts(0.14, 0.11),
  },
  /** Guardian's great chimalli, wide enough to bar a temple stair. */
  greatChimalli: {
    grip: 0,
    shield: true,
    half: 0.29,
    aim: new THREE.Vector3(0.34, 0.03, 1),
    offset: new THREE.Vector3(0.055, 0.02, 0.06),
    build: () => chimalliParts(0.185, 0.16),
  },
};

interface Loadout {
  main: WeaponId;
  off?: WeaponId;
}

/** Right-hand arm and off-hand shield per army and piece kind. */
const LOADOUT: Record<Faction, Record<PieceKind, Loadout>> = {
  w: {
    k: { main: "greatsword" },
    q: { main: "scepter" },
    b: { main: "crystalStaff" },
    n: { main: "longsword", off: "heaterShield" },
    r: { main: "warhammer", off: "towerShield" },
    p: { main: "spear", off: "roundShield" },
  },
  b: {
    k: { main: "royalMacuahuitl" },
    q: { main: "sunScepter" },
    b: { main: "serpentStaff" },
    n: { main: "macuahuitl", off: "chimalli" },
    r: { main: "stoneMaul", off: "greatChimalli" },
    p: { main: "tepoztopilli", off: "chimalli" },
  },
};

// ------------------------------------------------------------------ materials

const PALETTE: Record<Faction, Record<WeaponRole, { color: number; roughness: number; metalness: number; emissive: number; emissiveIntensity: number }>> = {
  w: {
    steel: { color: 0xd8dee8, roughness: 0.21, metalness: 0.98, emissive: 0x101821, emissiveIntensity: 0.2 },
    gold: { color: 0xe0ab48, roughness: 0.28, metalness: 1, emissive: 0x2a1a04, emissiveIntensity: 0.25 },
    wood: { color: 0x8a6440, roughness: 0.82, metalness: 0.05, emissive: 0x000000, emissiveIntensity: 0 },
    leather: { color: 0x2f4a86, roughness: 0.72, metalness: 0.1, emissive: 0x081226, emissiveIntensity: 0.2 },
    cloth: { color: 0x2b4f9c, roughness: 0.78, metalness: 0.08, emissive: 0x0a1738, emissiveIntensity: 0.3 },
    gem: { color: 0xbcd8ff, roughness: 0.08, metalness: 0.05, emissive: 0x6ea8ff, emissiveIntensity: 2.4 },
    obsidian: { color: 0x23262e, roughness: 0.14, metalness: 0.4, emissive: 0x0a0f1a, emissiveIntensity: 0.2 },
    jade: { color: 0x4f9e86, roughness: 0.32, metalness: 0.12, emissive: 0x0d2a24, emissiveIntensity: 0.35 },
    feather: { color: 0xc4d3f0, roughness: 0.86, metalness: 0.02, emissive: 0x101c34, emissiveIntensity: 0.3 },
    stone: { color: 0x9d9482, roughness: 0.92, metalness: 0.03, emissive: 0x000000, emissiveIntensity: 0 },
  },
  b: {
    steel: { color: 0x5a5e66, roughness: 0.3, metalness: 0.96, emissive: 0x140807, emissiveIntensity: 0.2 },
    gold: { color: 0xb0742c, roughness: 0.34, metalness: 1, emissive: 0x2a1204, emissiveIntensity: 0.25 },
    wood: { color: 0x4a3323, roughness: 0.85, metalness: 0.05, emissive: 0x000000, emissiveIntensity: 0 },
    leather: { color: 0x5f1d17, roughness: 0.76, metalness: 0.1, emissive: 0x230605, emissiveIntensity: 0.2 },
    cloth: { color: 0x82201a, roughness: 0.8, metalness: 0.08, emissive: 0x2e0705, emissiveIntensity: 0.3 },
    gem: { color: 0xffc0a4, roughness: 0.08, metalness: 0.05, emissive: 0xff5a3c, emissiveIntensity: 2.4 },
    // Volcanic glass: near black, very smooth, catching the torches in streaks.
    obsidian: { color: 0x0e1015, roughness: 0.08, metalness: 0.42, emissive: 0x1d0705, emissiveIntensity: 0.3 },
    jade: { color: 0x2fb8a2, roughness: 0.3, metalness: 0.14, emissive: 0x0a4a41, emissiveIntensity: 0.55 },
    feather: { color: 0xd8452c, roughness: 0.88, metalness: 0.02, emissive: 0x3d0a04, emissiveIntensity: 0.4 },
    stone: { color: 0x6d6558, roughness: 0.94, metalness: 0.03, emissive: 0x150605, emissiveIntensity: 0.15 },
  },
};

function makeMaterial(role: WeaponRole, color: Faction): THREE.MeshStandardMaterial {
  const spec = PALETTE[color][role];
  const material = new THREE.MeshStandardMaterial({
    color: spec.color,
    roughness: spec.roughness,
    metalness: spec.metalness,
    emissive: new THREE.Color(spec.emissive),
    // Shield faces must never vanish when a figure turns its back to camera.
    side: role === "cloth" || role === "feather" ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.emissiveIntensity = spec.emissiveIntensity;
  material.envMapIntensity = role === "gem" ? 0.6 : 1.3;
  return material;
}

// ------------------------------------------------------------------- caching

const geometryCache = new Map<WeaponId, Map<WeaponRole, THREE.BufferGeometry>>();

/** Merges the parts of a weapon into one geometry per material role, once. */
function weaponGeometries(id: WeaponId): Map<WeaponRole, THREE.BufferGeometry> {
  const cached = geometryCache.get(id);
  if (cached) return cached;

  const byRole = new Map<WeaponRole, THREE.BufferGeometry[]>();
  for (const part of WEAPONS[id].build()) {
    const list = byRole.get(part.role) ?? [];
    list.push(part.geometry);
    byRole.set(part.role, list);
  }

  const merged = new Map<WeaponRole, THREE.BufferGeometry>();
  for (const [role, list] of byRole) {
    // mergeGeometries refuses mixed indexed/non-indexed input (extrusions are
    // non-indexed, primitives are indexed), so flatten everything first.
    const flat = list.map((geometry) => {
      const plain = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      plain.deleteAttribute("uv");
      plain.deleteAttribute("uv1");
      geometry.dispose();
      return plain;
    });
    let result = flat[0];
    if (flat.length > 1) {
      const combined = mergeGeometries(flat, false);
      if (combined) {
        for (const entry of flat) entry.dispose();
        result = combined;
      }
    }
    merged.set(role, result);
  }

  geometryCache.set(id, merged);
  return merged;
}

// ------------------------------------------------------------------ attaching

const WORLD_UP = new THREE.Vector3(0, 1, 0);
/** Sculpt-local front, matching the generator's orientation verdict (+Z). */
const LOCAL_FRONT = new THREE.Vector3(0, 0, 1);

/** Rotation placing the prop's own axes onto its rest direction in body space. */
function restOrientation(direction: THREE.Vector3, isShield: boolean): THREE.Quaternion {
  const aim = direction.clone().normalize();
  const matrix = new THREE.Matrix4();
  if (isShield) {
    const z = aim;
    const y = WORLD_UP.clone().sub(z.clone().multiplyScalar(WORLD_UP.dot(z))).normalize();
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    matrix.makeBasis(x, y, z);
  } else {
    const y = aim;
    const z = LOCAL_FRONT.clone().sub(y.clone().multiplyScalar(LOCAL_FRONT.dot(y))).normalize();
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    matrix.makeBasis(x, y, z);
  }
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

function findBone(root: THREE.Object3D, pattern: RegExp): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  root.traverse((node) => {
    if (found) return;
    const bone = node as THREE.Bone;
    if (bone.isBone && pattern.test(bone.name)) found = bone;
  });
  return found;
}

const RIGHT_HAND = /^(mixamorig)?(right ?hand|hand[_.]?r|r[_.]?hand)$/i;
const LEFT_HAND = /^(mixamorig)?(left ?hand|hand[_.]?l|l[_.]?hand)$/i;

export interface AttachedArms {
  meshes: THREE.Mesh[];
  materials: THREE.MeshStandardMaterial[];
  /** Emissive strength each material was authored with, for highlight blending. */
  baseEmissive: number[];
}

/**
 * Builds and parents the figure's arms.
 *
 * @param root   the (already posed) sculpt root — bone matrices must be current
 * @param unit   the figure's height in the root's own units
 * @param baseY  the sole line in the root's own units, so props clear the floor
 */
export function attachWeapons(
  root: THREE.Object3D,
  kind: PieceKind,
  color: Faction,
  unit: number,
  baseY = 0,
): AttachedArms {
  const arms: AttachedArms = { meshes: [], materials: [], baseEmissive: [] };
  const loadout = LOADOUT[color][kind];

  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();

  const mount = (id: WeaponId, hand: "right" | "left"): void => {
    const spec = WEAPONS[id];
    const bone = findBone(root, hand === "right" ? RIGHT_HAND : LEFT_HAND);

    // Read the fist out of the pose: which side of the spine it sits on (the
    // rig may be mirrored) and how high it is above the soles.
    let lateral = hand === "right" ? -1 : 1;
    let handHeight = 0.52;
    let boneScale = 1;
    const inverse = new THREE.Quaternion();

    if (bone) {
      const local = new THREE.Matrix4().multiplyMatrices(rootInverse, bone.matrixWorld);
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      local.decompose(position, quaternion, scale);
      boneScale = Math.max(1e-6, (scale.x + scale.y + scale.z) / 3);
      inverse.copy(quaternion).invert();
      if (Math.abs(position.x) > 0.03 * unit) lateral = position.x > 0 ? 1 : -1;
      handHeight = THREE.MathUtils.clamp((position.y - baseY) / unit, 0.15, 0.95);
    }

    const aim = new THREE.Vector3(spec.aim.x * lateral, spec.aim.y, spec.aim.z);
    const offset = new THREE.Vector3(spec.offset.x * lateral, spec.offset.y, spec.offset.z);

    // Keep butt spikes and shield rims from sinking through the board: the
    // fighting stances crouch, which drops the fist far below a standing pose.
    let grip = spec.grip;
    if (spec.shield) {
      const bottom = handHeight + offset.y - (spec.half ?? 0.18);
      if (bottom < 0.07) offset.y += 0.07 - bottom;
    } else {
      grip = Math.min(spec.grip, Math.max(0.03, handHeight + offset.y - 0.07));
    }

    const rest = restOrientation(aim, spec.shield === true);
    const group = new THREE.Group();
    group.name = `weapon_${id}`;

    if (bone) {
      group.scale.setScalar(unit / boneScale);
      group.quaternion.copy(inverse.clone().multiply(rest));
      group.position.copy(
        offset.multiplyScalar(unit).applyQuaternion(inverse).divideScalar(boneScale),
      );
      bone.add(group);
    } else {
      // Static / procedural fallback figures: hang the arm off the body.
      group.scale.setScalar(unit);
      group.quaternion.copy(rest);
      group.position.set(lateral * 0.24 * unit, 0.52 * unit, 0.05 * unit);
      root.add(group);
    }

    const inner = new THREE.Group();
    inner.position.y = -grip;
    group.add(inner);

    for (const [role, geometry] of weaponGeometries(id)) {
      const material = makeMaterial(role, color);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = role !== "gem";
      mesh.frustumCulled = false;
      inner.add(mesh);
      arms.meshes.push(mesh);
      arms.materials.push(material);
      arms.baseEmissive.push(material.emissiveIntensity);
    }
  };

  mount(loadout.main, "right");
  if (loadout.off) mount(loadout.off, "left");
  return arms;
}
