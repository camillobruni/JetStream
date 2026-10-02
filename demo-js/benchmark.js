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
// demo-js: documented template workload (not a meaningful benchmark).
// Copy demo-js/ to start a new workload.
//
// Run:
//   - Browser: http://localhost:8010/?test=demo-js
//   - Shell:   d8 cli.js -- --test=demo-js
//
// -----------------------------------------------------------------------------
// 0. Layout and build
// -----------------------------------------------------------------------------
//
//   demo-js/
//     package.json         `npm run build` / `npm test`.
//     webpack.config.mjs   Bundles src/ into dist/bundle.js.
//     src/*.mjs            Workload sources (ES modules, may use npm deps).
//     dist/bundle.js       Checked-in build output, defines globalThis.DemoJS.
//     dist/LICENSE.txt     Generated license texts for the bundle.
//     LICENSE              License of the workload sources.
//     data/                Inputs, loaded via `preload`.
//     benchmark.js         Harness glue (this file).
//     benchmark-node.mjs   Runs benchmark.js + src/ in Node.
//
//   - JetStream never builds; rebuild and commit dist/ after changes:
//     `npm ci && npm run build`.
//   - Keep the build reproducible (checked by `npm run test:build`).
//   - Keep generated code Latin-1 only, or set `allowUtf16`.
//
// -----------------------------------------------------------------------------
// 1. Registration (JetStreamDriver.js)
// -----------------------------------------------------------------------------
//
//   new AsyncBenchmark({
//       name: "demo-js",                    // Unique, used for --test=.
//       files: [                            // Classic scripts, in order.
//           "./demo-js/dist/bundle.js",
//           "./demo-js/benchmark.js",
//       ],
//       preload: {                          // Fetched before the run.
//           WORDS: "./demo-js/data/words.json",
//       },
//       args: { repetitions: 2000 },        // Passed to the constructor.
//       iterations: 20,                     // Default: 120.
//       worstCaseCount: 3,                  // Default: 4.
//       deterministicRandom: false,         // Seeded Math.random, see 3.
//       exposeBrowserTest: false,           // JetStream.isInBrowser / isD8.
//       allowUtf16: false,                  // Sources must be Latin-1.
//       tags: ["js", "example"],
//   }),
//
// Benchmark classes (see JetStreamDriver.js):
//   - DefaultBenchmark:  sync hooks, no init().
//   - AsyncBenchmark:    async hooks, init(), JetStream loaders (preferred).
//   - WasmEMCCBenchmark: AsyncBenchmark plus emscripten `Module` setup.
//   - GroupedBenchmark:  runs several sub-benchmarks as one entry.
//
// Tags:
//   - Every benchmark needs "js" or "wasm".
//   - No "default" tag => auto-tagged "disabled", only runs when selected.
//   - Tags must not collide with benchmark names.
//
// Documentation:
//   - Every benchmark needs an entry in in-depth.html.
//
// -----------------------------------------------------------------------------
// 2. Execution model
// -----------------------------------------------------------------------------
//
//   - Each workload runs in a fresh global (iframe / shell realm).
//   - Load order: JetStream globals, optional helpers, `files`, runner.
//   - Any exception in any hook fails the workload.
//
// Simplified AsyncBenchmark runner:
//
//   const benchmark = new Benchmark({ ...args, iterationCount });
//   await benchmark.init?.();
//   for (let i = 0; i < iterationCount; i++) {
//       await benchmark.prepareForNextIteration?.();
//       Math.random.__resetSeed();               // If deterministicRandom.
//       <customPreIterationCode>
//       start = performance.now();
//       await benchmark.runIteration(i);         // Only this is timed.
//       end = performance.now();
//       <customPostIterationCode>
//       results.push(Math.max(1, end - start));
//   }
//   benchmark.validate?.(iterationCount);
//
// Scoring (score = 5000 / time_ms, combined via geometric mean):
//   - First:   first iteration.
//   - Worst:   mean of the `worstCaseCount` slowest remaining iterations.
//   - Average: mean of the remaining iterations.
//
// -----------------------------------------------------------------------------
// 3. Globals
// -----------------------------------------------------------------------------
//
// JetStream:
//   - preload.<NAME>:   blob URL / path per `preload` entry; load it with
//                       getString/getBinary, never fetch().
//   - resources[<path>]: same, keyed by original path.
//   - getString(url), getBinary(url), dynamicImport(url)   [AsyncBenchmark]
//   - isInBrowser, isD8                                    [exposeBrowserTest]
//     Only for environment-specific code, e.g. worker/bomb.js.
//
// Other:
//   - Math.random: seeded per iteration with `deterministicRandom: true`.
//     Only for third-party code; workload code should not use Math.random.
//   - performance.now/mark/measure: always available.
// =============================================================================


