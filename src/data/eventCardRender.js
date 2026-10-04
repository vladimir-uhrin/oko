// src/data/eventCardRender.js — obrázok udalosti do JPEG na serveri (Udalosti, etapa 2b, 2026-09-30).
// SVG skladá eventCard.js (pure); tu sa k nemu pridajú mapové podklady z repa (more Natural Earth
// 10m, hranice 1:50m — voľné dielo, načítané raz pri prvom obrázku) a sharp ho prevedie na JPEG.
// sharp sa načíta dynamicky: len server, klient ho nikdy nevidí.

import fs from 'node:fs';
import path from 'node:path';
import { CARD_FORMATS, buildEventCardSvg } from './eventCard.js';

export const CARD_JPEG_QUALITY = 86;

/** Hranice z GeoJSONL (jeden LineString na riadok) → [[lon, lat], …] na čiaru. Pure. */
export function parseBorderLines(text) {
  const lines = [];
  for (const row of String(text || '').split('\n')) {
    if (!row.trim()) continue;
    try {
      const f = JSON.parse(row);
      const c = f?.geometry?.type === 'LineString' ? f.geometry.coordinates : null;
      if (Array.isArray(c) && c.length >= 2) lines.push(c);
    } catch { /* poškodený riadok preskoč */ }
  }
  return lines;
}

/**
 * Mapové podklady z repa (more Natural Earth, hranice 1:50m) — načítané raz, pri prvom použití.
 * Zdieľa ich obrázok aj video udalosti.
 * @param {{dataDir: string, readFile?: (file: string) => string}} opts
 * @returns {() => {marine: object[], borders: number[][][]}}
 */
export function basemapLoader({ dataDir, readFile = (file) => fs.readFileSync(file, 'utf8') } = {}) {
  let basemap = null;
  return () => {
    if (basemap) return basemap;
    let marine = [];
    let borders = [];
    try { marine = JSON.parse(readFile(path.join(dataDir, 'natural_earth', 'marine.json'))).features || []; } catch { marine = []; }
    try { borders = parseBorderLines(readFile(path.join(dataDir, 'boundaries', 'boundaries.geojsonl'))); } catch { borders = []; }
    basemap = { marine, borders };
    return basemap;
  };
}

/** sharp načítaný dynamicky; neúspešné načítanie sa nepamätá — ďalší pokus to skúsi znova. */
export function sharpOnce(sharpLoader = () => import('sharp').then((m) => m.default || m)) {
  let sharpPromise = null;
  return () => {
    if (!sharpPromise) sharpPromise = sharpLoader().catch((error) => { sharpPromise = null; throw error; });
    return sharpPromise;
  };
}

/**
 * @param {{dataDir: string, sharpLoader?: () => Promise<any>, readFile?: (file: string) => string}} opts
 * @returns {(event: object, format?: 'og'|'feed') => Promise<{jpeg: Buffer, width: number, height: number, format: string}>}
 */
export function createEventCardRenderer({
  dataDir,
  sharpLoader = () => import('sharp').then((m) => m.default || m),
  readFile = (file) => fs.readFileSync(file, 'utf8'),
} = {}) {
  const loadBasemap = basemapLoader({ dataDir, readFile });
  const getSharp = sharpOnce(sharpLoader);
  return async function render(event, format = 'og', { frame = null } = {}) {
    const fmt = CARD_FORMATS[format] ? format : 'og';
    const { marine, borders } = loadBasemap();
    // `frame` (2026-10-04, karusel do Štúdia): snímka v čase momentu — stopa po t, aktuálny moment zvýraznený.
    const svg = buildEventCardSvg(event, { format: fmt, marine, borders, frame });
    const sharp = await getSharp();
    const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: CARD_JPEG_QUALITY }).toBuffer();
    return { jpeg, width: CARD_FORMATS[fmt].w, height: CARD_FORMATS[fmt].h, format: fmt };
  };
}
