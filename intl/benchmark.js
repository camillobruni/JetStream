
class Benchmark {
  measureItems = false
  lastResult;
  totalLength = 0;

  runIteration() {
    // See implementations in src/.
    const {lastResult, totalLength} = runTest();
    this.lastResult = lastResult;
    this.totalLength += totalLength;
  }
}
