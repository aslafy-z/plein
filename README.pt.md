<div align="center">

<img src="public/icons/icon.svg" width="96" alt="Logótipo do Plein." />

# Plein.

**O depósito cheio ao preço justo** — encontre os postos de combustível mais
baratos à sua volta e ao longo dos seus trajetos, em França, Espanha, Andorra
e Portugal.

[English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [Català](README.ca.md) · **Português**

[![Abrir a app](https://img.shields.io/badge/%E2%96%B6%EF%B8%8E%20Abrir%20a%20app-plein.zadkiel.fr-3ddc84?style=for-the-badge&labelColor=0f1a14)](https://plein.zadkiel.fr)

Quer ver o que vem a seguir? [staging-plein.zadkiel.workers.dev](https://staging-plein.zadkiel.workers.dev) serve o último `main`, antes de ser publicado — pode falhar.

[![Licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-3ddc84?labelColor=0f1a14)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-instal%C3%A1vel-3ddc84?labelColor=0f1a14)](#-utilização)
[![Dados](https://img.shields.io/badge/dados-%F0%9F%87%AB%F0%9F%87%B7%20Fran%C3%A7a%20%C2%B7%20%F0%9F%87%AA%F0%9F%87%B8%20Espanha%20%C2%B7%20%F0%9F%87%A6%F0%9F%87%A9%20Andorra%20%C2%B7%20%F0%9F%87%B5%F0%9F%87%B9%20Portugal-blue?labelColor=0f1a14)](#-fontes-de-dados)
[![React 18](https://img.shields.io/badge/React-18-61dafb?labelColor=0f1a14&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?labelColor=0f1a14&logo=typescript)](https://www.typescriptlang.org)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900?labelColor=0f1a14)](https://leafletjs.com)

<br/>

<p align="center">
  <img src="docs/screenshots/pt/map.png" width="23%" alt="Mapa de preços à volta de Lisboa" title="Os preços à sua volta" />
  <img src="docs/screenshots/pt/station.png" width="23%" alt="Ficha de um posto: preço por combustível, diferença para o mais barato, serviços e poupança num depósito" title="A ficha de um posto" />
  <img src="docs/screenshots/pt/trip.png" width="23%" alt="Trajeto Lisboa → Porto no mapa, com os postos e os seus preços ao longo do caminho" title="O seu trajeto no mapa" />
  <img src="docs/screenshots/pt/route.png" width="23%" alt="Comparação de postos num trajeto Lisboa → Porto" title="No seu trajeto" />
</p>

</div>

## ✨ Funcionalidades

- 🗺️ **Mapa de preços em direto** — os postos à sua volta, preços em
  alfinetes coloridos consoante o preço: boas ofertas a verde, os mais caros
  a laranja.
- 🇫🇷🇪🇸🇦🇩🇵🇹 **Quatro países num mapa** — os fluxos oficiais de França,
  Espanha, Andorra e Portugal combinados; os abastecimentos fronteiriços
  comparam-se num relance.
- 🔎 **Pesquisa de locais** — cidades, moradas e pontos de interesse
  (estações de comboio, aeroportos, monumentos) nos quatro países, ordenados
  pela correspondência com o que escreveu, com o país do mapa primeiro.
- 📋 **Melhor escolha real** — o combustível gasto no desvio é contabilizado:
  um posto mais próximo pode bater o mais barato.
- 🛣️ **Plano de abastecimento na rota** — onde parar ao longo da viagem,
  quantos litros em cada paragem e a que preço, segundo 3 estratégias.
- ⭐ **Favoritos** — os seus postos e o preço do dia, através de zonas e
  países.
- ⛽ **Todos os combustíveis** — Gasóleo, SP95/98, E10, E85, GPL; filtros por
  raio, marcas, serviços e AdBlue.
- 🕐 **Horários reais** — «Aberto 24 h», «Fechado · abre às 6h30» — com a
  frescura dos preços assinalada.
- 🚫 **Ruturas assinaladas** — uma bomba vazia mostra «em rutura desde 3 de
  nov.» em vez de «não vendido», e a zona conta os seus postos em rutura
  (França).
- 🏷️ **Marcas reconhecidas** — nomes e logótipos dos postos a partir dos
  fluxos oficiais e do OpenStreetMap.
- 🧭 **«Direções»** — abre o posto na sua app de GPS.
- 🔗 **Ligações partilháveis** — o endereço segue o mapa e o trajeto; uma
  ligação reabre a mesma vista.
- 🌗 **Tema claro e escuro** — segue o navegador, alterável nas Definições,
  com uma cor de destaque à escolha (verde, turquesa, azul ou violeta).
- 🌍 **Cinco línguas** — francês, inglês, espanhol, catalão e português.
- 🖥️ **Telemóvel e computador** — mapa em ecrã inteiro e painel no telemóvel,
  painéis laterais no ecrã grande.
- 📱 **PWA instalável** — as últimas zonas e mosaicos funcionam offline.

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
   compare os postos ao longo do percurso. A partida fica em **A minha
   posição** assim que a localização dá uma, e a pesquisa de qualquer um dos
   extremos oferece-a como linha — só num deles de cada vez. **Iniciar o
   percurso** passa todo o itinerário, paragens para abastecer incluídas, ao
   Google Maps.
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
| Geocodificação e preenchimento automático | [Base Adresse Nationale](https://adresse.data.gouv.fr/), através do serviço de geocodificação da Géoplateforme (data.geopf.fr) | Licence Ouverte / Open Licence |
| Pontos de interesse (aeroportos, estações de comboio, monumentos…) | [Serviço de geocodificação da Géoplateforme](https://geoservices.ign.fr/documentation/services/services-geoplateforme/geocodage) (data.geopf.fr, BD TOPO do IGN) | Licence Ouverte / Open Licence |
| Geocodificação de recurso, quando a Géoplateforme não responde | [Photon](https://photon.komoot.io) (instância pública da Komoot, índice OpenStreetMap), limitado à França metropolitana | ODbL |

### 🇪🇸 Espanha

| Dado | Fonte | Licença |
| --- | --- | --- |
| Preços dos combustíveis, horários e marcas | [Precios de carburantes](https://geoportalgasolineras.es) (sedeaplicaciones.minetur.gob.es, MITECO) — a marca (*rótulo*) vem no fluxo | Datos abiertos |
| Geocodificação e preenchimento automático | [CartoCiudad](https://www.cartociudad.es) (IGN) | CC BY 4.0 |
| Geocodificação de recurso, quando o CartoCiudad não responde | [Photon](https://photon.komoot.io), limitado à Espanha peninsular e às Baleares | ODbL |

### 🇦🇩 Andorra

| Dado | Fonte | Licença |
| --- | --- | --- |
| Preços dos combustíveis e marcas | [Preus dels carburants](https://sig.govern.ad/IPE/PreusCarburants) (sig.govern.ad, Govern d'Andorra — Oficina de l'Energia i del Canvi Climàtic) — a marca é deduzida do nome do posto; o fluxo não traz morada nem horários | © Govern d'Andorra |
| Geocodificação e preenchimento automático | Nomenclàtor (dicionário geográfico oficial) & LocatorIDE (sig.govern.ad, IDE Andorra) | © Govern d'Andorra |
| Geocodificação de recurso, quando os localizadores da IDE não respondem | [Photon](https://photon.komoot.io), limitado a Andorra | ODbL |

### 🇵🇹 Portugal

| Dado | Fonte | Licença |
| --- | --- | --- |
| Preços dos combustíveis e marcas | [Preços dos combustíveis](https://precoscombustiveis.dgeg.gov.pt) (DGEG — Direção-Geral de Energia e Geologia) — a marca (*marca*) vem no fluxo, que não dá horários nem E10; cobertura continental (os Açores e a Madeira têm o seu próprio regime) | Dados abertos |
| Geocodificação e preenchimento automático | [Photon](https://photon.komoot.io) (instância pública da Komoot, índice OpenStreetMap), limitado a Portugal continental — o país não publica nenhum geocodificador de moradas sem chave | ODbL |

### Comuns aos quatro países

| Dado | Fonte | Licença |
| --- | --- | --- |
| Cálculo de itinerários | [OSRM](https://project-osrm.org/) (servidor de demonstração) · [Valhalla](https://valhalla.github.io/valhalla/) (servidor público FOSSGIS) para «evitar autoestradas / portagens» | © colaboradores do [OpenStreetMap](https://www.openstreetmap.org/copyright) |
| Mapas base | [CARTO](https://carto.com/attributions) claro / escuro consoante o tema (mosaicos do OpenStreetMap como recurso offline) | © colaboradores do [OpenStreetMap](https://www.openstreetmap.org/copyright) |

A app não tem **nenhum backend**: o navegador consulta diretamente estes
serviços públicos. As fontes são conectáveis (`src/data/types.ts`). Sem
ligação ou com um fluxo indisponível, a app mantém os últimos postos
carregados (cache por zona) com uma faixa explícita e tenta de novo assim que
a ligação volta. Quando o geocodificador de um país não responde, o Photon
substitui-o; se também falhar, a pesquisa indica que países faltam na
lista.

## 🛠️ Construído com

**Vite · React 18 · TypeScript estrito · Leaflet**, sem outra dependência de
runtime. O build de produção são apenas recursos estáticos, servidos por um
Cloudflare Worker.

## 🤝 Contribuir

Relatos de erros, traduções e pull requests são bem-vindos —
[CONTRIBUTING.md](CONTRIBUTING.md) (em inglês) explica a instalação, os
comandos, as regras da casa e os testes. Para comunicar um erro, cole o
instantâneo de depuração: Definições › Dados offline › Sobreposição de
depuração, depois a pastilha flutuante **DBG** → **Report**, que o copia e
abre o formulário.

## 📄 Licença

Código sob licença [MIT](LICENSE) © Zadkiel Aharonian.
Os dados apresentados continuam sujeitos às licenças dos respetivos
produtores (Licence Ouverte para os dados públicos franceses, datos abiertos
do MITECO para os preços espanhóis, © Govern d'Andorra para Andorra, dados
abertos da DGEG para os preços portugueses, ODbL para o OpenStreetMap).
Os tipos de letra **Archivo** e **Spline Sans Mono**, incluídos em
`public/fonts/`, estão sob a [SIL Open Font License 1.1](public/fonts/) (ver
os ficheiros `*-OFL.txt` da mesma pasta).
