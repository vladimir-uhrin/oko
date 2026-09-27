# OKO — účty a profily

Vanilla JavaScript + existujúci Vite middleware + SQLite (`node:sqlite`).
Žiadny nový framework ani npm balíček. Účet je voliteľný: glóbus, vrstvy,
zdieľanie a existujúce API zostávajú verejné. Prihlásenie chráni iba vlastný
profil. Vytvorenie účtu neudeľuje platené oprávnenia.

## Spustenie

1. Použi Node **24.14+ v rade 24** alebo **26.x**, podľa `package.json`.
2. Nainštaluj existujúce závislosti: `npm install` (v pripravenom checkoute netreba).
3. Spusti `npm run dev -- --host localhost --port 4173`.
4. Otvor `/account.html` alebo klikni na kruhové tlačidlo účtu (silueta osoby,
   posledná ikona v skupine akcií glóbusu hore v strede) → Registrácia. Vyplň meno,
   e-mail, heslo (15–128 znakov; merač sily hesla pomáha) a potvrdenie hesla.
   Po registrácii si prihlásený.
5. Po prihlásení kruh ukazuje avatar (symbol alebo fotku) so zelenou bodkou; meno
   a stav **Prihlásený** ostávajú v DOM pre čítačky obrazovky (vizuálne skryté).
   Klik otvorí **ponuku účtu** (Prehľad, Profil, Zabezpečenie, Zariadenia, Aktivita,
   Odhlásiť sa) — šípky, Home/End, Escape (vráti fokus), klik mimo. Položka otvorí
   centrum účtu na danej stránke. Centrum ukladá meno, bio, vlastnú fotku a
   symbol/farbu avatara; umožňuje zmeniť heslo, odhlásiť inú reláciu alebo všetky
   ostatné a stiahnuť vlastné údaje v JSON.

