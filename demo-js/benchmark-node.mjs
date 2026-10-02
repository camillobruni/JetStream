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

// Runs the workload in Node (`npm test`) without the full JetStream harness or
// a build step. It drives the real `Benchmark` class from benchmark.js through
// the same hook sequence as JetStreamDriver.js, against a minimal shim of the
// globals the harness would provide. Handy for quick iteration on src/.

import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import * as DemoJS from "./src/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Keep in sync with the demo-js entry in JetStreamDriver.js.
const PRELOAD = {
    WORDS: path.join(__dirname, "data/words.json"),
};
const ARGS = { repetitions: 2000 };
const ITERATIONS = 20;

// Minimal stand-ins for what the harness injects into the workload's global:
// JetStream.preload maps names to paths, and getString reads them from disk.
globalThis.JetStream = {
    preload: PRELOAD,
    getString: async (file) => fs.readFileSync(file, "utf8"),
    getBinary: async (file) => new Int8Array(fs.readFileSync(file)),
};
// Instead of loading dist/bundle.js, use the sources directly.
globalThis.DemoJS = DemoJS;

// benchmark.js is a classic script that declares a global `Benchmark` class.
const benchmarkSource = fs.readFileSync(path.join(__dirname, "benchmark.js"), "utf8");
const Benchmark = vm.runInThisContext(`${benchmarkSource}\n;Benchmark`);

// Same hook sequence as the AsyncBenchmark runner in JetStreamDriver.js.
const benchmark = new Benchmark({ ...ARGS, iterationCount: ITERATIONS });
await benchmark.init?.();
const times = [];
for (let i = 0; i < ITERATIONS; i++) {
    await benchmark.prepareForNextIteration?.();
    const start = performance.now();
    await benchmark.runIteration(i);
    times.push(performance.now() - start);
}
benchmark.validate?.(ITERATIONS);

const average = times.slice(1).reduce((a, b) => a + b, 0) / (times.length - 1);
console.log(`First: ${times[0].toFixed(2)}ms, Average: ${average.toFixed(2)}ms`);
