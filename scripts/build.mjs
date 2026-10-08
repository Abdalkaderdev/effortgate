import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  legalComments: "none",
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
};

await build({ ...shared, entryPoints: ["src/index.ts"], outfile: "dist/index.js" });
await build({ ...shared, entryPoints: ["src/cli.ts"], outfile: "dist/cli.js", banner: { js: "#!/usr/bin/env node\n" + shared.banner.js } });
