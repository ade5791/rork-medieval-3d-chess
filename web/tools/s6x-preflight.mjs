// S6 preflight: verify CDN CORS reachability and GitHub account/repo state.
// Every downstream publish decision depends on these two facts, so measure them
// rather than assume them.
const OUT = [];
function log(k, v) { OUT.push(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`); }

const ORIGIN = "https://ade5791.github.io";

async function head(url, label) {
  try {
    const r = await fetch(url, { method: "GET", headers: { Origin: ORIGIN, Range: "bytes=0-64" } });
    log(label, {
      status: r.status,
      len: r.headers.get("content-length"),
      type: r.headers.get("content-type"),
      acao: r.headers.get("access-control-allow-origin"),
      acar: r.headers.get("access-control-allow-headers"),
    });
  } catch (e) {
    log(label, "ERR " + e.message);
  }
}

await head(
  "https://r2-pub.rork.com/generated-3d-models/g9111r67kl6tq85g540sd/704a772c-4a50-4619-b5ad-6e2bbf9703b8.glb",
  "cdn_model"
);
await head(
  "https://r2-pub.rork.com/generated-audio/g9111r67kl6tq85g540sd/e62d5bb9-8c84-4464-8696-dbcf975f938b.mp3",
  "cdn_audio"
);

const token = process.env.GH_TOKEN;
async function gh(path) {
  const r = await fetch("https://api.github.com" + path, {
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "User-Agent": "s6-preflight",
    },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const me = await gh("/user");
log("gh_user", { status: me.status, login: me.body && me.body.login });

const repos = await gh("/user/repos?per_page=100&affiliation=owner&sort=updated");
if (repos.status === 200 && Array.isArray(repos.body)) {
  const names = repos.body.map((r) => r.full_name);
  log("gh_repo_count", names.length);
  log("gh_chess_repos", names.filter((n) => /chess|gambit|medieval/i.test(n)));
} else {
  log("gh_repos", { status: repos.status });
}

console.log(OUT.join("\n"));
