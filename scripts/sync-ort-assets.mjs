import { cp, rm, stat } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcDir = path.resolve(root, "node_modules/onnxruntime-web/dist");
const destDir = path.resolve(root, "public/onnxruntime-web");

async function main() {
  if (!existsSync(srcDir)) {
    console.warn(
      "[sync-ort-assets] node_modules/onnxruntime-web/dist not found. Did you run npm install?"
    );
    return;
  }

  try {
    await stat(destDir);
    await rm(destDir, { recursive: true, force: true });
  } catch (err) {
    // ignore if dest doesn't exist
  }

  await cp(srcDir, destDir, { recursive: true });
  console.log("[sync-ort-assets] copied", srcDir, "->", destDir);
}

main().catch((err) => {
  console.error("[sync-ort-assets] failed", err);
  process.exitCode = 1;
});
