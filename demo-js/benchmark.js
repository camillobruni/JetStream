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
//     dist/LICENSE.txt     Generated license texts for everything in the
//                          bundle (the bundle itself has no comments).
//     LICENSE              License of the workload's own sources.
//     data/                Input files, loaded via `preload`.
//     benchmark.js         Harness glue: the `Benchmark` class (this file).
//     benchmark-node.mjs   Runs benchmark.js + src/ in Node with a JetStream shim.
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
//       deterministicRandom: false,         // Seeded Math.random, see 3.
//       exposeBrowserTest: false,           // JetStream.isInBrowser / isD8.
//       allowUtf16: false,                  // Sources must be Latin-1 only.
//       tags: ["js", "example"],            // No "default" => not run by default.
//   }),
//
// Startup-focused workloads load the bundle via `preload` instead of `files`,
// see the StartupBenchmark note next to the `Benchmark` class below.
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
//     Only for workloads that must behave differently per environment, e.g.
//     worker/bomb.js (browser-only) or wasm/tfjs-benchmark.js.
//
// Other globals:
//   - Math.random: seeded and reset before every iteration when
//     `deterministicRandom: true`, so every iteration sees the same sequence.
//     This exists for third-party code that calls Math.random internally.
//     Workload code should not use Math.random at all; if it needs
//     randomness, use its own fixed-seed PRNG.
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


// Expected quickHash() of the normalized text in validate(). It depends on
// data/words.json and the `repetitions` arg, so update it when changing
// either (validate() prints the actual value).
const EXPECTED_TEXT_HASH = 2018141023;


// The harness looks up a global class named `Benchmark`. It needs no base
// class; most workloads, including this one, define it standalone.
//
// Optional base class: utils/StartupBenchmark.js (not used here).
//   For workloads measuring startup / code-loading performance. Add
//   "./utils/StartupBenchmark.js" to `files` before your benchmark file, put
//   the bundle into `preload` as BUNDLE, and pass `expectedCacheCommentCount`
//   (plus optionally `sourceCodeReuseCount`) via `args`. Its init() loads
//   BUNDLE and creates a cache-busted copy of the source per iteration by
//   replacing /*ThouShaltNotCache*/ comments (inserted by the build via
//   utils/BabelCacheBuster.mjs), so each iteration must parse and compile the
//   code from scratch. Call `await super.init()` when overriding init():
//
//     class Benchmark extends StartupBenchmark {
//         constructor({ iterationCount, expectedCacheCommentCount }) {
//             super({ iterationCount, expectedCacheCommentCount });
//         }
//         runIteration(iteration) {
//             let MyBundle;  // Assigned by the evaluated bundle.
//             eval(this.iterationSourceCodes[iteration]);
//             this.lastResult = MyBundle.run();
//         }
//     }
//
//   See prismjs/ or mobx/ for complete examples.
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
    //
    // Avoid console output: it clutters the harness results, especially in
    // shells.
    async init() {
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
        // before this file in `files`.
        const text = DemoJS.normalize(this.input);
        const sorted = DemoJS.countWords(text);

        this.lastResult = { text, sorted };
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

        const { text, sorted } = this.lastResult;
        if (sorted.length !== this.words.length)
            throw new Error(`Expected ${this.words.length} unique words, got ${sorted.length}`);
        for (const [word, count] of sorted) {
            if (count !== this.repetitions)
                throw new Error(`Unexpected count ${count} for ${word}`);
        }

        // The output is deterministic, so it can be checked exactly.
        // Comparing a hash against a constant avoids checking in large
        // expected outputs.
        const hash = this.quickHash(text);
        if (hash !== EXPECTED_TEXT_HASH)
            throw new Error(`Expected text hash ${EXPECTED_TEXT_HASH}, got ${hash}`);
    }

    // Cheap, sampling string hash, same as StartupBenchmark.quickHash() in
    // utils/StartupBenchmark.js (also used by prismjs, web-ssr and
    // jsdom-d3-startup). It only looks at every 919th character, so hashing
    // large outputs stays cheap. It is not a full checksum: pair it with
    // structural checks (lengths, counts) as done above.
    //
    // Prefer hashing in validate() (untimed). If you need per-iteration
    // checks, hash in runIteration() and accumulate (e.g. `totalHash ^=
    // hash`), keeping in mind that this adds to the measured time.
    quickHash(str) {
        let hash = 5381;
        let i = str.length;
        while (i > 0) {
            hash = (hash * 33) ^ (str.charCodeAt(i) | 0);
            i -= 919;
        }
        return hash | 0;
    }
}
