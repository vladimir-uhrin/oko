// OKO — overenie kurátorovaného katalógu živých kamier letísk (bez kľúča).
//
// YouTube ID prenosov časom umierajú (kanál skončí, stream sa reštartuje pod
// novým ID). Tento skript prejde AIRPORT_CAMERAS a pre každé ID zistí:
//   • oEmbed (https://www.youtube.com/oembed) → existuje a je embedovateľné (200),
//   • verejnú watch stránku → príznaky isLiveNow / playableInEmbed.
// Nič nesťahuje ani neprehráva. Manuálny krok, nikdy CI:
//   node scripts/check-airport-cameras.mjs
// Exit code 1, keď niektorá kamera nie je živá alebo embedovateľná — vtedy
// oprav ID v src/data/airportCameras.js a dátum `verified`.
import { AIRPORT_CAMERAS, youtubeOembedUrl, youtubeWatchUrl } from '../src/data/airportCameras.js';

const UA = 'oko-airport-cameras-check/1.0 (manual maintenance script)';
let failures = 0;
for (const [icao, cam] of Object.entries(AIRPORT_CAMERAS)) {
  const line = [`${icao} ${cam.videoId} (${cam.provider})`];
  try {
    const oe = await fetch(youtubeOembedUrl(cam.videoId), { headers: { 'User-Agent': UA } });
    line.push(`oEmbed ${oe.status}`);
    if (!oe.ok) failures++;
    const page = await fetch(youtubeWatchUrl(cam.videoId), { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en' } });
    const html = await page.text();
    const live = /"isLiveNow":true/.test(html);
    const embeddable = /"playableInEmbed":true/.test(html);
    line.push(`isLiveNow=${live}`, `playableInEmbed=${embeddable}`);
    if (!live || !embeddable) failures++;
  } catch (error) {
    failures++; line.push(`ERROR ${error?.message || error}`);
  }
  console.log(line.join(' · '));
}
console.log(failures ? `\n${failures} problém(ov) — oprav ID a dátum verified v airportCameras.js` : '\nVšetky kamery živé a embedovateľné.');
process.exit(failures ? 1 : 0);
