// src/data/fixtures/ucdpCandidateFixture.mjs — malý súbor v tvare UCDP Candidate Events
// (hlavička skutočného GEDEvent_v26_0_9.csv z 5. 11. 2026, riadky vymyslené): región aj mimo neho,
// presnosť polohy a dňa, jednostranné násilie, kód XXX a viacriadkový výňatok článku v úvodzovkách.
// Používajú ho src/data/mideastIncidents.test.mjs a scripts/lib/mideastIncidents.test.mjs.
export const UCDP_HEADER = 'id,relid,year,active_year,code_status,type_of_violence,conflict_dset_id,conflict_new_id,conflict_name,dyad_dset_id,dyad_new_id,dyad_name,side_a_dset_id,side_a_new_id,side_a,side_b_dset_id,side_b_new_id,side_b,number_of_sources,source_article,source_office,source_date,source_headline,source_original,where_prec,where_coordinates,where_description,adm_1,adm_2,latitude,longitude,geom_wkt,priogrid_gid,country,country_id,region,event_clarity,date_prec,date_start,date_end,deaths_a,deaths_b,deaths_civilians,deaths_unknown,best,high,low,gwnoa,gwnob';
const ucdpRow = ({ id, violence = 1, sideA = 'Government of Israel', sideB = 'Hamas', article = 'Report', headline = 'Airstrike reported', prec = 1, place = 'Gaza city', lat = 31.5, lon = 34.45, country = 'Israel', datePrec = 1, start = '2026-09-10', end = start, best = 3 }) =>
  [id, `ISR-${id}`, 2026, 'true', 'Check deaths', violence, '', 234, 'Israel: Palestine', 1, 1, `${sideA} - ${sideB}`, 1, 1, sideA, 2, 2, sideB, 2, `"${article}"`, 'Office', start, `"${headline}"`, '', prec, place, 'desc', 'adm1', '', lat, lon, `POINT (${lon} ${lat})`, 1, country, 666, 'Middle East', 1, datePrec, `${start} 00:00:00.000`, `${end} 00:00:00.000`, 0, 0, best, 0, best, best, best, 666, ''].join(',');
export const UCDP_CSV = [
  UCDP_HEADER,
  ucdpRow({ id: 700001, article: 'Line one of the article\nwith a second line, and a comma', headline: 'Israeli airstrike hits a house' }),
  ucdpRow({ id: 700002, country: 'Ukraine', lat: 48.5, lon: 37.9, sideA: 'Government of Russia (Soviet Union)', sideB: 'Government of Ukraine' }),
  ucdpRow({ id: 700003, prec: 4, place: 'Gaza governorate' }),
  ucdpRow({ id: 700004, datePrec: 3, start: '2026-09-11', end: '2026-09-14' }),
  ucdpRow({ id: 700005, country: 'Yemen (North Yemen)', violence: 3, sideA: 'Ansarallah', sideB: 'Civilians', headline: 'Houthi drone strike on a market', lat: 13.58, lon: 44.02, place: 'Taiz town', prec: 2, start: '2026-09-12' }),
  ucdpRow({ id: 700006, start: '2026-02-20' }),
  ucdpRow({ id: 700007, sideA: 'XXX630', sideB: 'XXX630', headline: 'Clashes', lat: 31.51787, lon: 34.43635, start: '2026-03-08' }),
].join('\r\n');
