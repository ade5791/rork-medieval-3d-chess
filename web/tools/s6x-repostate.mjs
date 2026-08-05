// Inspect the existing ade5791 target repo: size, branches, Pages config, and
// whether the live URL currently serves anything. Decides create-vs-update.
const token = process.env.GH_TOKEN;
const REPO = "ade5791/kings-gambit-medieval-chess";

async function gh(path) {
  const r = await fetch("https://api.github.com/repos/" + REPO + path, {
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "User-Agent": "s6-repostate",
    },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const info = await gh("");
console.log("repo:", JSON.stringify({
  status: info.status,
  default_branch: info.body?.default_branch,
  size_kb: info.body?.size,
  private: info.body?.private,
  pushed_at: info.body?.pushed_at,
  has_pages: info.body?.has_pages,
}));

const branches = await gh("/branches?per_page=50");
console.log("branches:", JSON.stringify(
  Array.isArray(branches.body) ? branches.body.map((b) => b.name + "@" + b.commit.sha.slice(0, 8)) : branches.status
));

const pages = await gh("/pages");
console.log("pages:", JSON.stringify({
  status: pages.status,
  url: pages.body?.html_url,
  source: pages.body?.source,
  build_type: pages.body?.build_type,
  pages_status: pages.body?.status,
}));

const builds = await gh("/pages/builds?per_page=3");
console.log("builds:", JSON.stringify(
  Array.isArray(builds.body)
    ? builds.body.map((b) => ({ status: b.status, commit: b.commit?.slice(0, 8), err: b.error?.message, created: b.created_at }))
    : builds.status
));

// Does the live URL serve?
for (const u of [
  "https://ade5791.github.io/kings-gambit-medieval-chess/",
  "https://ade5791.github.io/kings-gambit-medieval-chess/landing.html",
]) {
  try {
    const r = await fetch(u, { redirect: "follow" });
    const t = await r.text();
    console.log("live", u, "status=" + r.status, "len=" + t.length, "title=" + (t.match(/<title>([^<]*)<\/title>/)?.[1] ?? "-"));
  } catch (e) {
    console.log("live", u, "ERR " + e.message);
  }
}
