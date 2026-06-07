import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = "makotomisumi14-droid";
const REPO = "fpl-bot";
const BASE = "/home/runner/workspace";

if (!TOKEN) throw new Error("GITHUB_TOKEN not set");

const api = async (path, method = "GET", body = null) => {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `token ${TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : null,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`GitHub API ${path}: ${JSON.stringify(json)}`);
  return json;
};

// Step 1: Get current HEAD commit SHA of main branch
console.log("Getting current HEAD...");
const refData = await api(`/repos/${OWNER}/${REPO}/git/refs/heads/main`);
const baseSha = refData.object.sha;
const baseCommit = await api(`/repos/${OWNER}/${REPO}/git/commits/${baseSha}`);
const baseTreeSha = baseCommit.tree.sha;
console.log("Current commit:", baseSha);

// Step 2: Get tracked files from git
const files = execSync("git ls-files", { cwd: BASE })
  .toString()
  .trim()
  .split("\n")
  .filter(Boolean);

console.log(`Pushing ${files.length} files...`);

// Step 3: Create blobs for each file
const blobs = [];
for (const file of files) {
  const fullPath = resolve(BASE, file);
  if (!existsSync(fullPath)) continue;
  const content = readFileSync(fullPath, "base64");
  const blob = await api(`/repos/${OWNER}/${REPO}/git/blobs`, "POST", {
    content,
    encoding: "base64",
  });
  blobs.push({ path: file, mode: "100644", type: "blob", sha: blob.sha });
  process.stdout.write(".");
}
console.log("\nAll blobs created.");

// Step 4: Create tree on top of existing tree
const tree = await api(`/repos/${OWNER}/${REPO}/git/trees`, "POST", {
  base_tree: baseTreeSha,
  tree: blobs,
});
console.log("Tree created:", tree.sha);

// Step 5: Create commit
const commit = await api(`/repos/${OWNER}/${REPO}/git/commits`, "POST", {
  message: "feat: add /listteams, username step, squad message on approval",
  tree: tree.sha,
  parents: [baseSha],
});
console.log("Commit created:", commit.sha);

// Step 6: Update main branch
await api(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, "PATCH", {
  sha: commit.sha,
  force: true,
});

console.log("\n✅ Done! Code pushed to: https://github.com/" + OWNER + "/" + REPO);
