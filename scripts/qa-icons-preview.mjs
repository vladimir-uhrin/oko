// OKO — QA náhľad ikon lietadiel: vygeneruje public/qa-icons-preview.html
// so všetkými triedami na svetlom aj tmavom podklade v 96/48/20 px.
// Spusti, otvor http://localhost:4173/qa-icons-preview.html, potom súbor
// zmaž (do gitu ani do buildu nepatrí):
//   node scripts/qa-icons-preview.mjs
import fs from 'node:fs';
import { aircraftIcon } from '../src/data/aircraftIcons.js';

const kinds = ['airliner', 'widebody', 'quadjet', 'turboprop', 'light',
  'glider', 'helicopter', 'fastjet', 'bizjet', 'uav', 'tr3b', 'tr3bHot'];
const cell = (k) => {
  const uri = aircraftIcon(k);
  return `<td style="text-align:center;padding:8px"><div style="font:11px monospace;color:#9ab">${k}</div>`
    + `<img src="${uri}" width="96" height="96" style="background:#f2efe9;border:1px solid #445">`
    + `<img src="${uri}" width="96" height="96" style="background:#101820;border:1px solid #445;margin-left:4px">`
    + `<br><img src="${uri}" width="20" height="20" style="background:#f2efe9"> `
    + `<img src="${uri}" width="20" height="20" style="background:#101820"> `
    + `<img src="${uri}" width="48" height="48" style="background:#f2efe9"></td>`;
};
let rows = '';
for (let i = 0; i < kinds.length; i += 4) rows += `<tr>${kinds.slice(i, i + 4).map(cell).join('')}</tr>`;
fs.writeFileSync('public/qa-icons-preview.html',
  `<meta charset=utf-8><body style="background:#1a2230;font-family:monospace"><table>${rows}</table>`);
console.log('public/qa-icons-preview.html hotový');
