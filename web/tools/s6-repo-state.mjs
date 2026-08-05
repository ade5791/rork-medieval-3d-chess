/**
 * S6 target-repo state. Answers, before anything is built or pushed:
 *   - does the destination repo already exist on ade5791?
 *   - is Pages already configured, and at what URL?
 *   - what is the current live commit (the ROLLBACK TARGET)?
 *
 * Publishing without knowing the rollback target is how a bad deploy becomes
 * unrecoverable, so this runs first.
 */
const TOKEN = process.env.GH_TOKEN;
const OWNER = "ade5791";
const REPO = process.argv[2] || "kings-gambit-medieval-3d-chess";

async function gh(path) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "s6-repo-state",
    },
  });
  let body = null;
  try {
    body = await r.json();
  } catch {
    /* empty body */
  }
  return { status: r.status, body };
}

const out = {};

const me = await gh("/user");
out.tokenLogin = me.body?.login;
out.tokenOk = me.status === 200 && me.body?.login === OWNER;

const repo = await gh(`/repos/${OWNER}/${REPO}`);
out.repoExists = repo.status === 200;
out.repo = out.repoExists
  ? {
      full_name: repo.body.full_name,
      default_branch: repo.body.default_branch,
      private: repo.body.private,
      size_kb: repo.body.size,
      pushed_at: repo.body.pushed_at,
    }
  : { status: repo.status };

if (out.repoExists) {
  const pages = await gh(`/repos/${OWNER}/${REPO}/pages`);
  out.pagesConfigured = pages.status === 200;
  out.pages = pages.status === 200
    ? { url: pages.body.html_url, status: pages.body.status, source: pages.body.source, build_type: pages.body.build_type }
    : { status: pages.status };

  const branch = await gh(`/repos/${OWNER}/${REPO}/branches/${repo.body.default_branch}`);
  out.rollbackTarget = branch.status === 200
    ? { branch: repo.body.default_branch, sha: branch.body.commit?.sha, date: branch.body.commit?.commit?.committer?.date, message: branch.body.commit?.commit?.message?.split("\n")[0] }
    : { status: branch.status, note: "no commits yet" };

  const builds = await gh(`/repos/${OWNER}/${REPO}/pages/builds?per_page=3`);
  out.recentBuilds = Array.isArray(builds.body)
    ? builds.body.map((b) => ({ status: b.status, commit: b.commit, created: b.created_at, error: b.error?.message }))
    : { status: builds.status };
}

console.log(JSON.stringify(out, null, 2));
