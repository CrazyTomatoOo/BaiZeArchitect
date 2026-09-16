import { spawn } from "node:child_process";
import { chmod, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const bundlePath = path.join(root, "dist", "baize-bundle.cjs");
const binaryPath = path.join(root, "dist", "baize");

const pkgCompatibility = {
  name: "baize-pkg-compatibility",
  setup(build) {
    build.onLoad(
      {
        filter:
          /[\\/]node_modules[\\/]@earendil-works[\\/]pi-ai[\\/]dist[\\/]env-api-keys\.js$/,
      },
      async (args) => {
        const source = await readFile(args.path, "utf8");
        const patched = source
          .replace(
            /dynamicImport\(NODE_FS_SPECIFIER\)\.then\(\(m\) => \{\s*_existsSync = m\.existsSync;\s*\}\);/,
            'Promise.resolve().then(() => {\n        _existsSync = require("node:fs").existsSync;\n    });',
          )
          .replace(
            /dynamicImport\(NODE_OS_SPECIFIER\)\.then\(\(m\) => \{\s*_homedir = m\.homedir;\s*\}\);/,
            'Promise.resolve().then(() => {\n        _homedir = require("node:os").homedir;\n    });',
          )
          .replace(
            /dynamicImport\(NODE_PATH_SPECIFIER\)\.then\(\(m\) => \{\s*_join = m\.join;\s*\}\);/,
            'Promise.resolve().then(() => {\n        _join = require("node:path").join;\n    });',
          );

        if (
          !patched.includes('require("node:fs")') ||
          !patched.includes('require("node:os")') ||
          !patched.includes('require("node:path")')
        ) {
          throw new Error(
            "The pi-ai environment module changed; update the pkg compatibility patch",
          );
        }

        return {
          contents: patched,
          loader: "js",
        };
      },
    );
    build.onLoad(
      {
        filter:
          /[\\/]node_modules[\\/]@earendil-works[\\/]pi-coding-agent[\\/]node_modules[\\/]jiti[\\/]lib[\\/]jiti-static\.mjs$/,
      },
      async (args) => {
        const source = await readFile(args.path, "utf8");
        const patched = source.replace(
          "const nativeImport = (id) => import(id);",
          "const nativeImport = (id) => Promise.resolve().then(() => require(id));",
        );

        if (!patched.includes("Promise.resolve().then(() => require(id))")) {
          throw new Error(
            "The jiti static loader changed; update the pkg compatibility patch",
          );
        }

        return {
          contents: patched,
          loader: "js",
        };
      },
    );
    build.onLoad(
      {
        filter:
          /[\\/]node_modules[\\/]@earendil-works[\\/]pi-ai[\\/]dist[\\/]auth[\\/]context\.js$/,
      },
      async (args) => {
        const source = await readFile(args.path, "utf8");
        const patched = source.replace(
          'const importNodeModule = (specifier) => import(__rewriteRelativeImportExtension(specifier));',
          `const importNodeModule = (specifier) => {
    const resolved = __rewriteRelativeImportExtension(specifier);
    if (resolved === "node:fs/promises") {
        return require("node:fs/promises");
    }
    if (resolved === "node:os") {
        return require("node:os");
    }
    throw new Error(\`Unsupported Node module in pkg binary: \${resolved}\`);
}`,
        );

        if (!patched.includes('require("node:fs/promises")')) {
          throw new Error(
            "The pi-ai auth context changed; update the pkg compatibility patch",
          );
        }

        return {
          contents: patched,
          loader: "js",
        };
      },
    );
  },
};

await build({
  entryPoints: [path.join(root, "dist", "cli.js")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: bundlePath,
  sourcemap: false,
  logLevel: "info",
  external: ["better-sqlite3"],
  banner: {
    js: 'const __baize_import_meta_url = require("node:url").pathToFileURL(__filename).href;',
  },
  define: {
    "import.meta.url": "__baize_import_meta_url",
  },
  plugins: [pkgCompatibility],
});

const bundled = await readFile(bundlePath, "utf8");

if (/=>\s*import\s*\(/.test(bundled)) {
  throw new Error(
    "The bundle still contains dynamic imports, which pkg cannot execute from CJS",
  );
}

const pkgPlatform =
  process.platform === "win32" ? "win" : process.platform === "darwin"
    ? "darwin"
    : "linux";
const target = `node22-${pkgPlatform}-${process.arch}`;
const pkgBinary = path.join(
  root,
  "node_modules",
  "@yao-pkg",
  "pkg",
  "lib-es5",
  "bin.js",
);

await new Promise((resolve, reject) => {
  const child = spawn(
    process.execPath,
    [
      pkgBinary,
      bundlePath,
      "--config",
      "package.json",
      "--targets",
      target,
      "--output",
      binaryPath,
      "--public-packages",
      "*",
      "--public",
    ],
    {
      cwd: root,
      stdio: "inherit",
    },
  );

  child.once("error", reject);
  child.once("close", (code) => {
    if (code === 0) {
      resolve();
      return;
    }

    reject(new Error(`pkg failed with exit code ${code}`));
  });
});

await chmod(binaryPath, 0o755);
