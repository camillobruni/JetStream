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

// =============================================================================
// JetStream demo-js workload: a fully documented template for new workloads.
// =============================================================================
//
// This workload is not a meaningful benchmark. It exists to document every
// hook and global that the JetStream harness (JetStreamDriver.js) offers to a
// workload. Copy the demo-js/ directory as a starting point for a new one.
//
// Run it with:
//   Browser: http://localhost:8010/?test=demo-js
//   Shell:   d8 cli.js -- --test=demo-js   (or: jsc cli.js -- --test=demo-js)
//
// -----------------------------------------------------------------------------
// 0. Directory layout and build step
// -----------------------------------------------------------------------------
//
//   demo-js/
//     package.json         `npm run build` / `npm test` scripts and deps.
//     webpack.config.mjs   Bundles src/ into dist/bundle.js.
//     src/*.mjs            Workload sources as ES modules (may use npm deps).
//     dist/bundle.js       Checked-in build output, exposes globalThis.DemoJS.
//     data/                Input files, loaded via `preload`.
//     benchmark.js         Harness glue: the `Benchmark` class (this file).
//     benchmark-node.mjs   Runs src/ directly in Node, without the harness.
//
// JetStream itself never runs a build: it only loads checked-in classic
// scripts. After changing src/ or dependencies, rebuild and commit dist/:
//
//   cd demo-js && npm ci && npm run build
//
// tests/run-build.mjs (`npm run test:build`) runs `npm ci && npm run build`
// for every package.json with a "build" script, so keep the build
// reproducible. Keep generated code Latin-1 only, or set `allowUtf16`.
//
// -----------------------------------------------------------------------------
// 1. Registration (JetStreamDriver.js)
// -----------------------------------------------------------------------------
//
// Every workload is registered in the BENCHMARKS list of JetStreamDriver.js:
//
//   new AsyncBenchmark({
//       name: "demo-js",                    // Unique name, used for --test=.
//       files: [                            // Classic scripts, loaded in order.
//           "./demo-js/dist/bundle.js",     //   Build output (library code).
//           "./demo-js/benchmark.js",       //   Harness glue.
//       ],
//       preload: {                          // Resources fetched upfront.
//           WORDS: "./demo-js/data/words.json",
//       },
//       args: { repetitions: 2000 },        // Passed to the constructor.
//       iterations: 20,                     // Default: 120.
//       worstCaseCount: 3,                  // Default: 4.
//       deterministicRandom: true,          // Seeded Math.random.
//       exposeBrowserTest: true,            // JetStream.isInBrowser / isD8.
//       allowUtf16: false,                  // Sources must be Latin-1 only.
//       tags: ["js", "example"],            // No "default" => not run by default.
//   }),
//
// Startup-focused workloads instead put the bundle into `preload` and
// evaluate a fresh copy per iteration, see utils/StartupBenchmark.js and
// prismjs/benchmark.js.
//
// Benchmark classes (pick the one matching your workload):
//   - DefaultBenchmark: synchronous; calls runIteration() / validate() /
//     prepareForNextIteration() but NOT init().
//   - AsyncBenchmark: like DefaultBenchmark but every hook may be async and
//     init() is called. Also provides JetStream.getString / getBinary /
//     dynamicImport (see section 3). Prefer this for new workloads.
//   - WasmEMCCBenchmark: AsyncBenchmark plus an emscripten `Module` global and
//     silenced print/abort, for emcc-compiled Wasm.
//   - GroupedBenchmark: runs several sub-benchmarks and reports them as one.
//
// Tags: every benchmark needs either "js" or "wasm". Benchmarks without the
// "default" tag are automatically tagged "disabled" and only run when
// selected explicitly (e.g. by name or tag). Tags must not collide with
// benchmark names. Every benchmark also needs an entry in in-depth.html.
//
// -----------------------------------------------------------------------------
// 2. Execution model
// -----------------------------------------------------------------------------
//
// Each workload runs in a fresh global (an iframe in browsers, a new
// realm/global in shells). The harness concatenates, in order:
//   a) the JetStream global and performance.mark/measure polyfills,
//   b) optional helpers (deterministic Math.random, browser test flags,
//      JetStream.getString & friends),
//   c) all `files` of the benchmark,
//   d) the runner code below, which drives the global `Benchmark` class.
//
// Simplified AsyncBenchmark runner code:
//
//   const benchmark = new Benchmark({ ...args, iterationCount });
//   await benchmark.init?.();                      // Not timed.
//   for (let i = 0; i < iterationCount; i++) {
//       await benchmark.prepareForNextIteration?.(); // Not timed.
//       Math.random.__resetSeed();                 // If deterministicRandom.
//       <customPreIterationCode>                   // Developer param.
//       performance.mark(`${name}-iteration-${i}`);
//       start = performance.now();
//       await benchmark.runIteration(i);           // TIMED.
//       end = performance.now();
//       performance.measure(`${name}-iteration-${i}`, ...);
//       <customPostIterationCode>                  // Developer param.
//       results.push(Math.max(1, end - start));
//   }
//   benchmark.validate?.(iterationCount);          // Not timed.
//
// Any exception (in any hook) fails the workload and is reported as an error.
//
// Scoring (DefaultBenchmark / AsyncBenchmark), with score = 5000 / time_ms:
//   - "First":   the first iteration (startup / cold performance).
//   - "Worst":   mean of the `worstCaseCount` slowest remaining iterations
//                (jank, GC and tier-up pauses).
//   - "Average": mean of all remaining iterations (peak performance).
//   The workload score is the geometric mean of these sub-scores.
//
// -----------------------------------------------------------------------------
// 3. Globals available to the workload
// -----------------------------------------------------------------------------
//
// globalThis.JetStream (accessing unknown properties throws):
//   - JetStream.preload.<NAME>: blob URL (browser) or file path (shell) for
//     each `preload` entry. Pass it to the loaders below; never fetch() it
//     directly, as shells have no fetch.
//   - JetStream.resources[<path>]: the same blob URL/path, keyed by the
//     original resource path. Useful when a library requests files by path.
//   - JetStream.getString(url)  -> Promise<string>      [AsyncBenchmark]
//   - JetStream.getBinary(url)  -> Promise<Int8Array>   [AsyncBenchmark]
//   - JetStream.dynamicImport(url) -> Promise<module>   [AsyncBenchmark]
//   - JetStream.isInBrowser, JetStream.isD8             [exposeBrowserTest]
//
// Other globals:
//   - Math.random: seeded and reset before every iteration when
//     `deterministicRandom: true`, so every iteration sees the same sequence.
//   - performance.now/mark/measure: always present (polyfilled in shells).
//     Workloads may add their own marks for profiling.
//   - console: a copy of the harness console (shells).
//
// -----------------------------------------------------------------------------
// 4. Developer parameters that affect hooks
// -----------------------------------------------------------------------------
//
// URL params (browser) or cli.js flags (shell, see `cli.js -- --help`):
//   - iterationCount / worstCaseCount: override the defaults for all tests.
//   - customPreIterationCode / customPostIterationCode: code injected around
//     every runIteration() call (e.g. "gc();" for engine shells).
//   - forceGC: call gc() before every workload.
//   - prefetchResources=false: skip prefetching; preloads are read from the
//     network / disk lazily (inflates timings, but eases debugging).
// =============================================================================


