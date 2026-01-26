import path from "path";
import { fileURLToPath } from "url";
import TerserPlugin from "terser-webpack-plugin";
import UnicodeEscapePlugin  from "@dapplets/unicode-escape-webpack-plugin";
import { LicenseWebpackPlugin } from "license-webpack-plugin";
import * as PathBrowserify from "path-browserify";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createConfig({filename, mode}) {
  const isProd = mode === "production";
  return {
    mode,
    devtool: isProd ? "source-map" : false,
    target: "web",
    entry: path.resolve(__dirname, "src/test.mjs"),
    output: {
      path: path.resolve(__dirname, "dist"),
      filename,
      library: {
        name: "TypeScriptCompileTest",
        type: "globalThis",
      },
      libraryTarget: "assign",
    },
    plugins: [
      new UnicodeEscapePlugin({
        test: /\.(js|jsx|ts|tsx)$/, // Escape Unicode in JavaScript and TypeScript files
      }),
      new LicenseWebpackPlugin({
        perChunkOutput: true, 
        outputFilename: "LICENSE.txt",
      }),
    ],
    optimization: {
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            keep_fnames: true,
          },
        }),
      ],
    },
    resolve: {
      fallback: {
        "path": "path-browserify",
        "fs": false,
      },
    },
  };
}

export default [
  createConfig({ filename: "bundle.min.js", mode: "production" }),
  createConfig({ filename: "bundle.dev.js", mode: "development" }),
];
