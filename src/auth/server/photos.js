import sharp from 'sharp';
import { PHOTO_MAX_BYTES, PHOTO_TYPES } from '../photoPolicy.js';

const fail = (code, status = 400) => Object.assign(new Error(code), { status });
let uploads = 0;

function readPhoto(req) {
  if (!PHOTO_TYPES.includes(req.headers['content-type']) || req.headers['content-encoding']) { req.resume(); throw fail('photo_format', 415); }
  if (Number(req.headers['content-length']) > PHOTO_MAX_BYTES) { req.resume(); throw fail('photo_size', 413); }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const cleanup = () => { clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', error); req.off('aborted', error); };
    const stop = err => { cleanup(); chunks.length = 0; req.resume(); reject(err); };
    const timer = setTimeout(() => stop(fail('request_timeout', 408)), 10000);
    const error = () => stop(fail('photo_invalid'));
    const data = chunk => { size += chunk.length; if (size > PHOTO_MAX_BYTES) stop(fail('photo_size', 413)); else chunks.push(chunk); };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    req.on('data', data); req.on('end', end); req.on('error', error); req.on('aborted', error);
  });
}

export async function encodePhoto(bytes, type) {
  // Reject SVG/other parsers before decoding; neither filenames nor MIME alone
  // determine the accepted format. Persist only freshly encoded raster pixels.
  const format = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'jpeg'
    : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
      : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
  if (!format || type !== `image/${format}`) throw fail('photo_format', 415);
  // libvips may expose only the first frame of APNG. Refuse its animation
  // control chunk explicitly instead of silently changing an animated avatar.
  if (format === 'png') for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL') throw fail('photo_invalid');
    offset += length + 12;
  }
  let pipeline;
  try {
    pipeline = sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'warning' });
    const meta = await pipeline.metadata();
    if (meta.format !== format || (meta.pages || 1) !== 1) throw fail('photo_invalid');
    // No withMetadata/keepMetadata: EXIF, GPS, XMP and original filename are dropped.
    const result = await pipeline.rotate().resize(256, 256, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82, effort: 3 }).timeout({ seconds: 5 }).toBuffer();
    if (result.length > 256 * 1024) throw fail('photo_invalid');
    return result;
  } catch { throw fail('photo_invalid'); }
  finally { pipeline?.destroy(); }
}

export async function receivePhoto(req) {
  // Bound both upload buffers and native decoders, with no unbounded work queue.
  if (uploads >= 2) throw fail('photo_busy', 503);
  uploads++;
  try { return await encodePhoto(await readPhoto(req), req.headers['content-type']); }
  finally { uploads--; }
}
