import path from "path";
import TerserPlugin from "terser-webpack-plugin";
import { LicenseFilePlugin } from "generate-license-file-webpack-plugin";
import { fileURLToPath } from "url";
import UnicodeEscapePlugin from "@dapplets/unicode-escape-webpack-plugin";
import CacheBusterPlugin from "../utils/BabelCacheBuster.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createConfig({ filename, mode, target}) {
    const isProd = mode === "production";
    let babelPlugins = [];
    let babelTargets = { chrome: "100" };
    if (target === "es5") {
        // enable loose class definitions for es5 (e.g. with prototype assignments)
        babelPlugins = [["@babel/plugin-transform-classes", { loose: true }]];
        // Use a reasonably ok pre-es6 classes browser.
        babelTargets = { chrome: "40" };
    }
    return {
        entry: "./src/babylon-js-benchmark.mjs",
        mode,
        devtool: isProd ? "source-map" : false,
        target: ["web", target],
        output: {
            path: path.resolve(__dirname, "dist"),
            filename: filename,
            library: {
                name: "BabylonJSBenchmark",
                type: "globalThis",
            },
            libraryTarget: "assign",
            chunkFormat: "commonjs",
        },
        module: {
            rules: [
                {
                    test: /\.[cm]?js$/,
                    use: {
                        loader: "babel-loader",
                        options: {
                            presets: [["@babel/preset-env", { targets: babelTargets }]],
                            plugins: [CacheBusterPlugin, ...babelPlugins],
                        },
                    },
                },
            ],
        },
        plugins: [
            new LicenseFilePlugin({
                outputFileName: "LICENSE.txt",
            }),
            new UnicodeEscapePlugin({
                test: /\.(js|jsx|ts|tsx)$/, // Escape Unicode in JavaScript and TypeScript files
            }),
        ],
        optimization: {
            minimizer: [
                new TerserPlugin({
                    extractComments: false,
                    terserOptions: {
                        mangle: isProd,
                        format: {
                            // Keep this comment for cache-busting.
                            comments: /@preserve|@license|@cc_on|ThouShaltNotCache/i,
                        },
                    },
                }),
            ],
        },
        resolve: {
            fallback: {
                assert: "assert/",
                fs: false,
                path: "path-browserify",
            },
        },
    };
}

export default [
    createConfig({
        filename: "bundle.es6.dev.js",
        mode: "development",
        target: "es6" 
    }),
    createConfig({
        filename: "bundle.es5.dev.js",
        mode: "development",
        target: "es6" 
    }),
    createConfig({
        filename: "bundle.es6.min.js",
        mode: "production",
        target: "es5" 
    }),
    createConfig({
        filename: "bundle.es5.min.js",
        mode: "production",
        target: "es5" 
    }),
];