Samostatná stránka účtu nepoužíva Cesium ani mapové API. Priamy prístup:
`http://localhost:4173/account.html`. Na glóbuse je launcher súčasťou skupiny
`#top-center-actions` (2026-09-26, vlastník: „daj to na lepšie miesto, kde to
nezavadzá" — predtým 200 px pilulka nad mapou), takže sa schová spolu s ňou
v čistom UI, kokpite, prehrávaní scény, pri nahrávaní a v čistej KARTE; na mobile
je skupina tesnejšia (5 kruhov vedľa SK · EN pri 375 px) a pod 375 px ide launcher
pod prepínač jazyka. Prihlasovací dialóg má na širokých obrazovkách stĺpec „prečo
účet" (len to, čo existuje), inline chyby pri poliach, upozornenie na Caps Lock,
merač sily hesla pri registrácii/obnove/zmene hesla, spinner na tlačidle a odkaz
„Pokračovať bez účtu". Slovenské texty účtu vykajú. Stav relácie sa kontroluje
pri návrate do okna, po zmene v inej karte a každých 30 s na viditeľnej stránke.
Výpadok backendu zobrazuje **Stav neoverený**, nie falošné potvrdenie prihlásenia.

SQLite vzniká až pri prvom auth requeste v `.auth-data/accounts.sqlite`.
Účty aj sessions prežijú reštart servera. Databáza je mimo `public`/`dist`,
gitignored a blokovaná vo Vite vrátane `?raw`, `/@fs` a WAL/SHM súborov.
Nie je to cache: nemaž ju pri čistení `.gev-cache`.

### Lokálny účet vlastníka

```sh
node scripts/create-owner.mjs owner@oko.test "OKO Owner"
```

Spusti iba na dôveryhodnom serveri/počítači s prístupom k databáze. Skript pred
zmenou existujúcej DB vytvorí konzistentnú SQLite zálohu v rovnakom adresári,
vygeneruje 32-znakové náhodné heslo a vypíše ho iba pri vytvorení. Ulož ho do
správcu hesiel; neposielaj výstup do verejných logov. Do DB sa ukladá iba scrypt
hash. Existujúci e-mail ani existujúci owner sa neprepisuje; opakované spustenie
skončí chybou. `owner@oko.test` je lokálny prihlasovací identifikátor, nie schránka.

Rolu `owner` prideľuje iba tento serverový postup. Verejná registrácia vždy
vytvára `member`, úprava profilu rolu nemení. Vlastník vidí označenie v profile;
rola zatiaľ neaktivuje platené funkcie a glóbus zostáva verejný. Migrácia DB v2
pridáva rolu `member` starším účtom bez zmeny hesiel alebo sessions. DB v4 pridáva
profilové polia, náhodné verejné ID relácií, verziu prihlasovacích údajov,
jednorazové tokeny, čakajúce doručenia a bezpečnostné udalosti. Existujúce účty a heslá zachováva.

Pre verejný HTTPS host nastav na serveri v `.env`:

```dotenv
AUTH_ORIGINS=https://oko.uhrin.digital
# Voliteľná cesta k trvalému súboru, nikdy do public/ alebo dist/:
AUTH_DB_PATH=.auth-data/accounts.sqlite
```

Po zmene konfigurácie reštartuj backend. `AUTH_ORIGINS` je zoznam presných
originov oddelených čiarkou, bez koncového `/`. HTTP funguje iba na loopbacku.
Lokálne originy sa rozpoznajú automaticky; neznámy verejný host dostane 403
iba na auth/profile endpointoch. Glóbus sa ďalej načíta.

Existujúci tunel už smeruje `/api/*` na Vite backend a statické súbory na
`scripts/oko-static-server.mjs`. Nové endpointy používajú rovnaké smerovanie.
Nasadzuj frontend aj backend spolu. Samotný statický hosting účty neobslúži.
Na CDN nesmie byť pravidlo, ktoré ignoruje `Cache-Control: no-store` pre
`/api/auth/*`, `/api/account`, `/api/account/*` alebo `/account.html`; pre tieto cesty vypni cache.

Ak je jedinou cestou k backendu lokálny **cloudflared**, ktorý prepisuje
`CF-Connecting-IP`, môžeš zapnúť `AUTH_TRUST_CLOUDFLARE_PROXY=true`.
Inak ho nechaj vypnuté: počíta sa adresa socketu a `X-Forwarded-For` sa ignoruje.
Za proxy bez tohto nastavenia zdieľajú návštevníci IP limit.

### Overovanie e-mailu, zmena adresy a zabudnuté heslo

Tieto toky sú implementované, ale odosielanie nie je zapnuté bez konfigurácie
dôveryhodného serverového mail endpointu. `/api/auth/session` vracia `capabilities`;
UI podľa nich zobrazuje dostupnosť a vysvetlenie, nie predstierané odoslanie.

```dotenv
AUTH_PUBLIC_URL=https://oko.uhrin.digital
# Presný HTTPS endpoint tvojej mail služby/gateway; nie URL z browser požiadavky:
AUTH_MAIL_ENDPOINT=https://mail.example.com/send
AUTH_MAIL_FROM=accounts@example.com
AUTH_MAIL_TOKEN=server-only-secret
```

Endpoint prijíma `POST` s `Authorization: Bearer …` a JSON `{from,to,subject,text}`.
Odpoveď 2xx znamená prijatie; presmerovania sa odmietajú, timeout je 10 s.
`AUTH_PUBLIC_URL` musí byť HTTPS origin zahrnutý v `AUTH_ORIGINS`. Tajomstvá nikdy
nepatria do `VITE_*`, klienta ani repozitára. Pred zapojením plateného providera
treba schváliť službu a náklady; pri vývoji sa žiadne správy neposielali.

Odkaz vedie na `/account.html#action=verify|reset|email&token=…`. Fragment sa
odstráni z aktuálneho záznamu histórie a token zostane len v pamäti. Mutáciu
spustí až výslovné potvrdenie vo formulári, nie otvorenie linku/skener pošty.
Stránka nemá mapové/analytické skripty, má `no-referrer`, `no-store` a zákaz
vloženia do iframe. V DB je iba hash tokenu. Overenie platí 24 h, reset/zmena
adresy 30 min; token je jednorazový. Nový nahradí predchádzajúci rovnakého účelu
až po úspešnom odoslaní; neúspešný resend nezruší už doručený odkaz. Recovery
odpoveď nečaká na mailovú službu, aby jej latencia neprezrádzala existenciu účtu.
Naraz môže čakať najviac 20 recovery odoslaní; pri reštarte treba nedoručenú
žiadosť zopakovať (nejde o plnohodnotnú externú trvalú poštovú frontu).
Reset zruší všetky relácie a neprihlasuje automaticky. Zmena e-mailu vyžaduje
aktuálne heslo; pôvodná adresa platí až do potvrdenia novej a potom sa relácie zrušia.

`owner@oko.test` nemá schránku. Na skutočné overovanie a obnovu ho po zapojení
mail služby zmeň cez účet na vlastnú reálnu adresu. Nikdy ho neoznačujeme ako overený
iba preto, že má rolu vlastníka.

## Súbory

```text
src/auth/
  validation.js          spoločná validácia; server ju vždy zopakuje
  follows.js             sledované lety: kľúč letu/stroja, validácia (server aj glóbus)
  client.js              in-memory stav a same-origin fetch
  panel.js               registrácia / prihlásenie / editácia profilu (DOM)
  panel.css              tmavý OKO panel, cyan akcent, mobilné rozloženie
  strings.js             nové reťazce zlúčené do existujúcich SK/EN slovníkov
  accountPage.js/css      samostatná stránka účtu a potvrdenia e-mailových odkazov
  client.test.mjs         stale-response a session-state testy
  server/
    passwords.js         async scrypt, náhodná soľ, timingSafeEqual
    store.js             modely users/sessions/auth_limits, viazané SQL parametre
    http.js              controllery + requireAuthenticated middleware
    plugin.js            zapojenie do dev/preview, ochrana DB súborov
    mail.js              konfigurovateľný serverový HTTPS mail adaptér
    auth.test.mjs        HTTP bezpečnostné a integračné testy
    plugin.test.mjs      test skutočného Vite middleware
scripts/qa-auth.mjs       izolovaný browser test bez kľúčov a mapových API
```

Integrácia: `vite.config.js` registruje `authPlugin(env)`; `src/main.js`
inicializuje `initAuthPanel()`. Existujúca SK/EN lokalizácia zostáva v
`src/i18nStrings.js`. Panel je natívny `<dialog>` s fokusom, Escape a stavmi
načítavania, úspechu, chyby a nedostupnosti backendu.

## Tok a endpointy

| Endpoint | Metóda | Výsledok / ochrana |
| --- | --- | --- |
| `/api/auth/session` | GET | Profil alebo `user: null`, nikdy nevytvára session |
| `/api/auth/csrf` | GET | Krátka anonymná session + CSRF token; limitované |
| `/api/auth/register` | POST | Validácia, hash, profil, nová prihlásená session |
| `/api/auth/login` | POST | Overenie hesla, rotácia session |
| `/api/auth/logout` | POST | Vymazanie session v DB aj cookie |
| `/api/account` | GET | Vlastný profil, vyžaduje prihlásenie |
| `/api/account` | PATCH | Povolené polia `displayName`, `bio`, `avatar`, `avatarColor` |
| `/api/account/password` | POST | `{currentPassword,newPassword}`, rotácia + odhlásenie ostatných |
| `/api/account/security` | GET | Iba vlastné aktívne relácie a posledné udalosti |
| `/api/account/sessions/revoke` | POST | `{id}` verejné ID vlastnej relácie, nikdy token/hash |
| `/api/account/sessions/revoke-others` | POST | Odhlási ostatné relácie, ponechá aktuálnu |
| `/api/account/export` | GET | Vlastný profil, relácie, udalosti a sledované lety; žiadne tajomstvá |
| `/api/account/follows` | GET | Vlastné sledované lety `{follows, max}` (najviac 50) |
| `/api/account/follows` | POST | `{hex?, callsign?, label?}` — let dopravcu podľa volacieho znaku, inak stroj podľa hexu; 409 `follow_limit` |
| `/api/account/follows` | DELETE | `{key}` (`cs:AUA40H` / `hex:44003a`) — odoberie iba z vlastného zoznamu |
| `/api/account/verification` | POST | Pošle jednorazový overovací odkaz |
| `/api/account/email` | POST | `{email,currentPassword}`, pošle potvrdenie na novú adresu |
| `/api/auth/forgot-password` | POST | `{email}`, generická odpoveď bez odhalenia účtu |
| `/api/auth/reset-password` | POST | `{token,password}`, jednorazová obnova bez auto-loginu |
| `/api/auth/verify-email` | POST | `{token}`, potvrdí vlastníctvo schránky |
| `/api/auth/confirm-email` | POST | `{token}`, dokončí zmenu e-mailu |

Všetky zápisové operácie vyžadujú `application/json`, presný `Origin` a
hlavičku `X-CSRF-Token` naviazanú na platnú session. CSRF platí aj pre login
a registráciu. Nepovoľujeme cross-origin CORS. Každá auth odpoveď je `no-store`.

`GET /session` pasívnemu návštevníkovi neukladá cookie. Pred prvým zápisom
klient získa CSRF cez `/csrf`. Registrácia aj login nahradia starú session
novým 256-bit identifikátorom; predchádzajúca cookie už neplatí.

V prehliadači je identifikátor iba v `HttpOnly; SameSite=Lax; Path=/` cookie.
HTTPS používa `__Host-oko_session; Secure` bez `Domain`. Lokálny HTTP vývoj
používa `oko_session`. V DB sa ukladá iba SHA-256 hash identifikátora.
CSRF token sa odvodzuje iným prefixom a drží sa iba v pamäti klienta.
Session trvá najviac 7 dní, vyprší po 24 h bez auth aktivity (vrátane kontroly stavu na otvorenej stránke); anonymná po
20 minútach. Najviac päť prihlásených sessions na účet. Logout ruší aktuálnu
session; ostatné karty ju synchronizujú cez BroadcastChannel a kontrolu pri
návrate do okna. Odhlásenie jednej session neodhlasuje iné zariadenia.

Zmena hesla vyžaduje aktuálne heslo, zmení verziu prihlasovacích údajov, rotuje
aktuálnu session a ruší ostatné sessions aj čakajúce jednorazové tokeny v jednej
transakcii. Aj súbežný login po scrypt overení opätovne kontroluje verziu hesla,
aby staré heslo po zmene/resetovaní nevytvorilo platnú reláciu. Úprava profilu ani
žiadny verejný request nesmie meniť rolu alebo overenie e-mailu.

Zariadenia používajú len orientačný názov prehliadača/platformy, nie fingerprint
alebo IP polohu. Aktivita uchováva najviac 100 úspešných udalostí za 90 dní,
nie pohyb používateľa na glóbuse. Pred uplatnením vo verejnej službe doplň
zodpovedajúce pravidlá ochrany súkromia a prevádzkové procesy.

## Ukážky existujúcej implementácie

Backend model používa parametre, nie interpoláciu používateľských hodnôt:

```js
db.prepare('UPDATE users SET display_name = ? WHERE id = ?')
  .run(displayName, userId);
```

Heslo sa nemení trimovaním ani normalizáciou. Náhodná 16-bajtová soľ,
64-bajtový odvodený kľúč, `scrypt` s `N=131072, r=8, p=1` a stropom pamäte.
Formát v DB obsahuje algoritmus a parametre; overovanie prijíma iba podporovaný
formát. Najviac dve derivácie súbežne, ďalšia dostane 503 + Retry-After.
Neexistujúci účet vykoná dummy scrypt a login používa rovnakú chybu pre
nesprávne heslo aj neznámy e-mail.

```js
const passwordHash = await hashPassword(body.password);
const user = store.createUser(email, body.displayName.trim(), passwordHash, now);
// Pri prihlásení:
const valid = await verifyPassword(body.password, user?.password_hash);
```

Frontend stav možno používať bez frameworku:

```js
const auth = createAuthClient();
auth.subscribe(({ user, busy, error }) => {
  nameElement.textContent = user?.displayName || '';
  saveButton.disabled = busy || !user;
});
await auth.refresh();
await auth.register({ displayName, email, password });
await auth.updateProfile(newDisplayName);
await auth.logout();
```

Panel používa `textContent` a DOM API aj pre mená a chyby; profil nevkladá do
`innerHTML`. Heslá a session tokeny sa nedávajú do localStorage, URL či logov.
Po odoslaní formulára alebo zatvorení panelu sa polia hesiel vyčistia.
Zobrazený profil nikdy nevyberá používateľské ID z tela požiadavky.

## Budúce platené funkcie — zatiaľ nezapojené

`createAuthService()` vracia `requireAuthenticated(req, res, next)`. V budúcom
serverovom handleri použi **tú istú inštanciu služby** ako auth endpointy:

```js
auth.requireAuthenticated(req, res, () => {
  // req.auth.user.id je identita overená session.
  // Až sem patrí kontrola predplatného v serverovej DB a potom platená operácia.
  // Prihlásenie samo osebe nie je nárok na platenú službu.
});
```

Pre GET overí session; pre zápis aj Origin a CSRF. Frontend môže na chránenom
view skontrolovať `auth.getState().user` a otvoriť prihlasovací panel. Táto UI
kontrola je len navigácia — oprávnenie vždy rozhodne server. Aktuálne
chránený view je profil v paneli, nie glóbus alebo jeho URL.

Sledované lety (2026-09-27, `src/followedFlights.js`): tlačidlo SLEDOVAŤ nad KOKPIT
pri sledovanom lietadle. Host po kliku dostane panel s vetou prečo
(`open(null, { reason: 'follow.login-reason' })`); vybraný let sa po prihlásení do
10 minút pridá sám a panel sa zavrie. Zoznam je na serveri (`followed_flights`,
aditívna tabuľka bez zvýšenia `user_version`), v „Hľadať čokoľvek" je navrchu
skupina Sledované lety; stav (vo vzduchu / na zemi / nie je v živých dátach) je
len z toho, čo práve tečie vo feede — nič sa nedopytuje navyše.

## Nahranie vlastného avatara

Na `/account.html` otvor **Upraviť profil → Vybrať fotku → Uložiť fotku**.
Náhľad ešte nič nenahráva. Fotka sa zobrazí aj v tlačidle účtu pri mene;
odstránenie obnoví zvolený symbol a farbu. Podporované sú JPG/PNG/WebP do
5 MiB a 16 megapixelov, automatický stredový orez na 256 × 256 px.

`PUT /api/account/photo` prijíma binárny obrázok s jeho `Content-Type` a
`X-CSRF-Token`. `GET` vracia iba fotku aktuálne prihláseného účtu;
`DELETE` s JSON `{}` ju odstráni. Nie sú tu verejné URL cudzích avatarov ani
používateľom zadané cesty. Všetky zápisy kontrolujú session, Origin a CSRF,
vrátane opätovnej kontroly po asynchrónnom spracovaní. Limit: 15 zmien na účet
a 150 celkovo za 15 minút, najviac 2 súbežné uploady/dekodéry, 10 s na príjem.

Serverový `sharp` (už existujúca závislosť projektu; inštaluj aj devDependencies
potrebné pre Vite backend) overí signatúru a dekóduje raster, odmietne animáciu,
zmenší a znovu zakóduje WebP bez pôvodných metadát. Originál a názov súboru sa
neukladajú. Schéma v5 pridáva súkromný BLOB a verziu fotky; migrácia zachováva
účty, heslá a relácie. Odpoveď má `private, no-store`, `nosniff` a same-origin
CORP. CSP povoľuje `blob:` iba pre obrázkový náhľad; objektové URL sa uvoľňujú.
Správanie dekódera: [Sharp input limits](https://sharp.pixelplumbing.com/api-constructor/)
a [metadata/output](https://sharp.pixelplumbing.com/api-output/).

## Overenie a prevádzka

```sh
node --test src/auth/server/*.test.mjs src/auth/client.test.mjs src/i18n.test.mjs
node scripts/qa-auth.mjs
# Alternatívny už nainštalovaný Chromium headless shell:
node scripts/qa-auth.mjs --headless-shell
npm test
npm run build -- --outDir output/auth-build
```

QA vytvára vlastnú dočasnú DB, blokuje externé browser požiadavky a nespúšťa
Cesium. Snímky sú v `output/auth-qa/`. Nepoužíva produkčné účty ani `.env`.
Build do `output/auth-build` nemení servírovaný `dist`.

Na Windows môže Node vystaviť systémový `navigator.language=sk-SK`, hoci
existujúce textové unit testy očakávajú prostredie bez browser navigátora.
Reprodukovateľné spustenie suite v PowerShelli:

```powershell
$env:NODE_OPTIONS = '--no-experimental-global-navigator'
npm test
```

Pôvodné overenie základného auth toku 2026-09-25: 25 cielených auth/i18n testov, skutočný Vite integračný
test, build a celý offline browser tok prešli. Browser gate zahŕňa registráciu,
nesprávne heslo, obnovu session, editáciu profilu, inertný HTML vstup, HttpOnly
cookie, odhlásenie v dvoch kartách, mobile/Escape a výpadok backendu.
V celej suite prešlo 3 896 bežných testov aj samostatný focus allocation test.
Tri existujúce `worldOverlayAllocation` profily prekročili pamäťové rozpočty
(147 034 / 132 000, 151 641 / 142 000 a 188 459 / 182 000 B/frame).
Kontrolný beh s pôvodným `HEAD:src/i18nStrings.js` namiesto rozšíreného slovníka
a so zákazom importu auth modulov zopakoval tie isté tri zlyhania
(147 035, 151 679, 188 445 B/frame). Auth tok tieto overlay moduly nemení.
Prvý browser pokus vyčerpal pamäť pri sledovaní veľkej symlinkovanej cache;
QA fixture preto používa `watch: null` a úspešne prešla cez headless shell.

Rozšírené centrum účtu vrátane fotiek (2026-09-26): **81 auth/i18n testov** a **66 browser
kontrol** prešli. Browser overuje dva nezávislé prihlásené kontexty, nesprávne
aktuálne heslo, úspešnú zmenu a odhlásenie druhej relácie, jednotlivé/hromadné
odhlásenie, export, aktivitu, avatar/bio, nahranie/náhľad/odstránenie vlastnej fotky,
obnovu po reload, odmietnutie chybných obrázkov, XSS text, režimy kokpit/čisté UI/KARTA,
šírky 320/390/1280 px, úspešné explicitné overenie/reset bez auto-loginu a CSP samostatnej stránky. Jej CSS sa načítava externými
stylesheet linkmi, nie Vite inline injekciou, takže `style-src 'self'` zostáva
v platnosti aj pri vývoji. Finálny browser report je v
`output/auth-qa/run-uA1iTE/report.json`; žiadne externé požiadavky.
Plná bežná sada: 3 930 úspešných testov; focus gate prešiel. Rovnaké tri staršie
overlay allocation prekročenia zostávajú: 147 034/132 000, 151 641/142 000,
188 459/182 000 B/frame. Logy: `output/account-center-unit.log`,
`output/account-center-auth-tests.log`, `output/account-center-build.log`.

Limity sú perzistentné v SQLite: 10 credential pokusov/e-mail/15 min,
40/IP/15 min, 200 globálne/15 min; samostatné limity pre requesty, vytváranie
anonymných sessions a editáciu profilu. Prázdne a zlé vstupy spotrebujú IP
limit. Telá sú limitované na 8 KiB a 10 s; expirované sessions a limity sa
priebežne čistia. Nastavenie je určené pre súčasný jeden Node backend, nie
distribuovaný cluster; škálovanie vyžaduje spoločný session/limit store.

Zálohuj DB SQLite backup mechanizmom alebo po zastavení backendu (pozor na
WAL); súbor aj zálohy povoľ iba servisnému účtu cez OS ACL. Nepresúvaj ich
do verejných statických priečinkov. Mailový adaptér je pripravený, ale konkrétny
provider a doručovanie ešte nie sú nakonfigurované. MFA/passkeys, sociálne
prihlásenie, predplatné, platobná brána a mazanie účtu nie sú súčasťou tejto verzie.
Pred platenými funkciami treba zapojiť doručovanie a samostatnú kontrolu nárokov.
Profil s `emailVerified: false` nesmie slúžiť ako overená e-mailová identita.

Tok obnovy a opätovné overenie hesla vychádzajú z [OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
a [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).

Návrh hesiel zodpovedá [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
CSRF používa [session token + origin kontrolu](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html),
cookies vychádzajú z [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
Tieto ochrany sa týkajú nového auth toku; nejde o bezpečnostný audit všetkých
existujúcich vrstiev a proxy OKO.
