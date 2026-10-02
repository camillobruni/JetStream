# demo-js: template workload for JetStream

A non-scoring workload that documents every harness hook and global; see the
comments in [benchmark.js](benchmark.js). Copy this directory to start a new
workload.

## Build Instructions

```bash
# install required node packages.
npm ci
# build the workload, output is ./dist
npm run build
# optional: run benchmark.js + src/ in node with a minimal JetStream shim.
npm test
```

## Running

```bash
# from the repository root
d8 cli.js -- --test=demo-js
# or browse to http://localhost:8010/?test=demo-js after `npm run server`
```
