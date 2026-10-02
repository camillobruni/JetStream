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

// Runs the workload sources directly in Node (`npm test`), without the
// JetStream harness or a build step. Handy for quick iteration on src/.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { countWords, shuffle } from "./src/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { words } = JSON.parse(fs.readFileSync(path.join(__dirname, "data/words.json"), "utf8"));

const REPETITIONS = 2000;
const input = [];
for (let i = 0; i < REPETITIONS; i++)
    input.push(...words);

const start = performance.now();
const sorted = countWords(shuffle(input));
const end = performance.now();

if (sorted.length !== words.length || sorted.some(([, count]) => count !== REPETITIONS))
    throw new Error("Unexpected word counts");
console.log(`Counted ${input.length} words in ${(end - start).toFixed(2)}ms`);
