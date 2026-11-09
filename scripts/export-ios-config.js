#!/usr/bin/env node
// Writes ios/BrainBlight/platforms.json from config/platforms.js, applying each
// platform's `ios` overrides. The iPhone app bundles that JSON file.
const fs = require('node:fs');
const path = require('node:path');

const src = process.argv[2] || path.join(__dirname, '..', 'config', 'platforms.js');
const out = path.join(__dirname, '..', 'ios', 'BrainBlight', 'platforms.json');
const cfg = require(path.resolve(src));

const platforms = cfg.platforms.map(({ ios, ...p }) => ({ ...p, ...(ios || {}) }));
const json = JSON.stringify({ platforms, input: cfg.input || {} }, null, 2) + '\n';
fs.writeFileSync(out, json);
console.log(`wrote ${path.relative(process.cwd(), out)} (${platforms.length} platforms)`);
