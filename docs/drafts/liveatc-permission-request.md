# Návrh žiadosti o povolenie — LiveATC.net

Stav (overené 2026-09-06 priamo na https://www.liveatc.net/legal/, znenie platné
od 1. 2. 2009): **priame vloženie zvuku LiveATC do OKO je zakázané.** Pätička
každej ich stránky hovorí doslova:

> „Audio streams may not be used in any third-party products."

a Terms of Use to rozvádzajú:

- **3.3** — nesmieš „make the LiveATC.net Services available over a network
  (other than LiveATC.net's network) where it could be used by others";
- **3.4** — ani „make the LiveATC.net Services directly available via any other
  dedicated desktop or mobile commercial application, for profit or not";
- **3.15** — nesmieš „link directly to any of the audio streams without
  consulting with LiveATC.net. When you do link you agree to give credit to
  LiveATC.net with a prominent link to www.liveatc.net";
- **2.1** — licencia je „for personal non-commercial purposes only";
- **3.13** — prístup len „interactive web browser (or other authorized software
  agents, which include general purpose media players)", žiadny robot bez
  povolenia.

Bod 3.15 je jediné otvorené dvere: priamy odkaz na stream je možný **po
konzultácii s nimi** a s viditeľným kreditom. Tento text je návrh e-mailu —
odosielaš ho ty, nie OKO. Kontakt: formulár na https://www.liveatc.net/ct/contact.php
(prípadne „Press Inquiries" na tej istej stránke).

---

**Predmet:** Permission request — linking LiveATC audio in a non-commercial open-source project

Hello,

I maintain OKO, a non-commercial, open-source 3D globe that shows live aviation
and maritime data (flights, airports, weather). When a user clicks an airport,
the card shows its radio frequencies, runways and METAR.

Today the card only links to your website (a plain link to
`https://www.liveatc.net/search/?icao=XXXX` with visible "Listen live on
LiveATC" credit) — I have deliberately not embedded any audio, because your
Terms of Use state that audio streams may not be used in third-party products.

Under section 3.15 of your Terms I would like to ask whether you would consent
to something narrower:

1. a direct link to the relevant airport's audio stream, opened in the user's
   own browser/media player (not proxied, not re-encoded, not recorded, not
   stored by the project); or, if you prefer,
2. keeping the current site link only — in which case I would simply like to
   confirm that the way I credit you is acceptable to you.

The project is non-commercial and open source, has no advertising, and I would
of course display prominent credit and a link to www.liveatc.net in the exact
wording you specify. I do not intend to build a dedicated LiveATC application,
to rebroadcast, or to use any automated retrieval of your content.

If neither is acceptable, that is entirely understood and I will keep the plain
site link as it is today.

Thank you for your time and for running LiveATC.

Best regards,
[meno, kontakt, odkaz na projekt]

---

Po odpovedi: znenie súhlasu a presnú formuláciu kreditu zapísať do
`DATA_SOURCES.md`; bez odpovede sa nič nemení — ostáva odkaz na stránku.
