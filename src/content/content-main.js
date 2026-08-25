/**
 * content-main.js -- isolated world content script (headless brain).
 *
 * Talks to the MAIN-world bridge via window.postMessage (JSON payloads;
 * objects don't survive cross-world CustomEvent.detail reliably).
 * Exposes status over chrome.runtime messaging for the toolbar popup.
 */
'use strict';

const core = require('../../vendor/ps-autobattler/src/decision-core');
const trackerMod = require('../../vendor/ps-autobattler/src/battle-state');
const { BattleTracker } = trackerMod;

// ---------------------------------------------------------------------------
// Bridge communication (postMessage to MAIN world)
// ---------------------------------------------------------------------------
const SRC_CONTENT = 'psab-content';
let msgReqId = 0;
const pending = new Map(); // reqId -> resolve

window.addEventListener('message', ev => {
	if (ev.source !== window) return;
	const msg = ev.data;
	if (!msg || msg.source !== 'psab-page') return;
	if (msg.type === 'snapshot' && pending.has(msg.reqId)) {
		const resolve = pending.get(msg.reqId);
		pending.delete(msg.reqId);
		try {
			resolve(JSON.parse(msg.payload));
		} catch (e) {
			resolve({ connected: false, reason: 'bad snapshot payload' });
		}
	}
});

function requestSnapshot(timeoutMs = 800) {
	return new Promise(resolve => {
		const reqId = ++msgReqId;
		pending.set(reqId, resolve);
		window.postMessage({ source: SRC_CONTENT, type: 'getSnapshot', reqId },
			window.location.origin);
		setTimeout(() => {
			if (pending.has(reqId)) {
				pending.delete(reqId);
				resolve(null); // bridge absent entirely
			}
		}, timeoutMs);
	});
}

function sendCommand(detail) {
	window.postMessage({ source: SRC_CONTENT, ...detail }, window.location.origin);
}

// ---------------------------------------------------------------------------
// Decision loop (silent)
// ---------------------------------------------------------------------------
const tracker = new BattleTracker('p1');
let lastRequestHash = '';
let auto = false;
let loopBusy = false;

const status = {
	state: 'starting',    // starting | nobattle | waiting | ready | error
	reason: 'starting…',
	turn: 0,
	choice: '',
	candidates: [],
	best: null,
	auto: false,
	updatedAt: 0,
};

function hashRequest(req) {
	return JSON.stringify(req && req.side ? req.side.pokemon.map(p => p.ident + p.condition) : '') +
		'|' + JSON.stringify(req ? (req.active || req.forceSwitch || '').toString().slice(0, 200) : '');
}

async function decideOnce(snap) {
	tracker.seeRequest(snap.request);
	for (const fv of snap.foeView) {
		if (!fv.species) continue;
		const ident = `p2a: ${fv.name || fv.species}`;
		tracker.seeLine(`|switch|${ident}|${fv.species}, L${fv.level}|100/100`);
		if (fv.moves) for (const m of fv.moves) tracker.seeLine(`|move|${ident}|${m}`);
		if (fv.status) tracker.seeLine(`|-status|${ident}|${fv.status}`);
		if (fv.ability) tracker.seeLine(`|-ability|${ident}|${fv.ability}`);
		if (fv.item) tracker.seeLine(`|-item|${ident}|${fv.item}`);
	}
	tracker.turn = snap.turn;

	const req = snap.request;
	if (req.teamPreview) return { choice: 'default', candidates: [] };
	if (req.forceSwitch) {
		const choice = core.decideForceSwitch(tracker, req);
		return { choice, candidates: [{ kind: 'switch', name: choice }] };
	}
	if (req.active) return core.decideMove(tracker, req);
	return { choice: 'default', candidates: [] };
}

async function act(choice) {
	const [kind, slotStr] = choice.split(' ');
	const slot = parseInt(slotStr, 10);
	if (kind === 'move' && Number.isFinite(slot)) sendCommand({ type: 'chooseMove', slot });
	else if (kind === 'switch' && Number.isFinite(slot)) sendCommand({ type: 'chooseSwitch', slot });
}

setInterval(async () => {
	if (loopBusy) return;
	loopBusy = true;
	try {
		const snap = await requestSnapshot();
		if (!snap) {
			status.state = 'nobattle';
			status.reason = 'no active battle on this tab';
			return;
		}
		if (!snap.connected) {
			status.state = 'nobattle';
			status.reason = snap.reason || 'no active battle on this tab';
			return;
		}
		status.turn = snap.turn;
		if (!snap.hasRequest || !snap.request) {
			status.state = 'waiting';
			status.reason = `battle found · turn ${snap.turn} · waiting for your decision point`;
			return;
		}
		const h = hashRequest(snap.request);
		if (h !== lastRequestHash) {
			lastRequestHash = h;
			const { choice, candidates, best } = await decideOnce(snap);
			Object.assign(status, {
				state: 'ready', reason: '', choice, candidates, best,
				auto, updatedAt: Date.now(),
			});
			if (auto && choice && choice !== 'default') await act(choice);
			else if (auto && choice === 'default') sendCommand({ type: 'chooseMove', slot: 1 });
		} else {
			status.state = 'ready';
		}
	} catch (e) {
		status.state = 'error';
		status.reason = `error: ${e.message}`;
	} finally {
		loopBusy = false;
	}
}, 700);

// ---------------------------------------------------------------------------
// Popup messaging API
// ---------------------------------------------------------------------------
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

console.info('[PSAB] headless brain ready (postMessage)');
