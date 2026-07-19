// Regenerates public/brand-icons/*.png — the favicons shown on station
// avatars (see src/lib/brandIcons.ts for the label → icon mapping).
//
// Icons come from Google's favicon service at build time and are committed,
// so the app never depends on a third-party image host at runtime. Domains
// are hand-curated: the biggest French fuel brands whose favicon actually
// resolves to a recognizable logo (BP, Cora, Casino… serve none — those
// brands keep the initials avatar). Usage: npm run build:icons
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pexec = promisify(execFile);

const ICONS = [
  // Mousquetaires = Intermarché's musketeer emblem (intermarche.com only has 16px)
  ['intermarche', 'mousquetaires.com'],
  ['total', 'totalenergies.fr'],
  ['carrefour', 'carrefour.fr'],
  ['leclerc', 'e.leclerc'],
  ['avia', 'avia-france.fr'],
  ['esso', 'esso.com'],
  ['u', 'magasins-u.com'],
  ['auchan', 'auchan.fr'],
  ['eni', 'eni.com'],
  ['shell', 'shell.fr'],
  ['netto', 'netto.fr'],
  ['dyneff', 'dyneff.fr'],
  ['as24', 'as24.com'],
  ['tamoil', 'tamoil.com'],
  ['aldi', 'aldi.fr'],
  ['lidl', 'lidl.fr'],
  ['spar', 'spar.fr'],
  ['colruyt', 'colruyt.fr'],
  // Enseignes espagnoles (source esp — geoportalgasolineras.es).
  // Pas de cepsa.es : il sert le favicon Moeve depuis le rebranding — les
  // stations encore siglées Cepsa gardent l'avatar à initiales.
  ['repsol', 'repsol.es'],
  ['moeve', 'moeve.es'],
  ['galp', 'galp.com'],
  // Ballenoil / Plenergy serve no favicon — they keep the initials avatar
  ['petroprix', 'petroprix.es'],
  ['q8', 'q8.it'],
];

const SIZE = 64;
const s2 = (domain) => `https://www.google.com/s2/favicons?domain=${domain}&sz=${SIZE}`;

// curl honors HTTPS_PROXY (sandboxed environments); Node fetch does not.
async function fetchBytes(url) {
  if (process.env.HTTPS_PROXY || process.env.https_proxy) {
    const { stdout } = await pexec('curl', ['-sSL', '--fail', '--max-time', '20', url], {
      encoding: 'buffer',
      maxBuffer: 8e6,
    });
    return stdout;
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Domains without a known favicon 404 on the redirected gstatic endpoint, so
// a fetch failure simply means « no logo » — the avatar keeps its initials.
const dir = join(dirname(fileURLToPath(import.meta.url)), '../public/brand-icons');
mkdirSync(dir, { recursive: true });

let ok = 0;
for (const [slug, domain] of ICONS) {
  try {
    const bytes = await fetchBytes(s2(domain));
    writeFileSync(join(dir, `${slug}.png`), bytes);
    ok++;
    console.log(`✓ ${slug} ← ${domain} (${bytes.length} B)`);
  } catch (err) {
    console.warn(`✗ ${slug} (${domain}): ${err.message ?? err}`);
  }
}
console.log(`${ok}/${ICONS.length} icons → ${dir}`);
