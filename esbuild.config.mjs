import esbuild from "esbuild";
import { readFileSync } from "fs";

const banner = {
  js: `/*\n${readFileSync("manifest.json", "utf8")}\n*/`,
};

const isWatch = process.argv.includes("--watch");

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  platform: "browser",
  format: "cjs",
  target: "es2020",
  banner,
  external: ["obsidian"],
  watch: isWatch && {
    onRebuild(error) {
      if (error) console.error("❌ Rebuild failed:", error);
      else console.log("✅ Rebuilt");
    },
  },
});

console.log(isWatch ? "👀 Watching for changes…" : "✅ Build complete");
