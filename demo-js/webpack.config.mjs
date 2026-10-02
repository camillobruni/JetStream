/*
 * Copyright 2026 Google LLC
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

// Bundles src/ into dist/bundle.js, a classic (non-module) script that JetStream
// can load via the `files` list in JetStreamDriver.js.

import path from "path";
import { fileURLToPath } from "url";
import TerserPlugin from "terser-webpack-plugin";
import { LicenseWebpackPlugin } from "license-webpack-plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
    entry: "./src/index.mjs",
    mode: "production",
    // No eval-based source maps: workloads must run as plain scripts in shells.
    devtool: false,
    target: ["web", "es2020"],
    output: {
        path: path.resolve(__dirname, "dist"),
        filename: "bundle.js",
        // Expose the entry module's exports as `globalThis.DemoJS`.
        library: {
            name: "DemoJS",
            type: "global",
        },
        globalObject: "globalThis",
        clean: true,
    },
    plugins: [
        // Like the other bundled workloads, collect all license texts into
        // dist/LICENSE.txt instead of keeping them inline in the bundle.
        // Third-party npm dependencies are picked up automatically; the
        // workload's own license comes from demo-js/LICENSE.
        new LicenseWebpackPlugin({
            perChunkOutput: false,
            outputFilename: "LICENSE.txt",
            additionalModules: [
                { name: "jetstream-demo-js", directory: __dirname },
            ],
        }),
    ],
    optimization: {
        minimizer: [
            new TerserPlugin({
                extractComments: false,
                terserOptions: {
                    // Keep the bundle readable for profiling. Real workloads
                    // often ship an additional minified variant.
                    compress: false,
                    mangle: false,
                    format: {
                        beautify: true,
                        // Strip all comments, licenses live in LICENSE.txt.
                        comments: false,
                    },
                },
            }),
        ],
    },
};
