// src/hillshadeImagery.js
/**
 * @module hillshadeImagery
 * @description Analytický hillshade z „normal" dlaždíc (Mapzen/Nextzen terrain
 * tiles na AWS Open Data: RGB = normála povrchu, alfa = kvantovaná výška),
 * tieňovaný v prehliadači na plátne a podaný Cesiu ako obyčajný raster
 * podklad. Základ kartografického režimu KARTA (2026-09-20, vzorka
 * docs/drafts/karta-vzorka): tmavá modro-sivá rampa v štýle situačných máp,
 * svetlo zo severozápadu, zosilnenie sklonov (Donbas je rovina) a jemné
 * vyhladenie (SRTM zrnitosť robí „pokrčený papier").
 *
 * Overené na vzorke: zelený kanál Mapzenu ukazuje NA JUH (kontrola na údolí
 * Siverského Donca cez výšku v alfa kanáli) → predvolene `flipY: true`.
 * Dlaždice na S3 nemajú CORS; klient ich ťahá cez `/api/relief` (proxy
 * s trvalou diskovou cache — dlaždice sú statické).
 *
 * Čisté funkcie (svetlo, tieňovanie pixelov) sa testujú bez DOM; provider
 * dostane `fetchImage` a `createCanvas` injekciou.
 */
import * as Cesium from 'cesium';

/**
 * Tmavá rampa KARTA: rovina = mid, osvetlený svah = lit, tieň = shadow — hodnoty
 * schválenej vzorky (docs/drafts/karta-vzorka). Krátko boli stmavené na základe
 * výhrady, ktorá patrila inému glóbusu (2026-09-20), preto späť.
 */
export const KARTA_PALETTE = Object.freeze({ mid: [30, 44, 58], lit: [104, 124, 146], shadow: [7, 14, 23] });
/** Predvolené tieňovanie (zladené na vzorke nad Lymanom). */
export const HILLSHADE_DEFAULTS = Object.freeze({ azimuth: 315, altitude: 45, amp: 2.5, smooth: 1.4, flipY: true, gamma: 0.8, tileSize: 256, margin: 4 });

/**
 * Smer k svetlu ako jednotkový vektor [východ, sever, hore].
 * @param {number} azimuthDeg azimut od severu v smere hodinových ručičiek (315 = SZ)
 * @param {number} altitudeDeg výška nad obzorom
 */
export function lightVector(azimuthDeg, altitudeDeg) {
  const a = (azimuthDeg * Math.PI) / 180;
  const alt = (altitudeDeg * Math.PI) / 180;
  return [Math.cos(alt) * Math.sin(a), Math.cos(alt) * Math.cos(a), Math.sin(alt)];
}

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * Farba jedného pixelu z normály (zložky v −1..1). `amp` zosilní vodorovné
 * zložky (zvýraznenie sklonov), `flipY` otočí sever/juh. Pure.
 * @returns {[number, number, number]}
 */
export function shadePixel(nx, ny, nz, light, { amp = 1, flipY = false, gamma = 0.8, palette = KARTA_PALETTE } = {}) {
  let x = nx * amp;
  let y = (flipY ? -ny : ny) * amp;
  let z = nz;
  const len = Math.hypot(x, y, z) || 1;
  x /= len; y /= len; z /= len;
  const s = Math.max(0, x * light[0] + y * light[1] + z * light[2]);
  const flat = light[2]; // tieň roviny (normála [0,0,1])
  let t = s >= flat ? (s - flat) / (1 - flat) : (s - flat) / flat; // −1..1
  t = Math.sign(t) * Math.pow(Math.abs(t), gamma);
  return t >= 0 ? lerp3(palette.mid, palette.lit, t) : lerp3(palette.mid, palette.shadow, -t);
}

/**
 * Tieňuje RGBA dáta normal dlaždice na mieste (RGB = normála 0..255, alfa sa zahodí).
 * @param {Uint8ClampedArray} data
 * @param {object} [opts] azimuth, altitude, amp, flipY, gamma, palette
 * @returns {Uint8ClampedArray} tie isté dáta
 */
export function shadeNormals(data, opts = {}) {
  const o = { ...HILLSHADE_DEFAULTS, ...opts };
  const light = lightVector(o.azimuth, o.altitude);
  const shadeOpts = { amp: o.amp, flipY: o.flipY, gamma: o.gamma, palette: o.palette || KARTA_PALETTE };
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = shadePixel((data[i] / 255) * 2 - 1, (data[i + 1] / 255) * 2 - 1, (data[i + 2] / 255) * 2 - 1, light, shadeOpts);
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return data;
}

/**
 * Normal dlaždica (obrázok) → tieňované plátno. Pred tieňovaním sa normály
 * vyhladia rozmazaním; okraje sa predtým „natiahnu" do lemu (`margin`), aby
 * rozmazanie na hrane dlaždice nemiešalo priehľadnú čiernu — inak by mal
 * každý štvorec tmavý šev.
 * @param {CanvasImageSource} image
 * @param {object} [opts] ako shadeNormals + smooth, tileSize, margin, createCanvas
 * @returns {HTMLCanvasElement}
 */