// Expected quickHash() of the normalized text, see validate().
// Update when changing data/words.json or `repetitions`.
const EXPECTED_TEXT_HASH = 2018141023;


// The harness instantiates the global `Benchmark` class. Most workloads,
// including this one, define it without a base class.
//
// Optional base class for startup / code-loading workloads (not used here):
// utils/StartupBenchmark.js, see prismjs/ or mobx/.
//   - Add "./utils/StartupBenchmark.js" to `files`.
//   - Preload the bundle as BUNDLE.
//   - Pass `expectedCacheCommentCount` (count of /*ThouShaltNotCache*/
//     comments, inserted by utils/BabelCacheBuster.mjs).
//   - eval() `this.iterationSourceCodes[i]`, a fresh copy per iteration.
//   - Call `await super.init()` when overriding init().
class Benchmark {
    // constructor(args): untimed. `args` from the registration plus
    // `iterationCount`. Keep it cheap; do setup in init().
    constructor({ repetitions = 100, iterationCount }) {
        this.repetitions = repetitions;
        this.iterationCount = iterationCount;
        this.words = null;
        this.input = null;
        this.lastResult = null;
        this.iterationsRun = 0;
    }

    // async init(): optional, untimed, called once (AsyncBenchmark only).
    //   - Load preloads, compile Wasm, build inputs.
    //   - Avoid console output.
    async init() {
        const json = await JetStream.getString(JetStream.preload.WORDS);
        this.words = JSON.parse(json).words;
    }

    // async prepareForNextIteration(): optional, untimed, before every
    // iteration. Reset state so each iteration does the same work.
    async prepareForNextIteration() {
        this.input = [];
        for (let i = 0; i < this.repetitions; i++)
            this.input.push(...this.words);
    }

    // async runIteration(iteration): required, timed.
    //   - Aim for 10-100ms per iteration.
    //   - Same amount of work every iteration.
    //   - Keep a result so the work cannot be optimized away.
    //   - No I/O or timers; use `preload`.
    async runIteration(iteration) {
        // DemoJS is defined by dist/bundle.js (listed before this file).
        const text = DemoJS.normalize(this.input);
        const sorted = DemoJS.countWords(text);

        // Keep the result alive to prevent dead code elimination.
        this.lastResult = { text, sorted };
        this.iterationsRun++;
    }

    // validate(iterationCount): optional, untimed, after the last iteration.
    //   - Throw to fail the run.
    //   - Don't rely on console.assert: it only logs in browsers.
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

        // Check large outputs against a hash instead of a checked-in copy.
        const hash = this.quickHash(text);
        if (hash !== EXPECTED_TEXT_HASH)
            throw new Error(`Expected text hash ${EXPECTED_TEXT_HASH}, got ${hash}`);
    }

    // Cheap sampling hash, same as StartupBenchmark.quickHash().
    //   - Reads every 919th char: pair with structural checks.
    //   - Prefer hashing in validate(); hashing in runIteration() is timed.
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
