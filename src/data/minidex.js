/**
 * minidex.js -- a Dex-like backend for decision-core, backed by the
 * generated minidex.json. Implements the exact surface dex-shim uses:
 * species.get / moves.get / getEffectiveness / getImmunity.
 */
'use strict';

const data = require('../data/minidex.json');

const toID = name => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function entry(map, idOrName) {
	const id = toID(idOrName);
	return map[id] || null;
}

const species = {
	get: idOrName => {
		const e = entry(data.species, idOrName);
		return e ? { ...e, exists: true, id: toID(idOrName) } :
			{ exists: false, id: toID(idOrName), name: String(idOrName) };
	},
};

const moves = {
	get: idOrName => {
		const e = entry(data.moves, idOrName);
		return e ? { ...e, exists: true, id: toID(idOrName) } :
			{ exists: false, id: toID(idOrName), name: String(idOrName) };
	},
};

function getEffectiveness(sourceType, defTypes) {
	let total = 0;
	for (const t of defTypes) total += effOne(sourceType, t);
	return total;
}

function effOne(sourceType, targetType) {
	const chart = data.typeChart[targetType];
	if (!chart) return 0;
	switch (chart.damageTaken[sourceType]) {
	case 1: return 1;   // super-effective
	case 2: return -1;  // resist
	default: return 0;
	}
}

function getImmunity(sourceType, target) {
	const list = Array.isArray(target) ? target : [target];
	for (const t of list) {
		const chart = data.typeChart[t];
		if (chart && chart.damageTaken[sourceType] === 3) return false;
	}
	return true;
}

module.exports = {
	data,
	species,
	moves,
	getEffectiveness,
	getImmunity,
};
