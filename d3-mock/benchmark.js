


class Benchmark {

  async init() {
    this.flareImportsData = await getString(FLARE_IMPORTS_BLOB);
    console.assert(this.flareImportsData.length > 0, `Got empty blob ${FLARE_IMPORTS_BLOB}`);
    this.lifeData = await getString(LIFE_BLOB);
    console.assert(this.lifeData.length > 0, `Got empty blob ${LIFE_BLOB}`);
  }

  runIteration() {
    d3ChordDependency(this.flareImportsData);
    d3TreeOfLife(this.lifeData)
  }

}