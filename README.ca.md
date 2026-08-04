<div align="center">

<img src="public/icons/icon.svg" width="96" alt="Logotip de Plein." />

# Plein.

**El dipòsit ple al preu just** — trobeu les benzineres més barates al vostre
voltant i al llarg dels vostres trajectes, a França, Espanya, Andorra i
Portugal.

[English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · **Català** · [Português](README.pt.md)

[![Obrir l'app](https://img.shields.io/badge/%E2%96%B6%EF%B8%8E%20Obrir%20l'app-plein.zadkiel.fr-3ddc84?style=for-the-badge&labelColor=0f1a14)](https://plein.zadkiel.fr)

[![Llicència MIT](https://img.shields.io/badge/llic%C3%A8ncia-MIT-3ddc84?labelColor=0f1a14)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-instal%C2%B7lable-3ddc84?labelColor=0f1a14)](#-ús)
[![Dades](https://img.shields.io/badge/dades-%F0%9F%87%AB%F0%9F%87%B7%20Fran%C3%A7a%20%C2%B7%20%F0%9F%87%AA%F0%9F%87%B8%20Espanya%20%C2%B7%20%F0%9F%87%A6%F0%9F%87%A9%20Andorra%20%C2%B7%20%F0%9F%87%B5%F0%9F%87%B9%20Portugal-blue?labelColor=0f1a14)](#-fonts-de-dades)
[![React 18](https://img.shields.io/badge/React-18-61dafb?labelColor=0f1a14&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?labelColor=0f1a14&logo=typescript)](https://www.typescriptlang.org)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900?labelColor=0f1a14)](https://leafletjs.com)

<br/>

| Els preus al vostre voltant | La fitxa d'una estació | Al vostre trajecte |
| :---: | :---: | :---: |
| <img src="docs/screenshots/map.png" width="250" alt="Mapa de preus al voltant de Tolosa" /> | <img src="docs/screenshots/station.png" width="250" alt="Fitxa d'una estació: preu per combustible, diferència amb la més barata, serveis i estalvi en un dipòsit" /> | <img src="docs/screenshots/route.png" width="250" alt="Comparació d'estacions en un trajecte Tolosa → Nantes" /> |

</div>

## ✨ Funcionalitats

- 🗺️ **Mapa de preus en directe** — les benzineres al vostre voltant amb el
  preu a la xinxeta, acolorides segons el preu: les «bones ofertes» (totes les
  estacions gairebé al millor preu, no només la primera) en verd, les més
  cares tenyides de taronja; moveu el mapa i les estacions de la zona es
  carreguen automàticament, i a les zones denses només les més barates
  conserven la bombolla de preu.
- 🇫🇷🇪🇸🇦🇩🇵🇹 **Quatre països al mateix mapa** — la font «Automàtica» combina
  els fluxos oficials de França, Espanya, Andorra i Portugal segons la zona
  mostrada: els proveïments fronterers (el Pertús, Irún, el Pas de la Casa,
  Vilar Formoso…) es comparen d'un cop d'ull.
- 📋 **Llista de la zona** — estireu el plafó inferior: totes les estacions
  visibles, ordenades per recomanació per defecte (preu o distància a un
  toc), les bones ofertes ressaltades, sincronitzades amb el mapa. L'estació
  destacada és la **millor tria real**: el combustible cremat en l'anada i
  tornada (consum i dipòsit del perfil de vehicle dels Ajustos — cotxe o
  moto) es té en compte, de manera que una estació una mica més cara però
  molt més propera pot guanyar la més barata mostrada.
- 🛣️ **Pla de proveïment del trajecte** — sortida des de «La meva posició» o
  qualsevol adreça, autocompleció, mapa del corredor i **pla de proveïment**
  segons 3 estratègies (millor compromís · preu més baix · desviament mínim):
  una parada o diverses encadenades en els viatges llargs, cadascuna amb els
  litres a comprar, el seu cost i el desviament, des del nivell del dipòsit a
  la sortida fins al combustible restant a l'arribada. Fixeu o traieu parades
  per compondre el vostre propi recorregut, eviteu autopistes o peatges, i
  els resultats arriben progressivament — primer l'itinerari, després les
  estacions, després el pla.
- ⭐ **Preferits** — fixeu les vostres estacions i consulteu-ne el preu del dia
  d'un cop d'ull; conserven el preu fins i tot a través de zones i països.
- ⛽ **Tots els combustibles** — Dièsel, SP95/98, E10, E85, GLP; filtres per
  radi, marques, tipus de distribuïdor i serveis (24 h, rentat, botiga,
  inflat, additius). El filtre **AdBlue** només apareix allà on la font
  publica la informació: els fluxos espanyol i andorrà declaren els productes
  a la venda (i el seu preu, mostrat a la fitxa), els fluxos francès i
  portuguès no en diuen res, així que les seves estacions continuen llistades
  en lloc d'amagar-se per error. Com que l'E10 gairebé no existeix fora de
  França, les estacions espanyoles, andorranes i portugueses mostren el seu
  SP95 (compatible amb E10) al mapa E10 — amb l'etiqueta «SP95 / L» per
  deixar-ho clar.
- 🕐 **Horaris reals** — «Obert 24 h», «Tancat · obre a les 6.30»… calculats a
  partir dels horaris oficials; frescor dels preus mostrada (i assenyalada
  quan es fan vells).
- 🏷️ **Marques reconegudes** — logotips i noms de les estacions
  (TotalEnergies, E.Leclerc, Intermarché… i Repsol, Cepsa, Galp, Prio a la
  banda espanyola, andorrana i portuguesa) aparellats des d'OpenStreetMap a
  França (posicions ajustades a les coordenades OSM reals), aportats
  directament pels fluxos oficials a la resta.
- 🧭 **«Com arribar-hi»** — obre el lloc a la vostra app de GPS: selector
  d'app a Android (`geo:`), Mapes a iOS, Google Maps a l'escriptori;
  recorregut multiparada possible.
- 🔗 **Enllaç compartible** — l'adreça de la pàgina segueix el mapa (zona
  mostrada, zoom, combustible, radi i filtres) i el trajecte (etapes i
  opcions): el botó *Compartir* envia un enllaç que reobre exactament la
  mateixa vista — o el mateix viatge — a qui el rep. Les fitxes d'estació
  conserven l'enllaç directe `/station/:id`.
- 🌗 **Tema clar i fosc** — l'app segueix l'ajust del vostre navegador per
  defecte i es canvia als Ajustos; el mapa base segueix el tema i el canvi es
  fa amb un fos encreuat.
- 🌍 **Cinc llengües** — francès, anglès, espanyol, català i portuguès; l'app
  segueix la llengua del vostre navegador per defecte, modificable als
  Ajustos.
- 🖥️ **La mateixa app al mòbil i al navegador** — al mòbil, el mapa a
  pantalla completa i el plafó que s'estira; en una pantalla ampla, la
  navegació passa al costat i la llista d'estacions es col·loca **al costat**
  del mapa en lloc de cobrir-lo, els filtres i les fitxes es converteixen en
  plafons, i el ratolí recupera el que li faltava (botons de zoom, hover, Esc
  per tancar). S'ha acabat el marc de telèfon al mig de la pantalla.
- 📱 **PWA instal·lable i tolerant al mode fora de línia** — afegiu-la a la
  pantalla d'inici; les últimes zones consultades i les tessel·les del mapa
  continuen disponibles sense xarxa, amb indicador d'antiguitat dels preus.

## 🚀 Ús

1. Obriu **[plein.zadkiel.fr](https://plein.zadkiel.fr)** (el desplegament oficial).
2. Autoritzeu la geolocalització — o continueu sense i cerqueu una ciutat, a
   França, Espanya, Andorra o Portugal. La cerca recorda els llocs que hi heu
   triat: els proposa tan bon punt s'obre i els puja al capdamunt dels
   suggeriments així que escriviu.
3. Trieu el combustible a la part superior del mapa: la millor tria (preu I
   distància, desviament comptat) apareix al plafó inferior, **Com
   arribar-hi** inicia el guiatge.
4. Abans d'un viatge llarg, pestanya **Trajecte**: introduïu la destinació i
   compareu les estacions al llarg del recorregut.
5. Al mòbil, instal·leu l'app (bàner d'instal·lació o
   *Ajustos → Aplicació*) per tenir-la com a icona, a pantalla completa i
   fora de línia.

Cap compte, cap rastrejador: els vostres preferits i ajustos es queden al
vostre navegador.

## 📊 Fonts de dades

Cada país cobert té els seus propis fluxos oficials — preus i geocodificació
— que l'app tria segons la zona mostrada (font *Automàtica*). La resta
(itineraris, mapes base) és comuna als quatre.

### 🇫🇷 França

| Dada | Font | Llicència |
| --- | --- | --- |
| Preus dels carburants i horaris | [Prix des carburants — flux en temps real](https://data.economie.gouv.fr/explore/dataset/prix-des-carburants-en-france-flux-instantane-v2/) (data.economie.gouv.fr) | Licence Ouverte / Open Licence |
| Marques de les estacions | [OpenStreetMap](https://www.openstreetmap.org/) (índex estàtic generat, aparellat amb les estacions per proximitat) | ODbL |
| Geocodificació i autocompleció | [Base Adresse Nationale](https://adresse.data.gouv.fr/) (api-adresse.data.gouv.fr) | Licence Ouverte / Open Licence |

### 🇪🇸 Espanya

| Dada | Font | Llicència |
| --- | --- | --- |
| Preus dels carburants, horaris i marques | [Precios de carburantes](https://geoportalgasolineras.es) (sedeaplicaciones.minetur.gob.es, MITECO) — la marca (*rótulo*) l'aporta el flux | Datos abiertos |
| Geocodificació i autocompleció | [CartoCiudad](https://www.cartociudad.es) (IGN) | CC BY 4.0 |

### 🇦🇩 Andorra

| Dada | Font | Llicència |
| --- | --- | --- |
| Preus dels carburants i marques | [Preus dels carburants](https://sig.govern.ad/IPE/PreusCarburants) (sig.govern.ad, Govern d'Andorra — Oficina de l'Energia i del Canvi Climàtic) — la marca es dedueix del nom de l'estació; el flux no porta ni adreça ni horaris | © Govern d'Andorra |
| Geocodificació i autocompleció | Nomenclàtor (nomenclàtor oficial) & LocatorIDE (sig.govern.ad, IDE Andorra) | © Govern d'Andorra |

### 🇵🇹 Portugal

| Dada | Font | Llicència |
| --- | --- | --- |
| Preus dels carburants i marques | [Preços dos combustíveis](https://precoscombustiveis.dgeg.gov.pt) (DGEG — Direção-Geral de Energia e Geologia) — la marca (*marca*) l'aporta el flux, que no dona ni horaris ni E10; cobertura continental (les Açores i Madeira tenen el seu propi règim) | Dados abertos |
| Geocodificació i autocompleció | [Photon](https://photon.komoot.io) (instància pública de Komoot, índex OpenStreetMap), limitat al Portugal continental — el país no publica cap geocodificador d'adreces sense clau | ODbL |

### Comuns als quatre països

| Dada | Font | Llicència |
| --- | --- | --- |
| Càlcul d'itineraris | [OSRM](https://project-osrm.org/) (servidor de demostració) · [Valhalla](https://valhalla.github.io/valhalla/) (servidor públic FOSSGIS) per a «evitar autopistes / peatges» | Dades © OpenStreetMap |
| Mapes base | [CARTO](https://carto.com/attributions) clar / fosc segons el tema (tessel·les d'OpenStreetMap com a recurs fora de línia) · dades © col·laboradors d'[OpenStreetMap](https://www.openstreetmap.org/copyright) | — |

L'app no té **cap backend**: el navegador consulta directament aquests
serveis públics. Les fonts són connectables (`src/data/types.ts`). Sense
connexió o amb un flux caigut, l'app conserva les últimes estacions
carregades (memòria cau per zona) amb un bàner explícit i ho torna a provar
així que torna la connexió; un joc de dades de demostració fora de línia
continua sent seleccionable als ajustos.

## 🛠️ Desenvolupament

Stack: **Vite · React 18 · TypeScript estricte · Leaflet**, sense cap altra
dependència de runtime. Desplegat a Cloudflare Workers (`wrangler`).

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # compilació de producció (dist/)
npm run e2e          # E2E Playwright: recorre totes les pantalles
npm run verify:live  # comprova els proveïdors reals (França, Espanya, Andorra, Portugal, geocodificadors, OSRM) contra els endpoints reals
npm run deploy       # build + wrangler deploy
```

Per afegir una font de dades: implementeu les interfícies
`StationsProvider` / `GeocodeProvider` / `RouteProvider` i registreu-la a
`src/data/providers.ts`.

En entorns sense accés directe a internet (sandbox, proxy corporatiu), el
servidor de desenvolupament de Vite fa de proxy per a les APIs (`/proxy/*`) i
les tessel·les (`/tiles/*`) respectant `HTTPS_PROXY` — vegeu
`vite.config.ts`.

## 📄 Llicència

Codi sota llicència [MIT](LICENSE) © Zadkiel Aharonian.
Les dades mostrades continuen subjectes a les llicències dels seus productors
respectius (Licence Ouverte per a les dades públiques franceses, datos
abiertos del MITECO per als preus espanyols, © Govern d'Andorra per a
Andorra, dados abertos de la DGEG per als preus portuguesos, ODbL per a
OpenStreetMap).
Les tipografies **Archivo** i **Spline Sans Mono**, incloses a
`public/fonts/`, estan sota la [SIL Open Font License 1.1](public/fonts/)
(vegeu els fitxers `*-OFL.txt` de la mateixa carpeta).
