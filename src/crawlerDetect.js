// src/crawlerDetect.js — roboty vyhľadávačov a sietí v appke (2026-09-30, indexovanie okolive.sk).
//
// Googlebot a Bingbot si stránku naozaj vykresľujú (JavaScript aj WebGL). Jedno vykreslenie
// appky by stiahlo stovky fotorealistických dlaždíc Google cez Cesium ion; pri pravidelných
// návštevách robotov by to míňalo kvótu, ktorá patrí ľuďom (docs/drafts/seo-plan.md, riziko R1).
// Robot preto dostane tú istú appku a ten istý text, len podkladom je OSM — tá istá cesta ako
// QA ochrana `?qaBasemap=osm` v main.js. Nie je to maskovanie: obsah je rovnaký, líši sa len
// ťažké vykresľovanie.
//
// Lighthouse / PageSpeed Insights a náš puppeteer (HeadlessChrome) zámerne NIE sú na zozname —
// ich merania a zábery majú zodpovedať tomu, čo vidí človek.
const CRAWLER_PATTERN = new RegExp([
  'googlebot', 'google-inspectiontool', 'googleother', 'storebot-google', 'adsbot-google', 'mediapartners-google',
  'apis-google', 'feedfetcher-google', 'bingbot', 'bingpreview', 'adidxbot', 'msnbot', 'applebot', 'duckduckbot',
  'yandex(?:bot|images|mobilebot|accessibilitybot)', 'baiduspider', 'petalbot', 'seznambot', 'sogou', 'exabot',
  'qwantify', 'mojeekbot', 'facebookexternalhit', 'facebookcatalog', 'meta-externalagent', 'facebot', 'twitterbot',
  'linkedinbot', 'slackbot', 'discordbot', 'telegrambot', 'whatsapp', 'pinterestbot', 'redditbot', 'embedly',
  'skypeuripreview', 'ahrefsbot', 'semrushbot', 'mj12bot', 'dotbot', 'rogerbot', 'screaming frog', 'gptbot',
  'chatgpt-user', 'oai-searchbot', 'claudebot', 'claude-web', 'anthropic-ai', 'perplexitybot', 'ccbot', 'bytespider',
  'amazonbot', 'ia_archiver', 'archive\\.org_bot',
].join('|'), 'i');

/** Je to robot vyhľadávača, siete alebo AI crawler? (pure) */
export function isCrawlerUserAgent(userAgent) {
  return CRAWLER_PATTERN.test(String(userAgent || ''));
}
