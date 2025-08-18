const EXPECTED_ASSERTION_COUNT = 1213680;

function quickHash(str) {
  let hash = 5381;
  let i = str.length;
  while (i > 0) {
    hash = (hash * 33) ^ (str.charCodeAt(i) | 0);
    i -= 919;
  }
  return hash | 0;
}

const CACHE_BUST_COMMENT = "/*ThouShaltNotCache*/";
const CACHE_BUST_COMMENT_RE = new RegExp(
  `\n${RegExp.escape(CACHE_BUST_COMMENT)}\n`,
  "g"
);

class Benchmark {
  // How many times (separate iterations) should we reuse the source code.
  // Use 0 to skip.
  CODE_REUSE_COUNT = 8;
  iterationCount = 0;
  iteration = 0;
  sourceCode;
  sourceHash = 0;
  iterationSourceCodes = [];

  lastResult;

  constructor(iterationCount) {
    this.iterationCount = iterationCount;
  }

  async init() {
    this.sourceCode = await JetStream.getString(JetStream.preload.BUNDLE);
    const cacheCommentCount = this.sourceCode.match(
      CACHE_BUST_COMMENT_RE
    ).length;
    const EXPECTED_CACHE_COMMENT_COUNT = 464;
    console.assert(
       cacheCommentCount === EXPECTED_CACHE_COMMENT_COUNT,
      `Invalid cache comment count ${cacheCommentCount} expected ${EXPECTED_CACHE_COMMENT_COUNT}.`
    );
    for (let i = 0; i < this.iterationCount; i++)
      this.iterationSourceCodes[i] = this.prepareCode(i);
  }

  async loadData(lang, file, hash) {
    const sample = { lang, hash };
    // Push eagerly to have deterministic order.
    this.samples.push(sample);
    sample.content = await JetStream.getString(file);
    // Warm up quickHash and force good string representation.
    quickHash(sample.content);
    console.assert(sample.content.length > 0);
  }

  prepareCode(iteration) {
    if (!this.CODE_REUSE_COUNT) return this.sourceCode;
    // Alter the code per iteration to prevent caching.
    const cacheId = Math.floor(iteration / this.CODE_REUSE_COUNT) * this.CODE_REUSE_COUNT;
    const previousSourceCode = this.iterationSourceCodes[cacheId];
    if (previousSourceCode) {
      return previousSourceCode;
    }
    const sourceCode = this.sourceCode.replaceAll(
      CACHE_BUST_COMMENT_RE,
      `/*${cacheId}*/`
    );
    // Ensure efficient string representation.
    this.sourceHash = quickHash(sourceCode);
    return sourceCode;
  }

  runIteration(iteration) {
    // Module is loaded into PrismJSBenchmark
    let MobXBenchmark;
    eval(this.iterationSourceCodes[iteration]);

    this.lastResult = MobXBenchmark.runTest();
  }

  validate() {
  }
}
