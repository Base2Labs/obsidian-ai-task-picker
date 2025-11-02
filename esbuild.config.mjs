import esbuild from "esbuild";
import { readFileSync } from "fs";

const banner = {
  js: `/*\n${readFileSync("manifest.json", "utf8")}\n*/`,
};

const isWatch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  platform: "browser",
  format: "cjs",
  target: "es2020",
  banner,
  external: ["obsidian"],
});

if (isWatch) {
  await ctx.watch();
  console.log("👀 Watching for changes…");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("✅ Build complete");
}
