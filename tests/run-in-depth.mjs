import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

async function run() {
    console.log("Starting in-depth.html benchmark validation...");

    // 1. Parse in-depth.html
    const inDepthHtmlPath = path.join(rootDir, "in-depth.html");
    const inDepthHtml = fs.readFileSync(inDepthHtmlPath, "utf8");
    const dom = new JSDOM(inDepthHtml);
    const document = dom.window.document;

    const dtElements = document.querySelectorAll("#workload-details dt[id]");
    const inDepthBenchmarks = new Set();
    dtElements.forEach(dt => {
        inDepthBenchmarks.add(dt.id);
    });

    console.log(`Found ${inDepthBenchmarks.size} benchmarks in in-depth.html`);

    // 2. Load JetStreamDriver.js to get the actual list of benchmarks
    // We need to simulate the environment required by JetStreamDriver.js
    const paramsJsPath = path.join(rootDir, "utils", "params.js");
    const paramsJs = fs.readFileSync(paramsJsPath, "utf8");

    const driverJsPath = path.join(rootDir, "JetStreamDriver.js");
    const driverJs = fs.readFileSync(driverJsPath, "utf8");

    const simDom = new JSDOM("<!DOCTYPE html>", {
        runScripts: "dangerously",
        url: "http://localhost/",
        pretendToBeVisual: true
    });
    const window = simDom.window;
    
    // Mock global environment variables expected by the scripts
    window.isInBrowser = true;
    window.isD8 = false;
    window.isSpiderMonkey = false;
    window.globalThis = window; // JetStreamDriver uses globalThis
    window.print = console.log; // For debugging if needed

    // Force JetStreamDriver to load all benchmarks
    window.JetStreamParamsSource = new URLSearchParams("tags=all");

    // Execute utils/params.js
    try {
        window.eval(paramsJs + "; window.JetStreamParams = JetStreamParams;");
    } catch (e) {
        console.error("Failed to execute utils/params.js:", e);
        process.exit(1);
    }

    // Execute JetStreamDriver.js
    try {
        window.eval(driverJs);
    } catch (e) {
        console.error("Failed to execute JetStreamDriver.js:", e);
        process.exit(1);
    }

    if (!window.JetStream || !window.JetStream.benchmarks) {
        console.error("Failed to initialize JetStream driver or find benchmarks.");
        process.exit(1);
    }

    const definedBenchmarks = window.JetStream.benchmarks;
    console.log(`Found ${definedBenchmarks.length} benchmarks in JetStreamDriver.js`);

    // 3. Verify consistency
    let errors = [];

    // Check if all defined benchmarks are in in-depth.html
    definedBenchmarks.forEach(benchmark => {
        if (!inDepthBenchmarks.has(benchmark.name)) {
            errors.push(`Benchmark '${benchmark.name}' is defined in JetStreamDriver.js but missing in in-depth.html`);
        }
    });

    // Optional: Check if all in-depth.html benchmarks exist in Driver (to catch zombies)
    // The prompt specifically asked: "checks that all benchmarks defined in JetStreamDriver.js actually exist as <dt>"
    // But checking the reverse is also good practice.
    inDepthBenchmarks.forEach(name => {
        const found = definedBenchmarks.find(b => b.name === name);
        if (!found) {
            errors.push(`Benchmark '${name}' is listed in in-depth.html but not defined in JetStreamDriver.js`);
        }
    });

    // 4. Check relative links in <dd> sections
    console.log("Checking relative links in <dd> sections...");
    const ddElements = document.querySelectorAll("#workload-details dd");
    ddElements.forEach(dd => {
        const links = dd.querySelectorAll("a[href]");
        links.forEach(link => {
            const href = link.getAttribute("href");
            if (href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("#")) {
                return;
            }
            
            // Handle anchors in file paths (e.g. "foo.html#bar") and query params
            const relativePath = href.split("#")[0].split("?")[0];
            const filePath = path.join(rootDir, relativePath);
            
            if (!fs.existsSync(filePath)) {
                errors.push(`Broken link in in-depth.html: '${href}' (resolved to '${filePath}') does not exist.`);
            }
        });
    });

    if (errors.length > 0) {
        console.error("\nValidation Failed:");
        errors.forEach(err => console.error(`- ${err}`));
        process.exit(1);
    } else {
        console.log("\nValidation Passed: All benchmarks are correctly documented.");
        process.exit(0);
    }
}

run().catch(e => {
    console.error("Unhandled error:", e);
    process.exit(1);
});
