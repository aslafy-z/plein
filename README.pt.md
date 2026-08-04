<div align="center">

<img src="public/icons/icon.svg" width="96" alt="Logótipo do Plein." />

# Plein.

**O depósito cheio ao preço justo** — encontre os postos de combustível mais
baratos à sua volta e ao longo dos seus trajetos, em França, Espanha, Andorra
e Portugal.

[English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [Català](README.ca.md) · **Português**

[![Abrir a app](https://img.shields.io/badge/%E2%96%B6%EF%B8%8E%20Abrir%20a%20app-plein.zadkiel.fr-3ddc84?style=for-the-badge&labelColor=0f1a14)](https://plein.zadkiel.fr)

[![Licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-3ddc84?labelColor=0f1a14)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-instal%C3%A1vel-3ddc84?labelColor=0f1a14)](#-utilização)
[![Dados](https://img.shields.io/badge/dados-%F0%9F%87%AB%F0%9F%87%B7%20Fran%C3%A7a%20%C2%B7%20%F0%9F%87%AA%F0%9F%87%B8%20Espanha%20%C2%B7%20%F0%9F%87%A6%F0%9F%87%A9%20Andorra%20%C2%B7%20%F0%9F%87%B5%F0%9F%87%B9%20Portugal-blue?labelColor=0f1a14)](#-fontes-de-dados)
[![React 18](https://img.shields.io/badge/React-18-61dafb?labelColor=0f1a14&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?labelColor=0f1a14&logo=typescript)](https://www.typescriptlang.org)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900?labelColor=0f1a14)](https://leafletjs.com)

<br/>

| Os preços à sua volta | A ficha de um posto | No seu trajeto |
| :---: | :---: | :---: |
| <img src="docs/screenshots/map.png" width="250" alt="Mapa de preços à volta de Toulouse" /> | <img src="docs/screenshots/station.png" width="250" alt="Ficha de um posto: preço por combustível, diferença para o mais barato, serviços e poupança num depósito" /> | <img src="docs/screenshots/route.png" width="250" alt="Comparação de postos num trajeto Toulouse → Nantes" /> |

</div>

## ✨ Funcionalidades

- 🗺️ **Mapa de preços em direto** — os postos à sua volta com o preço no
  alfinete, coloridos consoante o preço: as «boas ofertas» (todos os postos
  quase ao melhor preço, não apenas o primeiro) a verde, os mais caros em
  tons de laranja; mova o mapa e os postos da zona carregam-se
  automaticamente, e nas zonas densas só os mais baratos mantêm a bolha de
  preço.
- 🇫🇷🇪🇸🇦🇩🇵🇹 **Quatro países no mesmo mapa** — a fonte «Automática» combina
  os fluxos oficiais de França, Espanha, Andorra e Portugal consoante a zona
  apresentada: os abastecimentos fronteiriços (Le Perthus, Irún, o Pas de la
  Casa, Vilar Formoso…) comparam-se num relance.
- 📋 **Lista da zona** — puxe o painel inferior: todos os postos visíveis,
  ordenados por recomendação por defeito (preço ou distância a um toque), as
  boas ofertas realçadas, sincronizados com o mapa. O posto em destaque é a
  **melhor escolha real**: o combustível gasto na ida e volta (consumo e
  depósito do perfil de veículo das Definições — carro ou mota) é
  contabilizado, pelo que um posto um pouco mais caro mas muito mais próximo
  pode bater o mais barato apresentado.
- 🛣️ **Plano de abastecimento do trajeto** — partida de «A minha posição» ou
  de qualquer morada, preenchimento automático, mapa do corredor e **plano de
  abastecimento** segundo 3 estratégias (melhor compromisso · preço mais
  baixo · desvio mínimo): uma paragem ou várias encadeadas nas viagens
  longas, cada uma com os litros a comprar, o seu custo e o desvio, do nível
  do depósito à partida ao combustível restante à chegada. Fixe ou retire
  paragens para compor o seu próprio percurso, evite autoestradas ou
  portagens, e os resultados chegam progressivamente — primeiro o itinerário,
  depois os postos, depois o plano.
- ⭐ **Favoritos** — fixe os seus postos e consulte o preço do dia num
  relance; mantêm o preço mesmo através de zonas e países.
- ⛽ **Todos os combustíveis** — Gasóleo, SP95/98, E10, E85, GPL; filtros por
  raio, marcas, tipo de distribuidor e serviços (24 h, lavagem, loja,
  calibragem, aditivos). O filtro **AdBlue** só aparece onde a fonte publica
  a informação: os fluxos espanhol e andorrano declaram os produtos à venda
  (e o seu preço, apresentado na ficha), os fluxos francês e português nada
  dizem sobre isso, pelo que os seus postos continuam listados em vez de
  indevidamente escondidos. Como o E10 quase não existe fora de França, os
  postos espanhóis, andorranos e portugueses mostram a sua SP95 (compatível
  com E10) no mapa E10 — com o rótulo «SP95 / L» a atestá-lo.
- 🕐 **Horários reais** — «Aberto 24 h», «Fechado · abre às 6h30»… calculados
  a partir dos horários oficiais; frescura dos preços apresentada (e
  assinalada quando envelhecem).
- 🏷️ **Marcas reconhecidas** — logótipos e nomes dos postos (TotalEnergies,
  E.Leclerc, Intermarché… e Repsol, Cepsa, Galp, Prio do lado espanhol,
  andorrano e português) emparelhados a partir do OpenStreetMap em França
  (posições ajustadas às coordenadas OSM reais), fornecidos diretamente pelos
  fluxos oficiais nos restantes países.
- 🧭 **«Direções»** — abre o local na sua app de GPS: escolha da app no
  Android (`geo:`), Mapas no iOS, Google Maps no desktop; percurso
  multiparagens possível.
- 🔗 **Ligação partilhável** — o endereço da página segue o mapa (zona
  apresentada, zoom, combustível, raio e filtros) e o trajeto (etapas e
  opções): o botão *Partilhar* envia uma ligação que reabre exatamente a
  mesma vista — ou a mesma viagem — para quem a recebe. As fichas dos postos
  mantêm a sua ligação direta `/station/:id`.
- 🌗 **Tema claro e escuro** — a app segue a definição do seu navegador por
  defeito e muda-se nas Definições; o mapa base segue o tema e a mudança faz-se
  com um fundido.
- 🌍 **Cinco línguas** — francês, inglês, espanhol, catalão e português; a
  app segue a língua do seu navegador por defeito, alterável nas Definições.
- 🖥️ **A mesma app no telemóvel e no navegador** — no telemóvel, o mapa em
  ecrã inteiro e o painel que se puxa; num ecrã largo, a navegação passa para
  o lado e a lista de postos encosta **ao lado** do mapa em vez de o cobrir,
  os filtros e as fichas tornam-se painéis, e o rato recupera o que lhe
  faltava (botões de zoom, hover, Esc para fechar). Acabou-se a moldura de
  telemóvel no meio do ecrã.
- 📱 **PWA instalável e tolerante ao modo offline** — adicione-a ao ecrã
  inicial; as últimas zonas consultadas e os mosaicos do mapa continuam
  disponíveis sem rede, com indicador da antiguidade dos preços.

## 🚀 Utilização

1. Abra **[plein.zadkiel.fr](https://plein.zadkiel.fr)** (a implantação oficial).
2. Autorize a geolocalização — ou continue sem ela e procure uma cidade, em
   França, Espanha, Andorra ou Portugal. A pesquisa lembra-se dos locais que
   escolheu: propõe-nos assim que abre e coloca-os no topo das sugestões mal
   comece a escrever.
3. Escolha o combustível no topo do mapa: a melhor escolha (preço E
   distância, desvio contabilizado) aparece no painel inferior, **Direções**
   inicia a navegação.
4. Antes de uma viagem longa, separador **Trajeto**: introduza o destino e
   compare os postos ao longo do percurso.
5. No telemóvel, instale a app (faixa de instalação ou
   *Definições → Aplicação*) para a ter como ícone, em ecrã inteiro e
   offline.

Sem conta, sem rastreadores: os seus favoritos e definições ficam no seu
navegador.

## 📊 Fontes de dados

Cada país coberto tem os seus próprios fluxos oficiais — preços e
geocodificação — que a app escolhe consoante a zona apresentada (fonte
*Automática*). O resto (itinerários, mapas base) é comum aos quatro.

### 🇫🇷 França

| Dado | Fonte | Licença |
| --- | --- | --- |
| Preços dos combustíveis e horários | [Prix des carburants — fluxo em tempo real](https://data.economie.gouv.fr/explore/dataset/prix-des-carburants-en-france-flux-instantane-v2/) (data.economie.gouv.fr) | Licence Ouverte / Open Licence |
| Marcas dos postos | [OpenStreetMap](https://www.openstreetmap.org/) (índice estático gerado, associado aos postos por proximidade) | ODbL |
| Geocodificação e preenchimento automático | [Base Adresse Nationale](https://adresse.data.gouv.fr/) (api-adresse.data.gouv.fr) | Licence Ouverte / Open Licence |

### 🇪🇸 Espanha

| Dado | Fonte | Licença |
| --- | --- | --- |
| Preços dos combustíveis, horários e marcas | [Precios de carburantes](https://geoportalgasolineras.es) (sedeaplicaciones.minetur.gob.es, MITECO) — a marca (*rótulo*) vem no fluxo | Datos abiertos |
| Geocodificação e preenchimento automático | [CartoCiudad](https://www.cartociudad.es) (IGN) | CC BY 4.0 |

### 🇦🇩 Andorra

| Dado | Fonte | Licença |
| --- | --- | --- |
| Preços dos combustíveis e marcas | [Preus dels carburants](https://sig.govern.ad/IPE/PreusCarburants) (sig.govern.ad, Govern d'Andorra — Oficina de l'energia i del canvi climàtic) — a marca é deduzida do nome do posto; o fluxo não traz morada nem horários | © Govern d'Andorra |
| Geocodificação e preenchimento automático | Nomenclàtor (dicionário geográfico oficial) & LocatorIDE (sig.govern.ad, IDE Andorra) | © Govern d'Andorra |

### 🇵🇹 Portugal

| Dado | Fonte | Licença |
| --- | --- | --- |
| Preços dos combustíveis e marcas | [Preços dos combustíveis](https://precoscombustiveis.dgeg.gov.pt) (DGEG — Direção-Geral de Energia e Geologia) — a marca (*marca*) vem no fluxo, que não dá horários nem E10; cobertura continental (os Açores e a Madeira têm o seu próprio regime) | Dados abertos |
| Geocodificação e preenchimento automático | [Photon](https://photon.komoot.io) (instância pública da Komoot, índice OpenStreetMap), limitado a Portugal continental — o país não publica nenhum geocodificador de moradas sem chave | ODbL |

### Comuns aos quatro países

| Dado | Fonte | Licença |
| --- | --- | --- |
| Cálculo de itinerários | [OSRM](https://project-osrm.org/) (servidor de demonstração) · [Valhalla](https://valhalla.github.io/valhalla/) (servidor público FOSSGIS) para «evitar autoestradas / portagens» | Dados © OpenStreetMap |
| Mapas base | [CARTO](https://carto.com/attributions) claro / escuro consoante o tema (mosaicos do OpenStreetMap como recurso offline) · dados © colaboradores do [OpenStreetMap](https://www.openstreetmap.org/copyright) | — |

A app não tem **nenhum backend**: o navegador consulta diretamente estes
serviços públicos. As fontes são conectáveis (`src/data/types.ts`). Sem
ligação ou com um fluxo indisponível, a app mantém os últimos postos
carregados (cache por zona) com uma faixa explícita e tenta de novo assim que
a ligação volta; um conjunto de dados de demonstração offline continua
selecionável nas definições.

## 🛠️ Desenvolvimento

Stack: **Vite · React 18 · TypeScript estrito · Leaflet**, sem outra
dependência de runtime. Implantado em Cloudflare Workers (`wrangler`).

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # build de produção (dist/)
npm run e2e          # E2E Playwright: percorre todos os ecrãs
npm run verify:live  # verifica os fornecedores reais (França, Espanha, Andorra, Portugal, geocodificadores, OSRM) contra os endpoints reais
npm run deploy       # build + wrangler deploy
```

Para adicionar uma fonte de dados: implementar as interfaces
`StationsProvider` / `GeocodeProvider` / `RouteProvider` e registá-la em
`src/data/providers.ts`.

Em ambientes sem acesso direto à internet (sandbox, proxy empresarial), o
servidor de desenvolvimento do Vite faz proxy das APIs (`/proxy/*`) e dos
mosaicos (`/tiles/*`) respeitando `HTTPS_PROXY` — ver `vite.config.ts`.

## 📄 Licença

Código sob licença [MIT](LICENSE) © Zadkiel Aharonian.
Os dados apresentados continuam sujeitos às licenças dos respetivos
produtores (Licence Ouverte para os dados públicos franceses, datos abiertos
do MITECO para os preços espanhóis, © Govern d'Andorra para Andorra, dados
abertos da DGEG para os preços portugueses, ODbL para o OpenStreetMap).
Os tipos de letra **Archivo** e **Spline Sans Mono**, incluídos em
`public/fonts/`, estão sob a [SIL Open Font License 1.1](public/fonts/) (ver
os ficheiros `*-OFL.txt` da mesma pasta).
