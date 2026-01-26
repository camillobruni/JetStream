import path from "path";
import { fileURLToPath } from "url";
import TerserPlugin from "terser-webpack-plugin";
import CacheBusterCommentPlugin from "../utils/BabelCacheBuster.mjs";
import UnicodeEscapePlugin from "@dapplets/unicode-escape-webpack-plugin";
import { LicenseWebpackPlugin } from "license-webpack-plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createConfig({ filename, mode, target }) {
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
                name: "PrismJSBenchmark",
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
        plugins: [
            new UnicodeEscapePlugin({
                test: /\.(js|jsx|ts|tsx)$/, // Escape Unicode in JavaScript and TypeScript files
            }),
            new LicenseWebpackPlugin({
                perChunkOutput: true,
                outputFilename: "LICENSE.txt",
            }),
        ],
        resolve: {
            fallback: {},
        },
        optimization: {
            minimizer: [
                new TerserPlugin({
                    extractComments: false,
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
    createConfig({ filename: "bundle.es6.min.js", mode: "production", target: "es6" }),
    createConfig({ filename: "bundle.es6.dev.js", mode: "development", target: "es6" }),
    createConfig({ filename: "bundle.es5.min.js", mode: "production", target: "es5" }),
    createConfig({ filename: "bundle.es5.dev.js", mode: "development", target: "es5" }),
];
