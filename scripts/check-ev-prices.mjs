// Validates public/ev-prices-fr.json — the hand-surveyed ad-hoc €/kWh grid of
// the major charge networks. Fails when the grid is malformed OR when a survey
// is older than MAX_AGE_DAYS: network prices change, and a stale grid quietly
// becomes misinformation. Usage: npm run check:ev-prices
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_AGE_DAYS = 90;
const MIN_KWH = 0.05;
const MAX_KWH = 2;

const path = join(process.cwd(), 'public/ev-prices-fr.json');
const grid = JSON.parse(readFileSync(path, 'utf8'));

const errors = [];
const check = (cond, msg) => {
  if (!cond) errors.push(msg);
};

check(Array.isArray(grid.networks) && grid.networks.length > 0, 'networks: non-empty array required');

const seenPrefixes = new Map();
const seenNames = new Set();
for (const n of grid.networks ?? []) {
  const where = `« ${n.name ?? '?'} »`;
  check(typeof n.name === 'string' && n.name, `${where}: name requis`);
  check(!seenNames.has(n.name), `${where}: réseau en double`);
  seenNames.add(n.name);
  check(Array.isArray(n.prefixes), `${where}: prefixes doit être un tableau`);
  check(
    Array.isArray(n.operators) && n.operators.length > 0,
    `${where}: au moins un motif operators requis`,
  );
  for (const op of n.operators ?? []) {
    check(/^[a-z0-9]+$/.test(op), `${where}: operator « ${op} » doit être normalisé (a-z0-9)`);
  }
  for (const p of n.prefixes ?? []) {
    check(/^FR[A-Z0-9]{3}$/.test(p), `${where}: préfixe « ${p} » attendu au format FRXXX`);
    const owner = seenPrefixes.get(p);
    check(!owner, `${where}: préfixe « ${p} » déjà utilisé par « ${owner} »`);
    seenPrefixes.set(p, n.name);
  }
  check(n.acKwh != null || n.dcKwh != null, `${where}: au moins un prix (acKwh ou dcKwh) requis`);
  for (const [k, v] of [['acKwh', n.acKwh], ['dcKwh', n.dcKwh]]) {
    if (v != null) {
      check(
        typeof v === 'number' && v >= MIN_KWH && v <= MAX_KWH,
        `${where}: ${k}=${v} hors de [${MIN_KWH}, ${MAX_KWH}] €/kWh`,
      );
    }
  }
  check(
    typeof n.source === 'string' && /^https:\/\//.test(n.source),
    `${where}: source https:// requise`,
  );
  const checkedAt = new Date(n.checkedAt ?? '').getTime();
  check(isFinite(checkedAt), `${where}: checkedAt invalide`);
  if (isFinite(checkedAt)) {
    const ageDays = (Date.now() - checkedAt) / 86_400_000;
    check(
      ageDays <= MAX_AGE_DAYS,
      `${where}: relevé vieux de ${Math.round(ageDays)} j (max ${MAX_AGE_DAYS}) — re-vérifier le tarif sur ${n.source}`,
    );
    check(ageDays >= -1, `${where}: checkedAt dans le futur`);
  }
}

if (errors.length) {
  console.error(`❌ ${path}`);
  for (const e of errors) console.error(`   - ${e}`);
  process.exit(1);
}
console.log(`✅ ev-prices-fr.json — ${grid.networks.length} réseaux, relevés < ${MAX_AGE_DAYS} j`);
