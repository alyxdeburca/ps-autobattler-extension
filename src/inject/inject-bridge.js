/**
 * inject-bridge.js -- runs in the MAIN world on play.pokemonshowdown.com.
 *
 * Verified against the client source (pokemon-showdown-client):
 *   - live request lives on the ROOM object:  room.request  (BattleRequest,
 *     with .requestType 'move'|'switch'|'team'|'wait' and .side.pokemon as
 *     exact ServerPokemon[])
 *   - choices are sent via the room's own connection:
 *         room.sendDirect("/choose " + choices.toString())
 *   - foe public state: battle.foe.active (+ .moveTrack revealed moves)
 *   - exact own team also mirrored at battle.myPokemon
 */
'use strict';

(function () {
	if (window.__PS_AUTOBATTLER_BRIDGE__ === 3) return;
	const BRIDGE = { version: 3 };
	window.__PS_AUTOBATTLER_BRIDGE__ = 3;
	window.__PS_AUTOBATTLER_API__ = BRIDGE;

	const SRC_PAGE = 'psab-page';
	const SRC_CONTENT = 'psab-content';

	// ---- locate the active battle ROOM --------------------------------------
	function findBattleRoom() {
		try {
			const registries = [];
			if (window.PS && PS.rooms) registries.push(PS.rooms);
			if (window.app && app.rooms) registries.push(app.rooms);
			for (const rooms of registries) {
				const ids = Object.keys(rooms).filter(id => id.startsWith('battle-'));
				// most recently active battle first
				ids.sort((a, b) => {
					const ra = rooms[a], rb = rooms[b];
					return (rb && rb.battle && rb.battle.turn || 0) -
					       (ra && ra.battle && ra.battle.turn || 0);
				});
				for (const id of ids) {
					const room = rooms[id];
					if (room && room.battle) return room;
				}
			}
		} catch (e) { /* client not ready */ }
		return null;
	}

	function hpText(mon) {
		try {
			const hp = Math.max(0, Math.ceil(mon.hp || 0));
			const max = Math.ceil(mon.maxhp || 100);
			return `${hp}/${max}${mon.hp ? '' : ' fnt'}`;
		} catch (e) {
			return '0/100 fnt';
		}
	}

	// ---- snapshot -------------------------------------------------------------
	BRIDGE.getSnapshot = function () {
		const room = findBattleRoom();
		if (!room) return { connected: false, reason: 'no battle room found' };
		const battle = room.battle;

		let request = room.request || null;
		if (typeof request === 'string') {
			try { request = JSON.parse(request); } catch (e) { request = null; }
		}

		// ---- foe (public knowledge) ------------------------------------------
		// NOTE: Side.active is an ARRAY (battle.ts line ~659); the active
		// Pokemon objects live in it -- reading the Side itself yields player
		// metadata (which produced ghost foes / zero damage before).
		let foeView = [];
		try {
			const side = battle.foe;
			const actives = side && Array.isArray(side.active) ? side.active : [];
			for (const mon of actives) {
				if (!mon) continue;
				foeView.push({
					name: mon.name || '',
					species: String(mon.speciesForme || mon.species || '')
						.replace(/[^a-zA-Z0-9]/g, ''),
					level: mon.level || 100,
					types: (mon.getTypes && mon.getTypes()) || [],
					hpRatio: mon.maxhp ? (mon.hp || 0) / mon.maxhp : 1,
					status: mon.status || '',
					moves: (mon.moveTrack || []).map(m => m[0]),
					item: mon.item || '',
					ability: mon.ability || '',
					terastallized: !!mon.terastallized,
					boosts: { ...(mon.boosts || {}) },
				});
			}
		} catch (e) { /* best-effort */ }

		// ---- our side: prefer the REQUEST's exact ServerPokemon[] -------------
		let myPokemon = [];
		try {
			const list = (request && request.side && request.side.pokemon) ||
				battle.myPokemon || [];
			myPokemon = list.map((mon, i) => ({
				slot: i + 1,
				ident: mon.ident || mon.speciesForme || `slot${i + 1}`,
				details: mon.details || mon.speciesForme || '',
				condition: hpText(mon),
				fainted: !mon.hp,
				active: !!mon.active,
				stats: mon.stats || {},
				moves: mon.moves || [],
				item: mon.item || '',
				ability: mon.ability || '',
				reviving: !!mon.reviving,
			}));
		} catch (e) { /* best-effort */ }

		// ---- foe side conditions (hazards) ------------------------------------
		let foeHazards = false;
		try {
			const foeSide = battle.foe;
			const sc = foeSide && foeSide.sideConditions;
			if (sc) {
				for (const key of ['stealthrock', 'spikes', 'toxicspikes', 'stickyweb']) {
					if (sc[key]) { foeHazards = true; break; }
				}
			}
		} catch (e) { /* best-effort */ }

		return {
			connected: true,
			hasRequest: !!request,
			requestType: request ? request.requestType : '',
			rqid: request ? request.rqid : 0,
			reason: request ? '' : 'battle found · no decision point yet',
			battleId: battle.roomid || room.id || '',
			turn: battle.turn || 0,
			myId: (request && request.side && request.side.id) ||
			      (battle.mySide && battle.mySide.id) || 'p1',
			request,
			foeView,
			foeHazards,
			myPokemon,
		};
	};

	// ---- sending choices through the client's OWN path ------------------------
	BRIDGE.sendChoice = function (choice) {
		const room = findBattleRoom();
		if (!room) return { ok: false, error: 'no battle room' };
		if (typeof choice !== 'string' || !/^[\w ,:-]+$/.test(choice)) {
			return { ok: false, error: 'invalid choice string' };
		}
		if (!room.request) return { ok: false, error: 'no pending request' };
		try {
			// Identical to what the UI does when you click a move button:
			// panel-chat.tsx -> this.sendDirect(`/choose ${choices.toString()}`)
			room.sendDirect(`/choose ${choice}`);
			return { ok: true };
		} catch (e) {
			return { ok: false, error: String(e && e.message) };
		}
	};

	BRIDGE.debugState = function () {
		const room = findBattleRoom();
		if (!room) return { found: false };
		return {
			found: true,
			roomId: room.id,
			hasRequest: !!room.request,
			requestType: room.request ? room.request.requestType : null,
			hasChoices: !!room.choices,
			battleTurn: room.battle && room.battle.turn,
			battleEnded: room.battle && room.battle.ended,
		};
	};

	// ---- postMessage command loop ----------------------------------------------
	window.addEventListener('message', ev => {
		if (ev.source !== window) return;
		const msg = ev.data;
		if (!msg || msg.source !== SRC_CONTENT) return;

		if (msg.type === 'getSnapshot') {
			const snap = BRIDGE.getSnapshot();
			window.postMessage({
				source: SRC_PAGE,
				type: 'snapshot',
				reqId: msg.reqId,
				payload: JSON.stringify(snap),
			}, window.location.origin);
		} else if (msg.type === 'sendChoice') {
			const res = BRIDGE.sendChoice(String(msg.choice || ''));
			window.postMessage({
				source: SRC_PAGE,
				type: 'choiceResult',
				reqId: msg.reqId,
				payload: JSON.stringify(res),
			}, window.location.origin);
		} else if (msg.type === 'debug') {
			window.postMessage({
				source: SRC_PAGE,
				type: 'debugResult',
				reqId: msg.reqId,
				payload: JSON.stringify(BRIDGE.debugState()),
			}, window.location.origin);
		}
	});

	console.info('[PSAB] bridge v3 ready');
})();
