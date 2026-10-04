// Kam sa server pýta sám seba (Štúdio, kontrola feedov, stav v admine) — 2026-10-04.
// Vite s `--host localhost` sa na Node 17+ naviaže podľa poradia z DNS — na Windows služby oko-api len na
// IPv6 `[::1]`. Natvrdo `127.0.0.1` tam skončilo ECONNREFUSED: Štúdio nevyrobilo ani jeden návrh (každý zdroj
// „source_unavailable") a kontrola feedov hlásila všetko nedostupné. Meno `localhost` Node 20+ preloží na
// všetky adresy a skúsi ich postupne (autoSelectFamily) — funguje pri ::1 aj pri 127.0.0.1.
export const LOOPBACK_HOST = 'localhost';
