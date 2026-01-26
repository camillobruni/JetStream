import path from "path";
import { fileURLToPath } from "url";
import UnicodeEscapePlugin from "@dapplets/unicode-escape-webpack-plugin";
import { LicenseWebpackPlugin } from "license-webpack-plugin";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createConfig({ filename, mode }) {
  const isProd = mode === "production";
  return {
    entry: "./src/test.mjs",
    mode,
    devtool: isProd ? "source-map" : false,
    target: ["web", "es6"],
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: filename,
      library: {
        name: "ValidatorJSBenchmark",
        type: "globalThis",
      },
      libraryTarget: "assign",
      chunkFormat: "commonjs",
    },
    plugins: [
      new UnicodeEscapePlugin(),
      new LicenseWebpackPlugin({
        perChunkOutput: true, 
        outputFilename: "LICENSE.txt",
      })
    ],
    optimization: {
      minimize: isProd,
    },
  };
}

export default [
  createConfig({ filename: "bundle.min.js", mode: "production" }),
  createConfig({ filename: "bundle.dev.js", mode: "development" }),
];
