/**
 * tools/generate-minidex.js
 *
 * Generates src/data/minidex.json from the sibling compiled Pokémon
 * Showdown install. Contains ONLY what decision-core needs:
 *   - species: name/types/baseStats per id
 *   - moves  : name/type/category/basePower/accuracy/multihit/ohko/
 *              damage/secondary(status,chance)/shortDesc per id
 *   - typeChart: damageTaken matrix (for effectiveness & immunity)
 *
 * Run from the extension repo root:
 *   node tools/generate-minidex.js [formatid]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const formatid = process.argv[2] || 'gen9randombattle';

// Sibling checkout of pokemon-showdown (same layout ps-autobattler uses).
const req = eval('require'); // hide from bundlers
const Dex = req(path.join(__dirname, '../../pokemon-showdown/dist/sim/index')).Dex;

const dex = Dex.forFormat(formatid);
try {
	dex.includeModData();
} catch (e) { /* base data fine */ }

const pick = (obj, keys) => {
	const out = {};
	for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
	return out;
};

function compact(entry, keys) {
	if (!entry || entry.exists === false || !entry.id) return null;
	return pick(entry, keys);
}

const SPECIES_KEYS = ['name', 'types', 'baseStats'];
const MOVE_KEYS = ['name', 'type', 'category', 'basePower', 'accuracy',
	'multihit', 'ohko', 'damage', 'secondary', 'shortDesc'];

const species = {};
for (const sp of dex.species.all()) {
	const c = compact(sp, SPECIES_KEYS);
	if (c) species[sp.id] = c;
}

const moves = {};
for (const mv of dex.moves.all()) {
	const c = compact(mv, MOVE_KEYS);
	if (c) moves[mv.id] = c;
}

// damageTaken: 0 normal, 1 super-effective, 2 resist, 3 immune.
const typeChart = {};
for (const type of dex.types.all()) {
	if (!type || !type.id || type.exists === false) continue;
	typeChart[type.name] = { damageTaken: type.damageTaken };
}

const out = {
	format: formatid,
	generatedAt: new Date().toISOString(),
	species,
	moves,
	typeChart,
};

const dest = path.join(__dirname, '..', 'src', 'data', 'minidex.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`wrote ${dest} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB, ` +
	`${Object.keys(species).length} species, ${Object.keys(moves).length} moves)`);