// Top-level declarations in workload files are globals of the workload's
// fresh realm, so they do not leak into other workloads. Library code lives in
// src/ and is available here through the `DemoJS` global from dist/bundle.js.


// The harness looks up a global class named `Benchmark`.
class Benchmark {
    // -------------------------------------------------------------------------
    // constructor(args)
    // -------------------------------------------------------------------------
    // Called once, synchronously and untimed. `args` is the `args` object from
    // the registration, plus `iterationCount` (the effective number of
    // iterations after applying developer overrides).
    //
    // Keep the constructor cheap; do expensive or async setup in init().
    constructor({ repetitions = 100, iterationCount }) {
        this.repetitions = repetitions;
        this.iterationCount = iterationCount;
        this.words = null;
        this.input = null;
        this.lastResult = null;
        this.iterationsRun = 0;
    }

    // -------------------------------------------------------------------------
    // async init()  [optional, AsyncBenchmark only]
    // -------------------------------------------------------------------------
    // Called once after construction and before the first iteration. Not
    // timed. Use it to load preloaded resources, compile Wasm modules, or
    // build input data that should not be part of the measurement.
    //
    // NOTE: DefaultBenchmark never calls init(). Synchronous workloads must
    // do their setup in the constructor instead.
    async init() {
        if (JetStream.isInBrowser)
            console.log("demo-js: running in a browser");
        else
            console.log(`demo-js: running in a shell (isD8=${JetStream.isD8})`);

        // JetStream.preload.WORDS is a blob URL or a path; always go through
        // the JetStream loaders so it works in browsers and shells alike.
        const json = await JetStream.getString(JetStream.preload.WORDS);
        this.words = JSON.parse(json).words;
    }

