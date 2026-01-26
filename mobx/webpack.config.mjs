import path from "path";
import { fileURLToPath } from "url";
import TerserPlugin from "terser-webpack-plugin";
import { LicenseFilePlugin } from "generate-license-file-webpack-plugin";

import CacheBusterCommentPlugin from "../utils/BabelCacheBuster.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function config({ filename, mode, target }) {
  const isProd = mode === "production";
  return {
    entry: "./src/test.mjs",
    mode,
    devtool: isProd ? "source-map" : false,
    target: ["web", target],
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: filename,
      library: {
        name: "MobXBenchmark",
        type: "globalThis",
      },
      libraryTarget: "assign",
      chunkFormat: "commonjs",
    },
    module: {
      rules: [
        {
          test: /\.m?js$/,
          use: {
            loader: "babel-loader",
            options: {
              plugins: [CacheBusterCommentPlugin],
            },
          },
        },
      ],
    },
    plugins: [new LicenseFilePlugin({
      outputFileName: "LICENSE.txt",
    })],
    optimization: {
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            mangle: isProd,
            format: {
              // Keep this comment for cache-busting.
              comments: /ThouShaltNotCache/i,
            },
          },
        }),
      ],
    },
  };
}

export default [
  config({ filename: "bundle.es6.min.js", mode: "production" , target: "es6" }),
  config({ filename: "bundle.es6.dev.js", mode: "development", target: "es6" }),
  config({ filename: "bundle.es5.min.js", mode: "production" , target: "es5" }),
  config({ filename: "bundle.es5.dev.js", mode: "development", target: "es5" }),
];
