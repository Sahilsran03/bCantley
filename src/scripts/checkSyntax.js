import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const files = [];

const collectJavaScriptFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectJavaScriptFiles(path);
      continue;
    }

    if (entry.isFile() && extname(entry.name) === ".js") {
      files.push(path);
    }
  }
};

await collectJavaScriptFiles(sourceRoot);

for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log(`Checked ${files.length} Cantley backend files.`);
