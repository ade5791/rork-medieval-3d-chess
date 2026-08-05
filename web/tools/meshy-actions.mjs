/**
 * Resolve Meshy animation action_ids by NAME from the live library docs.
 *
 * The char3d rule is to re-verify preset IDs against the live library before
 * every rig submission rather than trusting a hard-coded table. The docs page
 * is JS-rendered, so we pull the prerendered payload and scan for
 * "<id> <Name> <Category> <SubCategory>" tuples.
 *
 * Usage: node tools/meshy-actions.mjs Name1 Name2 ...
 */

const DOC_URL = "https://docs.meshy.ai/en/api/animation-library";

export async function loadActions() {
  const res = await fetch(DOC_URL);
  if (!res.ok) throw new Error(`docs HTTP ${res.status}`);
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

  // Rows read: ID Name Category SubCategory. Categories are a small closed set,
  // which is what makes the tuple unambiguous.
  const CATS = "DailyActions|WalkAndRun|Fighting|BodyMovements|Dancing";
  const re = new RegExp(`(\\d{1,3})\\s+([A-Za-z0-9_]+)\\s+(${CATS})\\s+([A-Za-z]+)`, "g");
  const map = new Map();
  for (const m of text.matchAll(re)) {
    const id = Number(m[1]);
    const name = m[2];
    if (!map.has(name)) map.set(name, { id, name, category: m[3], sub: m[4] });
  }
  return map;
}

const wanted = process.argv.slice(2);
if (wanted.length > 0) {
  const map = await loadActions();
  let missing = 0;
  for (const name of wanted) {
    const hit = map.get(name);
    if (hit) console.log(`${String(hit.id).padStart(3)}  ${name.padEnd(36)} ${hit.category}/${hit.sub}`);
    else {
      console.log(`  ?  ${name.padEnd(36)} NOT FOUND`);
      missing += 1;
    }
  }
  console.log(`\nresolved ${wanted.length - missing}/${wanted.length} (library has ${map.size} named actions)`);
  process.exit(missing === 0 ? 0 : 1);
}
