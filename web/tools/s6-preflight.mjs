/**
 * S6 preflight - checks the two publish-blocking unknowns BEFORE any build:
 *   1. Does the GitHub token actually belong to ade5791 and carry repo scope?
 *   2. Are the remote R2 classic-era assets CORS-reachable from a github.io
 *      origin? The classic era loads its sculpts from r2-pub.rork.com, so if
 *      that host does not send Access-Control-Allow-Origin the default era
 *      renders no pieces on the published site while returning HTTP 200.
 */
const TOKEN = process.env.GH_TOKEN;
const out = { checks: [] };
function rec(name, pass, detail) {
  out.checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  :: ${detail}`);
}

const gh = await fetch("https://api.github.com/user", {
  headers: { authorization: `Bearer ${TOKEN}`, "user-agent": "s6-preflight" },
});
const user = await gh.json();
rec("gh token identity", user.login === "ade5791", `login=${user.login} status=${gh.status}`);
rec(
  "gh token scopes",
  String(gh.headers.get("x-oauth-scopes") || "").includes("repo"),
  `scopes=${gh.headers.get("x-oauth-scopes")}`,
);

// Remote classic-era asset: CORS + reachability.
const MODEL_BASE = "https://r2-pub.rork.com/generated-3d-models/g9111r67kl6tq85g540sd";
const sample = `${MODEL_BASE}/704a772c-4a50-4619-b5ad-6e2bbf9703b8.glb`;
try {
  const r = await fetch(sample, {
    headers: { origin: "https://ade5791.github.io" },
  });
  const acao = r.headers.get("access-control-allow-origin");
  rec("r2 classic asset reachable", r.ok, `status=${r.status} bytes=${r.headers.get("content-length")}`);
  rec(
    "r2 CORS allows github.io origin",
    acao === "*" || acao === "https://ade5791.github.io",
    `access-control-allow-origin=${acao}`,
  );
} catch (e) {
  rec("r2 classic asset reachable", false, `threw ${e.message}`);
}

// Audio assets too - the mixer decodes them over the network.
console.log("\n" + JSON.stringify(out, null, 2));
