# config/ca — verejné medzičlánkové certifikáty pre proxy

Tu sú len VEREJNÉ certifikáty certifikačných autorít, žiadne kľúče ani tajomstvá.
Pridávajú sa k systémovým koreňom Node (`tls.rootCertificates`) pre upstreamy,
ktoré neposielajú kompletný reťazec. Overenie ostáva prísne — nikdy
`rejectUnauthorized: false`.

## sectigo-public-server-authentication-ca-dv-r36.pem

- **Prečo:** `opendata.shmu.sk` (radar SHMÚ) posiela len koncový certifikát
  `*.shmu.sk`; medzičlánok chýba. Prehliadač a curl si ho stiahnu cez AIA URL
  z certifikátu, Node to nerobí → `UNABLE_TO_VERIFY_LEAF_SIGNATURE` a radar
  bol od 2026-09-01 STALE (zistené 2026-09-07).
- **Odkiaľ:** AIA „CA Issuers" URL z koncového certifikátu:
  `http://crt.sectigo.com/SectigoPublicServerAuthenticationCADVR36.crt`
  (DER → PEM cez `openssl x509 -inform DER`).
- **Subject:** C=GB, O=Sectigo Limited, CN=Sectigo Public Server Authentication CA DV R36
- **Issuer:** C=GB, O=Sectigo Limited, CN=Sectigo Public Server Authentication Root R46
  (koreň R46 je v Node/Mozilla store — reťazec sa uzavrie).
- **Platnosť:** 2021-03-22 → 2036-03-21
- **SHA-256 odtlačok:** 8C:54:C3:34:B6:6B:A4:E4:26:77:2A:F4:A3:F9:13:6C:19:A1:AE:C7:29:FD:B2:8C:53:5C:07:A5:A4:EF:22:E0
- **Používa:** `vite.config.js` → SHMÚ radar proxy (`fetchUpstream`, `https.Agent` s `ca`).

Keď SHMÚ opraví reťazec na serveri, súbor môže zostať — je neškodný.
