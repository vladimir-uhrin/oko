#!/usr/bin/env node
// scripts/build-geoid-grid.mjs — vygeneruje src/data/local_data/geoid/egm96-30min.js
// z plnej 15' mriežky EGM96 v balíku egm96-universal (pozri scripts/lib/geoidGrid.mjs).
// Spustenie: node scripts/build-geoid-grid.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { meanSeaLevel } from 'egm96-universal';
import { GEOID_GRID, encodeGeoidGrid, geoidModuleSource, sampleGeoidGrid } from './lib/geoidGrid.mjs';

const out = new URL('../src/data/local_data/geoid/egm96-30min.js', import.meta.url);
mkdirSync(new URL('.', out), { recursive: true });
const values = sampleGeoidGrid(meanSeaLevel);
const source = geoidModuleSource(encodeGeoidGrid(values));
writeFileSync(out, source);
console.log(`egm96-30min.js: ${GEOID_GRID.rows}×${GEOID_GRID.cols}, ${source.length} B, gzip ${gzipSync(source).length} B`);
