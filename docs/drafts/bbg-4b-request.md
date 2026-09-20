# Etapa 4B — žiadosť Black Bird Group (pripravené na odoslanie)

**Stav:** pripravené 2026-09-20, ČAKÁ NA ODOSLANIE POUŽÍVATEĽOM. Ja e-mail neodosielam.
**Komu:** contact@blackbirdgroup.fi
**Prečo:** BBG frontová mapa = odhadovaná kontrola územia (UA / RU / sivá zóna), OSINT, nie
taktické polohy — sedí do etickej čiary OKO. Nemajú verejné API ani otvorenú licenciu, ale na
stránke píšu, že radi spolupracujú na neziskových a verejných adaptáciách. Dáta možno idú aj cez
ACLED (metodika je na acleddata.com), ALE ACLED podmienky zakazujú sprístupniť surové dáta ďalším
používateľom → pre verejný portál riziko, preto ideme priamo cez BBG.
**Po odpovedi:** ak súhlas + strojový formát (najlepšie GeoJSON), vrstva sa postaví ako DeepState
(polygóny okupované/UA/sivá zóna) a využije hotové vykresľovanie zón z K3 + časovú os. Ak nie,
4B ostáva zatvorená, kontrola len z Wikipédie/DeepState.

---

## E-mail (EN)

**Subject:** Permission to use your Ukraine frontline map in a non-commercial public project (OKO)

Hello Black Bird Group,

I'm Vladimír Uhrin, a solo hobby developer from Slovakia. I run a non-commercial, public
3D-globe project called OKO (https://oko.uhrin.digital) that visualizes open geospatial data —
weather, earthquakes, shipping, aviation, energy infrastructure, and the war in Ukraine. It is a
personal hobby tied to my Facebook page, not a business.

Your website says you are happy to cooperate with research institutions and media on non-profit,
public-facing adaptations of your frontline map, so I would like to ask about using it.

What I would like to show: your assessed control of terrain (Ukrainian control, Russian control,
and the grey zone) as one optional layer on the globe, with your attribution and a link/logo,
clearly labeled as your assessment together with its date. I would model only areas of control —
never unit positions or tactical detail — in line with your methodology and my project's ethics.

How I would handle it technically: access through a server-side proxy with caching and rate
limiting (no key exposed in the browser), my own rendering and symbology, and the source and its
freshness always visible in the UI.

Could you tell me:
1. Whether such non-commercial public use is OK, and any attribution wording you require.
2. Whether the frontline data is available in a machine-readable form (e.g. GeoJSON) and how —
   directly from you or via ACLED.
3. Your preferred update cadence.

Full transparency: I build OKO with the help of an AI coding assistant; I review and take
responsibility for everything it produces.

Thank you very much for your work and for considering this.

Vladimír Uhrin
vladouh76@gmail.com
https://www.facebook.com/profile.php?id=100074027476766
