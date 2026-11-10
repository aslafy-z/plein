import { describe, expect, it } from 'vitest';
import BRAND_INDEX_SOURCE from '../../public/brands-fr.json?raw';
import { brandGroup, brandIconSrc, INDEPENDENT_BRAND_ID, KNOWN_BRAND_GROUPS } from './brandIcons';

describe('brandGroup', () => {
  it.each([
    // bare brands, any case
    ['Elf', 'TotalEnergies'],
    ['ELF', 'TotalEnergies'],
    ['Total', 'TotalEnergies'],
    ['TotalEnergies', 'TotalEnergies'],
    ['Totalenergies', 'TotalEnergies'],
    ['Total Énergies', 'TotalEnergies'],
    ['TotalEnergies Access', 'TotalEnergies'],
    ['TotalÉnergies Access', 'TotalEnergies'],
    ['Total Access', 'Total Access'],
    ['Avia', 'Avia'],
    ['AviaXpress', 'Avia'],
    ['Avia XPress', 'Avia'],
    ['Esso', 'Esso'],
    ['Esso Express', 'Esso'],
    ['Shell', 'Shell'],
    ['Shell Express', 'Shell'],
    ['Aldi', 'Aldi'],
    ['Intermarché', 'Intermarché'],
    ['Intermarche', 'Intermarché'],
    ['Les Mousquetaires', 'Intermarché'],
    ['E.Leclerc', 'E.Leclerc'],
    ['E. Leclerc', 'E.Leclerc'],
    ['U', 'Enseignes U'],
    ['SuperU', 'Enseignes U'],
    ['Super U;Station U', 'Enseignes U'],
    ['Système U Poids Lourds', 'Enseignes U'],
    ['Géant Casino', 'Casino'],
    ['C. C. Cora', 'Cora'],
    ['Eurospar', 'Spar'],
    ['AS24', 'AS 24'],
    ['AS 24', 'AS 24'],
    ['Élan', 'Élan'],
    ['ELAN', 'Élan'],
    ['ViTO Chaloupe Saint Leu', 'Vito'],
    ['Q8 Oils', 'Q8'],
    ['BONAREA', 'BonÀrea'],
    ['BonÀrea', 'BonÀrea'],
    ['Petronor', 'Repsol'],
    // punctuation and hyphens are boundaries
    ['Primagaz-Avia', 'Avia'],
    ['Esso-Express', 'Esso'],
    ['Ma station (Ex-Netto)', 'Netto'],
    ['Relais des images (Total)', 'TotalEnergies'],
    ['Station-service Aldi', 'Aldi'],
    // full display names, as favorites persist them
    ['Total Access · Tournefeuille', 'Total Access'],
    ['Elf · Andorra la Vella', 'TotalEnergies'],
    ['U · Tournefeuille', 'Enseignes U'],
    ['Shell · Toulouse', 'Shell'],
  ])('%s → %s', (label, group) => {
    expect(brandGroup(label)).toBe(group);
  });

  it.each([
    // a brand inside another word
    'Garibaldi Automobiles',
    'Self Service',
    'Autoself',
    'Batavia',
    'Gavia',
    'Presso',
    'Espresso Station',
    'Seashells',
    'Marshell Garage',
    'Decora',
    'Station Ulysse',
    'Gas 24',
    'Hamburgo',
    'Disagrup',
    'Veni Vidi',
    'Prioritaire',
    'Vitoria',
    'Elancourt Auto',
    // an accented neighbour is still a letter — ASCII `\b` sees a boundary here
    'Décora',
    'Aviação',
    'Sélf',
    'Élf',
    'Essoé',
    'Garibàldi',
    'Élancé',
    // only at the start of the label
    'Garage Vito',
    "Relais de l'Elan",
  ])('%s stays independent', (label) => {
    expect(brandGroup(label)).toBe(INDEPENDENT_BRAND_ID);
    expect(brandIconSrc(label)).toBeNull();
  });

  it('counts a station without brand data as independent', () => {
    expect(brandGroup(undefined)).toBe(INDEPENDENT_BRAND_ID);
    expect(brandGroup('')).toBe(INDEPENDENT_BRAND_ID);
  });

  it('resolves every group label to its own group', () => {
    for (const label of KNOWN_BRAND_GROUPS) expect(brandGroup(label)).toBe(label);
  });
});

describe('brandIconSrc', () => {
  it('follows the same matching as the group', () => {
    expect(brandIconSrc('Esso Express')).toBe('/brand-icons/esso.png');
    expect(brandIconSrc('Total Access · Tournefeuille')).toBe('/brand-icons/total.png');
    // a recognized group without a usable logo
    expect(brandIconSrc('BP')).toBeNull();
    expect(brandIconSrc(undefined)).toBeNull();
  });
});

describe('the OSM label index (public/brands-fr.json)', () => {
  const { labels } = JSON.parse(BRAND_INDEX_SOURCE) as { labels: string[] };
  const grouped = new Map<string, string[]>();
  for (const label of new Set(labels)) {
    const group = brandGroup(label);
    grouped.set(group, [...(grouped.get(group) ?? []), label]);
  }

  it('keeps the tricky independents out of the networks', () => {
    expect(labels).toContain('Garibaldi Automobiles');
    expect(brandGroup('Garibaldi Automobiles')).toBe(INDEPENDENT_BRAND_ID);
  });

  it('puts only labels that carry the brand as a word in the short-named groups', () => {
    expect(grouped.get('Aldi')?.sort()).toEqual(['Aldi', 'Station-service Aldi']);
    expect(grouped.get('Spar')).toEqual(['Spar']);
    for (const [group, word] of [
      ['Avia', /(^|[^a-z])avia/i],
      ['Esso', /(^|[^a-z])esso([^a-z]|$)/i],
      ['Shell', /(^|[^a-z])shell([^a-z]|$)/i],
      ['Cora', /(^|[^a-z])cora([^a-z]|$)/i],
    ] as const) {
      const members = grouped.get(group) ?? [];
      expect(members.length).toBeGreaterThan(0);
      for (const label of members) expect(label).toMatch(word);
    }
  });

  it('still recognizes the spelling variants of the big networks', () => {
    for (const label of [
      'Total Contact',
      'Station service TOTAL',
      'Access - TotalEnergies',
      'Esso Exxon Mobile',
      'Avia Thevenin & Ducrot',
      'Station Shell de Koné',
      'Station essence de Cora',
      'LIDL Carburants',
      'Carrefour Market',
      'Groupement des Mousquetaires',
    ]) {
      expect(labels).toContain(label);
      expect(brandGroup(label)).not.toBe(INDEPENDENT_BRAND_ID);
    }
  });
});
