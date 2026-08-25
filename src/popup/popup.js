/**
 * popup.js -- browser-action popup.
 *
 * Opens only when the toolbar icon is clicked. Pulls current status from the
 * active tab's content script; if this isn't a battle tab it says so and
 * offers nothing else.
 */
'use strict';

const listEl = document.getElementById('list');
const stateEl = document.getElementById('state');
const adviceEl = document.getElementById('advice');
const turnEl = document.getElementById('turn');
const autoEl = document.getElementById('autoplay');

document.getElementById('ver').textContent = 'v' +
  chrome.runtime.getManifest().version;

async function activeTab() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	return tab || null;
}

function render(status) {
	if (!status) {
		stateEl.textContent = 'no battle brain on this tab';
		adviceEl.hidden = true;
		autoEl.parentElement.style.display = 'none';
		return;
	}
	autoEl.checked = !!status.auto;
	if (!status.ok) {
		stateEl.textContent = status.reason || 'waiting for a decision…';
		adviceEl.hidden = true;
		return;
	}
	stateEl.textContent = `active · best: ${bestLabel(status.best, status.choice)}`;
	adviceEl.hidden = false;
	turnEl.textContent = `· turn ${status.turn}`;
	listEl.innerHTML = '';
	for (const c of status.candidates) {
		const li = document.createElement('li');
		const isBest = c === status.best ||
			(status.best && c.kind === status.best.kind && c.slot === status.best.slot);
		li.className = isBest ? 'best' : '';
		const label = c.kind === 'switch'
			? `⇄ ${c.name || c.id} (slot ${c.slot})`
			: `${c.name || c.id}${c.dmg != null ? ` · ~${Math.round(c.dmg)}%` : ''}`;
		const score = document.createElement('b');
		score.textContent = (c.score ?? 0).toFixed(1);
		li.append(document.createTextNode(label));
		li.appendChild(score);
		listEl.appendChild(li);
	}
}

function bestLabel(best, choice) {
	if (best) return best.name || best.id || choice;
	return choice || '…';
}

async function refresh() {
	const tab = await activeTab();
	if (!tab || !tab.id ||
		!/^https:\/\/([a-z0-9-]+\.)?pokemonshowdown\.com\//.test(tab.url || '')) {
		render(null);
		return;
	}
	let status = null;
	try {
		status = await chrome.tabs.sendMessage(tab.id, { type: 'psab-get-status' });
	} catch (e) {
		status = { ok: false, reason: 'reload the Showdown tab to activate the bot' };
	}
	render(status);
}

autoEl.addEventListener('change', async () => {
	const tab = await activeTab();
	if (!tab || !tab.id) return;
	try {
		await chrome.tabs.sendMessage(tab.id, {
			type: 'psab-set-autoplay', value: autoEl.checked,
		});
	} catch (e) { /* content script not present */ }
});

refresh();