    // -------------------------------------------------------------------------
    // async prepareForNextIteration()  [optional]
    // -------------------------------------------------------------------------
    // Called before every iteration (including the first) and not timed. Use
    // it to reset state so that each iteration does the same amount of work,
    // e.g. creating fresh input that runIteration() will consume or mutate.
    //
    // With `deterministicRandom: true` the seed is reset right AFTER this
    // hook, so Math.random() calls here do not affect the sequence seen by
    // runIteration().
    async prepareForNextIteration() {
        this.input = [];
        for (let i = 0; i < this.repetitions; i++)
            this.input.push(...this.words);
    }

    // -------------------------------------------------------------------------
    // async runIteration(iteration)  [required]
    // -------------------------------------------------------------------------
    // The measured unit of work, called `iterationCount` times with the
    // zero-based iteration index. Only the time spent in this method (until
    // the returned promise settles) contributes to the score.
    //
    // Guidelines:
    //   - Aim for roughly 10-100ms per iteration on a fast machine.
    //   - Do the same amount of work every iteration.
    //   - Store a result so the work cannot be optimized away, and check it
    //     in validate() (or throw right here on bad results).
    //   - Avoid I/O and timers; all resources should come from `preload`.
    async runIteration(iteration) {
        // `DemoJS` is the global defined by dist/bundle.js, which is listed
        // before this file in `files`. Math.random inside the bundle is
        // deterministic thanks to `deterministicRandom: true`.
        const shuffled = DemoJS.shuffle(this.input);
        const sorted = DemoJS.countWords(shuffled);

        this.lastResult = { first: shuffled[0], sorted };
        this.iterationsRun++;
    }

    // -------------------------------------------------------------------------
    // validate(iterationCount)  [optional]
    // -------------------------------------------------------------------------
    // Called once, synchronously, after the last iteration. Not timed. Throw
    // an Error to mark the run as failed. Use it to verify that the workload
    // computed correct results, which guards against broken engines and
    // against engines optimizing away the benchmarked work.
    validate(iterationCount) {
        if (this.iterationsRun !== iterationCount)
            throw new Error(`Expected ${iterationCount} iterations, got ${this.iterationsRun}`);

        const { first, sorted } = this.lastResult;
        if (sorted.length !== this.words.length)
            throw new Error(`Expected ${this.words.length} unique words, got ${sorted.length}`);
        for (const [word, count] of sorted) {
            if (count !== this.repetitions)
                throw new Error(`Unexpected count ${count} for ${word}`);
        }

        // Thanks to deterministicRandom, the shuffle result is identical in
        // every iteration and on every engine, so it can be checked exactly.
        if (!this.words.includes(first))
            throw new Error(`Unexpected first word: ${first}`);
    }
}
