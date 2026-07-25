#!/usr/bin/env node
/**
 * CLI decode helper — useful from phone/cloud chat without a browser.
 * Usage: node demos/can-dump-decoder/cli.mjs [path-to.log]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target =
  process.argv[2] ||
  path.join(__dirname, "samples", "racepak-running-sample.log");

const { decodeCandumpText, formatSignal, SIGNAL_META } = await import(
  pathToFileURL(path.join(__dirname, "decoder.js")).href
);

const text = fs.readFileSync(target, "utf8");
const result = decodeCandumpText(text, { maxEvents: 20 });

console.log(`File: ${target}`);
console.log(JSON.stringify(result.summary, null, 2));
console.log("\nLatest signals:");
for (const name of Object.keys(SIGNAL_META)) {
  const entry = result.latest[name];
  if (!entry) continue;
  const f = formatSignal(name, entry.value);
  console.log(`  ${name.padEnd(18)} ${f.text} ${f.unit}`);
}