export function shadeNormalTile(image, opts = {}) {
  const o = { ...HILLSHADE_DEFAULTS, ...opts };
  const createCanvas = o.createCanvas || ((w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; });
  const size = o.tileSize;
  const m = o.smooth > 0 ? o.margin : 0;
  const work = createCanvas(size + 2 * m, size + 2 * m);
  const g = work.getContext('2d', { willReadFrequently: true });
  if (m > 0) {
    // lem: krajné riadky/stĺpce natiahnuté von (clamp), rohy z rohových pixelov
    g.drawImage(image, 0, 0, 1, size, 0, m, m, size);
    g.drawImage(image, size - 1, 0, 1, size, size + m, m, m, size);
    g.drawImage(image, 0, 0, size, 1, m, 0, size, m);
    g.drawImage(image, 0, size - 1, size, 1, m, size + m, size, m);
    g.drawImage(image, 0, 0, 1, 1, 0, 0, m, m);
    g.drawImage(image, size - 1, 0, 1, 1, size + m, 0, m, m);
    g.drawImage(image, 0, size - 1, 1, 1, 0, size + m, m, m);
    g.drawImage(image, size - 1, size - 1, 1, 1, size + m, size + m, m, m);
  }
  g.drawImage(image, m, m, size, size);
  const out = createCanvas(size, size);
  const og = out.getContext('2d', { willReadFrequently: true });
  if (o.smooth > 0 && 'filter' in og) og.filter = `blur(${o.smooth}px)`;
  og.drawImage(work, -m, -m);
  og.filter = 'none';
  const id = og.getImageData(0, 0, size, size);
  shadeNormals(id.data, o);
  og.putImageData(id, 0, 0);
  return out;
}

/** URL dlaždice zo šablóny `{z}/{x}/{y}` (aj `{level}`). Pure. */
export function reliefTileUrl(template, x, y, level) {
  return String(template).replace('{z}', String(level)).replace('{level}', String(level)).replace('{x}', String(x)).replace('{y}', String(y));
}

/**
 * Cesium ImageryProvider: Web Mercator dlaždice 256 px, každá po stiahnutí
 * tieňovaná na plátne. Vracia obyčajné (nepreklopené) plátno — Cesium ho pri
 * nahrávaní textúry otočí sám, ako pri GridImageryProvider.
 */
export class HillshadeImageryProvider {
  /**
   * @param {object} o
   * @param {string} o.url šablóna `{z}/{x}/{y}`
   * @param {string} [o.credit] text kreditu (povinná atribúcia zdrojov DEM)
   * @param {number} [o.maximumLevel=15]
   * @param {number} [o.minimumLevel=0]
   * @param {object} [o.shading] azimuth, altitude, amp, smooth, flipY, gamma, palette
   * @param {(resource: Cesium.Resource) => Promise<CanvasImageSource>|undefined} [o.fetchImage] injekcia (testy)
   * @param {(w: number, h: number) => HTMLCanvasElement} [o.createCanvas] injekcia (testy)
   */
  constructor({ url, credit = '', maximumLevel = 15, minimumLevel = 0, tileSize = 256, shading = {}, fetchImage = null, createCanvas = null } = {}) {
    if (!url) throw new Error('HillshadeImageryProvider: url is required');
    this._url = url;
    this._tilingScheme = new Cesium.WebMercatorTilingScheme();
    this._tileSize = tileSize;
    this._maximumLevel = maximumLevel;
    this._minimumLevel = minimumLevel;
    this._credit = credit ? new Cesium.Credit(credit) : undefined;
    this._errorEvent = new Cesium.Event();
    this._shading = { ...HILLSHADE_DEFAULTS, ...shading, tileSize };
    // preferImageBitmap: false → HTMLImageElement v pôvodnej orientácii (ImageBitmap by Cesium preklopil).
    this._fetchImage = fetchImage || ((resource) => resource.fetchImage({ preferImageBitmap: false, preferBlob: false }));
    this._createCanvas = createCanvas;
    this._ready = true;
    this._readyPromise = Promise.resolve(true);
  }

  get url() { return this._url; }
  get tilingScheme() { return this._tilingScheme; }
  get rectangle() { return this._tilingScheme.rectangle; }
  get tileWidth() { return this._tileSize; }
  get tileHeight() { return this._tileSize; }
  get maximumLevel() { return this._maximumLevel; }
  get minimumLevel() { return this._minimumLevel; }
  get tileDiscardPolicy() { return undefined; }
  get errorEvent() { return this._errorEvent; }
  get credit() { return this._credit; }
  get proxy() { return undefined; }
  get hasAlphaChannel() { return false; }
  get ready() { return this._ready; }
  get readyPromise() { return this._readyPromise; }
  get shading() { return { ...this._shading }; }

  /** Zmena tieňovania za behu (ladenie); už načítané textúry sa neprepočítajú. */
  setShading(patch) { Object.assign(this._shading, patch || {}); }

  getTileCredits() { return undefined; }
  pickFeatures() { return undefined; }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} level
   * @param {Cesium.Request} [request]
   * @returns {Promise<HTMLCanvasElement>|undefined} undefined = zaradené do fronty RequestScheduleru
   */
  requestImage(x, y, level, request) {
    const url = reliefTileUrl(this._url, x, y, level);
    const resource = new Cesium.Resource({ url, request });
    const promise = this._fetchImage(resource);
    if (!promise) return undefined;
    return promise.then((image) => (image ? shadeNormalTile(image, { ...this._shading, createCanvas: this._createCanvas || undefined }) : image));
  }
}

/** Továreň pre map stack (mapStackController: kind 'hillshade'). */
export function createHillshadeImageryProvider(options) {
  return new HillshadeImageryProvider(options);
}
