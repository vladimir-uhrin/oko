// Audio-only catalogue. Camera streams belong to a separate feature.
// No independently verified, embeddable audio feed has been admitted yet.
const broadcasts = Object.freeze({});

export function airportBroadcastFor(icao) {
  const code = String(icao || '').trim().toUpperCase();
  return Object.hasOwn(broadcasts, code) ? broadcasts[code] : null;
}

export function normalizeAirportStream(stream, fallbackLabel = '') {
  if (stream?.kind && stream.kind !== 'audio') return null;
  return /^https?:\/\//i.test(stream?.url || '')
    ? { url: stream.url, label: stream.label || fallbackLabel } : null;
}
