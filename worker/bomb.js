/*
 * Copyright (C) 2018 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
*/

const MAX_CONCURRENCY_STARTUP = 8;
const MAX_CONCURRENT_RUNNING = 16;

const WORKER_SUB_TESTS = [
    rayTrace3D,
    accessNbody,
    morph3D,
    cube3D,
    accessFunnkuch,
    accessBinaryTrees,
    accessNsieve,
    bitopsBitwiseAnd,
    bitopsNsieveBits,
    controlflowRecursive,
    bitops3BitBitsInByte,
    botopsBitsInByte,
    cryptoAES,
    cryptoMD5,
    cryptoSHA1,
    dateFormatTofte,
    dateFormatXparb,
    mathCordic,
    mathPartialSums,
    mathSpectralNorm,
    stringBase64,
    stringFasta,
    stringValidateInput,
    stringTagcloud,
    stringUnpackCode,
    regexpDNA,
];

class Benchmark {
    workers = []

    async runIteration() {
        if (this.workers.length != 0) {
            console.error(this)
            throw new Error("Something bad happened.");
        }
        await this.startWorkers();
        if (this.workers.length % MAX_CONCURRENCY_STARTUP != 0)
            throw new Error(`Invalid worker count: ${this.workers.length}`);
        await this.runSubTests();
        this.workers = [];
    }

    async startWorkers() {
        if (!isInBrowser)
            throw new Error("Only works in browser");

        let testIndex = 0;
        while (testIndex < WORKER_SUB_TESTS.length) {
            const workerGroup = [];
            for (let i = 0; i < MAX_CONCURRENCY_STARTUP; i++) {
                const worker = new BenchmarkWorker(WORKER_SUB_TESTS[testIndex % WORKER_SUB_TESTS.length]);
                workerGroup.push(worker)
                this.workers.push(worker);
                testIndex++;
            }
            await Promise.all(workerGroup.map(worker => worker.readyPromise));
        }
    }

    async runSubTests() {
        const workers = this.workers.slice();
        while (workers.length > 0) {
            const workerGroup = workers.splice(workers.length - MAX_CONCURRENT_RUNNING, MAX_CONCURRENT_RUNNING);
            await Promise.all(workerGroup.map(worker => worker.runWorkload()));
        }
    }
}


class BenchmarkWorker {
    _worker;
    constructor(file) {
        this._worker = new Worker(file);
        this.readyPromise = new Promise((resolve, reject) => {
            this._worker.onmessage = (event) => {
                switch(event.data) {
                    case "ready": {
                        resolve()
                        break;
                    }
                    default:
                        reject(new Error(`Unknown worker message: ${event.data}`))
                }
            };
        });
    }

    async runWorkload() {
        await new Promise((resolve, reject) => {
            this._worker.onmessage = (event) => {
                switch(event.data) {
                    case "done": {
                        resolve()
                        break;
                    }
                    default:
                        reject(new Error(`Unknown worker message: ${event.data}`));
                }
            };
            this._worker.postMessage("start");
        });
    }
}
