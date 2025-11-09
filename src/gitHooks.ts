import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";
import { logSuccess, logError } from "./utils";

const HOOKS_DIR = ".git/hooks";
const POST_COMMIT_PATH = path.join(HOOKS_DIR, "post-commit");

export async function installGitHooks(): Promise<void> {
  try {
    execSync("git rev-parse --git-dir", { stdio: "ignore" });

    const hookScript = `#!/bin/sh
# codegress auto-update
npx codegress update-and-refresh > /dev/null 2>&1 || true
`;

    await fs.mkdir(HOOKS_DIR, { recursive: true });
    await fs.writeFile(POST_COMMIT_PATH, hookScript, { mode: 0o755 });
    logSuccess("Git hook installed.");
  } catch (err) {
    logError("Git hook failed (not in Git repo?).");
  }
}
