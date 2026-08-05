// Shared summariser: applies the photometric bar to LIT OPAQUE SURFACES only.
export function summarise(materials) {
  const m = materials || [];
  // `surface` is set by the fixed probe. Fall back to std for older captures.
  const surf = m.filter((x) => (x.surface !== undefined ? x.surface : x.std));
  const lums = surf.map((x) => x.albedoLum).filter((v) => typeof v === "number").sort((a, b) => a - b);
  const metals = surf.map((x) => x.metalness).filter((v) => typeof v === "number");
  const roughs = surf.map((x) => x.roughness).filter((v) => typeof v === "number").sort((a, b) => a - b);
  return {
    total: m.length,
    surfaces: surf.length,
    withMap: surf.filter((x) => x.map).length,
    withNormalMap: surf.filter((x) => x.normalMap).length,
    withRoughnessMap: surf.filter((x) => x.roughnessMap).length,
    withAoMap: surf.filter((x) => x.aoMap).length,
    albedoBelow002: lums.filter((v) => v < 0.02).length,
    albedoAbove09: lums.filter((v) => v > 0.9).length,
    nonBinaryMetal: metals.filter((v) => v > 0.05 && v < 0.95).length,
    albedoMin: lums[0] ?? null,
    albedoMedian: lums[Math.floor(lums.length / 2)] ?? null,
    albedoMax: lums[lums.length - 1] ?? null,
    roughMedian: roughs[Math.floor(roughs.length / 2)] ?? null,
  };
}
