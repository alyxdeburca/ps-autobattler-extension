/**
 * content-main.js -- isolated world content script (headless brain).
 *
 * v3: consumes room.request snapshots (exact own team + move availability),
 * decides via the ps-autobattler decision core, and sends choices through
 * the client's own sendDirect("/choose ...") path when autoplay is on.
 */
'use strict';

const core = require('../../vendor/ps-autobattler/src/decision-core');
const trackerMod = require('../../vendor/ps-autobattler/src/battle-state');
const dexShim = require('../../vendor/ps-autobattler/src/dex-shim');
const est = require('../../vendor/ps-autobattler/src/estimator');
const { BattleTracker } = trackerMod;

// --- backend wiring (THE critical piece: without this, dex lookups throw
//     in the browser and every decision silently fails) -------------------
const minidex = require('../data/minidex');
dexShim.setBackend(minidex);
est.setCalcEngine(require('../calc/smogon-calc').expectedDamagePct);
const overlay = require('./overlay');

// ---------------------------------------------------------------------------
// postMessage bridge
// ---------------------------------------------------------------------------
const SRC_CONTENT = 'psab-content';
let msgReqId = 0;
const pending = new Map();

window.addEventListener('message', ev => {
	if (ev.source !== window) return;
	const msg = ev.data;
	if (!msg || msg.source !== 'psab-page') return;
	if ((msg.type === 'snapshot' || msg.type === 'choiceResult') &&
		pending.has(msg.reqId)) {
		const resolve = pending.get(msg.reqId);
		pending.delete(msg.reqId);
		try {
			resolve(JSON.parse(msg.payload));
		} catch (e) {
			resolve(null);
		}
	}
});

function callBridge(type, extra = {}, timeoutMs = 800) {
	return new Promise(resolve => {
		const reqId = ++msgReqId;
		pending.set(reqId, resolve);
		window.postMessage({ source: SRC_CONTENT, type, reqId, ...extra },
			window.location.origin);
		setTimeout(() => {
			if (pending.has(reqId)) {
				pending.delete(reqId);
				resolve(null);
			}
		}, timeoutMs);
	});
}

// ---------------------------------------------------------------------------
// Decision loop
// ---------------------------------------------------------------------------
const tracker = new BattleTracker('p1');
let lastRequestHash = '';
let auto = false;
let loopBusy = false;

const status = {
	state: 'starting',
	reason: 'starting…',
	battleId: '',
	turn: 0,
	requestType: '',
	choice: '',
	candidates: [],
	best: null,
	auto: false,
	errors: [],
	updatedAt: 0,
};

function requestHash(req) {
	try {
		return JSON.stringify({
			rqid: req.rqid,
			type: req.requestType,
			team: (req.side && req.side.pokemon || []).map(p =>
				`${p.ident}|${p.condition}`),
			active: (req.active || []).map(a => a &&
				a.moves.map(m => `${m.id}:${m.pp}:${!!m.disabled}`).join(',')),
		});
	} catch (e) {
		return String(Date.now());
	}
}

/** Adapt the client's BattleRequest to the shape decision-core expects. */
function adaptRequest(request) {
	const req = {
		wait: request.requestType === 'wait' || undefined,
		teamPreview: request.requestType === 'team' || undefined,
		forceSwitch: request.requestType === 'switch'
			? request.forceSwitch : undefined,
		active: request.requestType === 'move'
			? request.active : undefined,
		side: request.side,
	};
	return req;
}

async function decideOnce(snap) {
	const request = snap.request;
	tracker.seeRequest(adaptRequest(request));

	// Foe knowledge from the client's tracked public state.
	for (const fv of snap.foeView) {
		if (!fv.species) continue;
		const ident = `p2a: ${fv.name || fv.species}`;
		tracker.seeLine(`|switch|${ident}|${fv.species}, L${fv.level}|100/100`);
		for (const m of fv.moves || []) tracker.seeLine(`|move|${ident}|${m}`);
		if (fv.status) tracker.seeLine(`|-status|${ident}|${fv.status}`);
		if (fv.ability) tracker.seeLine(`|-ability|${ident}|${fv.ability}`);
		if (fv.item) tracker.seeLine(`|-item|${ident}|${fv.item}`);
	}
	tracker.turn = snap.turn;
	tracker._foeBoosts = (snap.foeView[0] && snap.foeView[0].boosts) || {};
	tracker._selfBoosts = (() => {
		const act = (snap.request.side && snap.request.side.pokemon || [])
			.find(p => p.active);
		return (act && act.boosts) || {};
	})();
	// Hazards on the foe's side (client tracks them; also fed via -sidestart).
	tracker._foeHazards = (() => {
		try {
			const room = null; // bridge packs it into snapshot below
			return snap.foeHazards || tracker._foeHazards || false;
		} catch (e) { return false; }
	})();

	if (request.requestType === 'team') {
		return { choice: 'default', candidates: [] };
	}
	if (request.requestType === 'switch') {
		const choice = core.decideForceSwitch(tracker,
			{ forceSwitch: request.forceSwitch, side: request.side });
		return { choice, candidates: [{ kind: 'switch', name: choice }] };
	}
	if (request.requestType === 'move') {
		return core.decideMove(tracker, adaptRequest(request));
	}
	return { choice: '', candidates: [] };
}

setInterval(async () => {
	if (loopBusy) return;
	loopBusy = true;
	try {
		const snap = await callBridge('getSnapshot');
		if (!snap) {
			status.state = 'nobattle';
			status.reason = 'bridge not responding — reload the Showdown tab';
			return;
		}
		if (!snap.connected) {
			status.state = 'nobattle';
			status.reason = snap.reason || 'no active battle on this tab';
			status.battleId = '';
			return;
		}
		status.battleId = snap.battleId;
		status.turn = snap.turn;
		status.requestType = snap.requestType || '';

		if (!snap.hasRequest) {
			status.state = 'waiting';
			status.reason = snap.reason || 'battle found · waiting for a decision point';
			return;
		}
		const h = requestHash(snap.request);
		if (h !== lastRequestHash) {
			lastRequestHash = h;
			const { choice, candidates, best } = await decideOnce(snap);
			Object.assign(status, {
				state: choice ? 'ready' : 'waiting',
				reason: choice ? '' : 'no legal action found for this request',
				choice, candidates, best, auto, updatedAt: Date.now(),
			});
			if (auto && choice && choice !== 'default') {
				const res = await callBridge('sendChoice', { choice }, 1500);
				if (!res || !res.ok) {
					status.errors.push(`send failed: ${res && res.error}`);
					if (status.errors.length > 20) status.errors.shift();
				}
			} else if (auto && choice === 'default') {
				await callBridge('sendChoice', { choice: 'default' }, 1500);
			}
		} else if (status.state !== 'ready') {
			status.state = 'ready';
		}
	} catch (e) {
		status.state = 'error';
		status.reason = `error: ${e.message}`;
	} finally {
		loopBusy = false;
		updateOverlay(status);
	}
}, 700);

// ---------------------------------------------------------------------------
// Overlay tab + popup messaging API
// ---------------------------------------------------------------------------
const updateOverlay = overlay.mount(v => {
	auto = v;
	status.auto = auto;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (!msg || !msg.type) return;
	if (msg.type === 'psab-get-status') {
		status.auto = auto;
		sendResponse(status);
	} else if (msg.type === 'psab-set-autoplay') {
		auto = !!msg.value;
		status.auto = auto;
		sendResponse(status);
	}
});

console.info('[PSAB] brain v3 ready');
