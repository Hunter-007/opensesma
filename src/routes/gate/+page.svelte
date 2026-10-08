<script lang="ts">
	import { onMount } from 'svelte';
	import { GateEngine, type CheckResult } from '$lib/client/gate/engine';
	import type { LocalEvent } from '$lib/client/gate/store';
	import Keypad from '$lib/components/gate/Keypad.svelte';
	import Scanner from '$lib/components/gate/Scanner.svelte';
	import { PASS_TYPE_LABEL, OVERRIDE_REASONS } from '$lib/shared/types';
	import { formatTime, relativeTime } from '$lib/shared/format';
	import { formatPhone } from '$lib/shared/phone';

	type View = 'loading' | 'enroll' | 'shift' | 'home' | 'scan' | 'code' | 'result' | 'inside' | 'walkin' | 'waiting' | 'override' | 'removed';

	const engine = new GateEngine();
	let view = $state<View>('loading');
	let online = $state(true);
	let syncing = $state(false);
	let lastSync = $state<number | null>(null);
	let pending = $state(0);
	let insideCount = $state(0);
	let now = $state(Date.now());
	let toast = $state<{ text: string; tone: 'ok' | 'error' } | null>(null);

	// per-view state
	let enrollCode = $state('');
	let enrollError = $state('');
	let busy = $state(false);
	let shiftGuard = $state('');
	let pin = $state('');
	let pinError = $state('');
	let code = $state('');
	let result = $state<CheckResult | null>(null);
	let scanError = $state('');
	let inside = $state<LocalEvent[]>([]);
	let walk = $state({ unitId: '', name: '', phone: '', purpose: '' });
	let unitQuery = $state('');
	let walkError = $state('');
	let waiting = $state<{ id: string; unitLabel: string; status: string; by: string | null; note: string; timedOut: boolean; smsSent: boolean; calls: string[] } | null>(null);
	let ov = $state({ reason: '', other: '', name: '', unitId: '' });

	// Snapshots of the engine's state; `pull()` refreshes them after anything changes.
	let estate = $state(engine.estate);
	let guard = $state(engine.guard);
	let guards = $state(engine.guards);
	let units = $state(engine.units);
	let lastSyncMeta = $state<number | null>(null);
	const stale = $derived(lastSyncMeta === null || now - lastSyncMeta > (estate?.staleSyncHours ?? 6) * 3_600_000);
	function pull() {
		estate = engine.estate;
		guard = engine.guard;
		guards = engine.guards;
		units = engine.units;
		lastSyncMeta = engine.meta.lastSyncAt;
	}
	const unitMatches = $derived(
		unitQuery.trim().length < 1 ? units.slice(0, 8) : units.filter((u) => u.label.toLowerCase().includes(unitQuery.trim().toLowerCase())).slice(0, 8)
	);
	const purposes = ['Visitor', 'Delivery', 'Artisan', 'Domestic staff', 'Driver', 'Other'];

	function flash(text: string, tone: 'ok' | 'error' = 'ok') {
		toast = { text, tone };
		setTimeout(() => (toast = null), 2500);
	}

	async function refresh() {
		pending = await engine.pendingCount();
		insideCount = (await engine.insideNow()).length;
		lastSync = engine.meta.lastSyncAt;
		pull();
	}

	async function syncNow(manual = false) {
		if (!engine.enrolled || syncing) return;
		syncing = true;
		const r = await engine.sync();
		syncing = false;
		if (!r.ok && r.error === 'device_removed') {
			view = 'removed';
			return;
		}
		if (manual) flash(r.ok ? 'Up to date' : 'No connection. Working offline.', r.ok ? 'ok' : 'error');
		await refresh();
		if (view === 'shift' && engine.guard) view = 'home';
		if (view === 'home' && !engine.guard) view = 'shift';
	}

	let wakeLock: { release: () => Promise<void> } | null = null;
	async function keepAwake() {
		try {
			wakeLock = await (navigator as unknown as { wakeLock: { request: (t: string) => Promise<typeof wakeLock> } }).wakeLock.request('screen');
		} catch {
			/* not supported or battery saver */
		}
	}

	onMount(() => {
		online = navigator.onLine;
		const on = () => {
			online = true;
			syncNow();
		};
		const off = () => (online = false);
		addEventListener('online', on);
		addEventListener('offline', off);
		const vis = () => document.visibilityState === 'visible' && (keepAwake(), syncNow());
		document.addEventListener('visibilitychange', vis);
		const clock = setInterval(() => (now = Date.now()), 15_000);
		const poll = setInterval(() => navigator.onLine && syncNow(), 60_000);

		(async () => {
			await engine.load();
			if (!engine.enrolled) view = 'enroll';
			else {
				view = engine.guard ? 'home' : 'shift';
				await refresh();
				syncNow();
			}
			keepAwake();
		})();

		return () => {
			removeEventListener('online', on);
			removeEventListener('offline', off);
			document.removeEventListener('visibilitychange', vis);
			clearInterval(clock);
			clearInterval(poll);
			wakeLock?.release().catch(() => {});
		};
	});

	// ------------------------------------------------------------ actions

	async function enroll(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		enrollError = '';
		try {
			await engine.enroll(enrollCode);
			await refresh();
			view = 'shift';
		} catch (err) {
			enrollError = (err as Error).message;
		}
		busy = false;
	}

	async function startShift(p: string) {
		pinError = '';
		if (await engine.startShift(shiftGuard, p)) {
			pin = '';
			view = 'home';
			pull();
		} else {
			pin = '';
			pinError = 'Wrong PIN. Try again.';
			navigator.vibrate?.(200);
		}
	}

	async function endShift() {
		await engine.endShift();
		shiftGuard = '';
		pull();
		view = 'shift';
	}

	function show(r: CheckResult) {
		result = r;
		view = 'result';
		navigator.vibrate?.(r.allow ? 80 : [200, 80, 200]);
	}

	async function onScan(text: string) {
		show(await engine.checkScan(text));
	}

	async function submitCode(c: string) {
		const r = await engine.checkCode(c);
		code = '';
		show(r);
	}

	async function admit() {
		if (!result) return;
		await engine.checkIn(result);
		flash(`${result.claims?.name || 'Visitor'} checked in`);
		result = null;
		view = 'home';
		await refresh();
		syncNow();
	}

	async function refuse() {
		if (result?.claims || result?.reason) {
			await engine.record({
				kind: 'deny',
				method: result.method,
				passId: result.claims?.id ?? null,
				unitId: result.claims?.unitId ?? null,
				passType: result.claims?.type ?? null,
				visitorName: result.claims?.name ?? '',
				reason: result.reason ?? ''
			});
		}
		result = null;
		view = 'home';
		await refresh();
		syncNow();
	}

	function askResidentFromResult() {
		walk = { unitId: result?.unit?.id ?? '', name: result?.claims?.name ?? '', phone: '', purpose: result?.claims ? PASS_TYPE_LABEL[result.claims.type] : '' };
		unitQuery = result?.unit?.label ?? '';
		result = null;
		view = 'walkin';
	}

	async function openInside() {
		inside = await engine.insideNow();
		view = 'inside';
	}

	async function checkOut(e: LocalEvent) {
		await engine.record({ kind: 'exit', method: 'manual', passId: e.passId, unitId: e.unitId, passType: e.passType, visitorName: e.visitorName });
		inside = await engine.insideNow();
		flash(`${e.visitorName || 'Visitor'} checked out`);
		await refresh();
		syncNow();
	}

	function startWalkin() {
		walk = { unitId: '', name: '', phone: '', purpose: '' };
		unitQuery = '';
		walkError = '';
		view = 'walkin';
	}

	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	async function sendWalkin(e: SubmitEvent) {
		e.preventDefault();
		walkError = '';
		if (!walk.unitId) return (walkError = 'Choose the house they are visiting');
		if (!walk.name.trim()) return (walkError = "Enter the visitor's name");
		if (!navigator.onLine) return (walkError = 'offline');
		busy = true;
		try {
			const r = await engine.requestWalkin({ unitId: walk.unitId, visitorName: walk.name, visitorPhone: walk.phone || undefined, purpose: walk.purpose || undefined });
			waiting = { id: r.id, unitLabel: r.unitLabel, status: 'pending', by: null, note: '', timedOut: false, smsSent: false, calls: [] };
			view = 'waiting';
			pollWalkin();
		} catch (err) {
			walkError = (err as Error).message;
		}
		busy = false;
	}

	async function pollWalkin() {
		if (!waiting || view !== 'waiting') return;
		try {
			const s = await engine.pollWalkin(waiting.id);
			waiting = { ...waiting, status: s.status, by: s.decidedByName, note: s.note, timedOut: s.timedOut, smsSent: s.smsSent, calls: s.callNumbers };
			if (s.status === 'approved' && s.pass) {
				navigator.vibrate?.(80);
				const r = await engine.checkScan(s.pass.token);
				r.method = 'walkin';
				r.warnings.unshift(`Approved by ${s.decidedByName ?? 'resident'}${s.note ? `: “${s.note}”` : ''}`);
				show(r);
				return;
			}
			if (s.status === 'denied') {
				navigator.vibrate?.([200, 80, 200]);
				return;
			}
			if (s.status === 'expired') return;
		} catch {
			/* keep trying */
		}
		pollTimer = setTimeout(pollWalkin, 3000);
	}

	function leaveWaiting() {
		if (pollTimer) clearTimeout(pollTimer);
		if (waiting?.status === 'denied') {
			engine.record({ kind: 'deny', method: 'walkin', unitId: walk.unitId, visitorName: walk.name, reason: 'Declined by resident' }).then(refresh);
		}
		waiting = null;
		view = 'home';
	}

	async function doOverride(e: SubmitEvent) {
		e.preventDefault();
		const reason = ov.reason === 'Other' ? `Other: ${ov.other.trim()}` : ov.reason;
		if (!ov.reason || (ov.reason === 'Other' && !ov.other.trim()) || !ov.name.trim()) return;
		await engine.record({ kind: 'override', method: 'override', unitId: ov.unitId || null, visitorName: ov.name.trim(), reason });
		ov = { reason: '', other: '', name: '', unitId: '' };
		flash('Override recorded. The estate manager has been told.');
		view = 'home';
		await refresh();
		syncNow();
	}

	function pickUnit(id: string, label: string) {
		walk.unitId = id;
		unitQuery = label;
	}
	const selectedUnit = $derived(units.find((u) => u.id === walk.unitId) ?? null);
</script>

<svelte:head>
	<title>Gate · OpenSesma</title>
	<meta name="theme-color" content="#0E4D35" />
</svelte:head>

<div class="console">
	{#if estate && view !== 'enroll' && view !== 'removed'}
		<header class="bar">
			<div>
				<div class="gate-name">{estate.gateName}</div>
				<div class="small">{estate.name}{guard ? ` · ${guard.name}` : ''}</div>
			</div>
			<button class="status" class:off={!online} class:stale onclick={() => syncNow(true)} disabled={syncing}>
				{#if syncing}Syncing…
				{:else if !online}Offline{pending ? ` · ${pending} to send` : ''}
				{:else if stale}Not synced {lastSync ? relativeTime(lastSync, now) : 'yet'}
				{:else}Online{pending ? ` · ${pending} to send` : ''}{/if}
			</button>
		</header>
	{/if}

	<main>
		{#if view === 'loading'}
			<p class="center muted">Opening gate console…</p>
		{:else if view === 'enroll' || view === 'removed'}
			<form class="panel stack" onsubmit={enroll}>
				<p class="brand">OpenSesma gate</p>
				{#if view === 'removed'}
					<p class="alert error">This phone was removed by the estate manager. Enter a new setup code to use it again.</p>
				{/if}
				<h1>Set up this gate phone</h1>
				<p class="muted">The estate manager gets a setup code under Admin → Gate phones. You only do this once; after that the console works even without internet.</p>
				<label class="field">
					<span>Setup code</span>
					<input bind:value={enrollCode} type="text" autocapitalize="characters" autocomplete="off" placeholder="K7QM-3XPA" class="codeinput" required />
				</label>
				{#if enrollError}<p class="alert error">{enrollError}</p>{/if}
				<button class="btn primary block big" disabled={busy}>{busy ? 'Setting up…' : 'Set up phone'}</button>
				<p class="small muted">Not a guard? <a href="/login">Residents sign in here.</a></p>
			</form>
		{:else if view === 'shift'}
			<div class="panel stack">
				<h1>Start your shift</h1>
				{#if !guards.length}
					<p class="alert warn">No guards are set up yet. The estate manager adds guards and their PINs under Admin → People. Then tap Sync above.</p>
				{:else if !shiftGuard}
					<p class="muted">Tap your name.</p>
					<div class="guards">
						{#each guards as g (g.id)}
							<button class="btn block big" onclick={() => (shiftGuard = g.id)}>{g.name}</button>
						{/each}
					</div>
				{:else}
					<p><strong>{guards.find((g) => g.id === shiftGuard)?.name}</strong>, enter your PIN</p>
					<Keypad length={4} bind:value={pin} onsubmit={startShift} label="PIN" mask />
					{#if pinError}<p class="alert error">{pinError}</p>{/if}
					<button class="btn ghost" onclick={() => ((shiftGuard = ''), (pin = ''), (pinError = ''))}>Not me</button>
				{/if}
			</div>
		{:else if view === 'home'}
			<div class="home">
				<button class="big-action scan" onclick={() => ((scanError = ''), (view = 'scan'))}>
					<span class="label">Scan QR</span><span class="hint">Visitor shows their pass</span>
				</button>
				<button class="big-action code" onclick={() => ((code = ''), (view = 'code'))}>
					<span class="label">Enter code</span><span class="hint">6 digits, no smartphone needed</span>
				</button>
				<div class="pair">
					<button class="mid-action" onclick={startWalkin}>
						<span class="label">Walk-in</span><span class="hint">Ask the resident</span>
					</button>
					<button class="mid-action" onclick={openInside}>
						<span class="label">Inside now</span><span class="hint">{insideCount} visitor{insideCount === 1 ? '' : 's'}</span>
					</button>
				</div>
				<div class="foot">
					<button class="btn ghost sm" onclick={() => (view = 'override')}>Override entry</button>
					<button class="btn ghost sm" onclick={endShift}>End shift</button>
				</div>
			</div>
		{:else if view === 'scan'}
			<div class="panel stack">
				<h1 class="sr-only">Scan QR</h1>
				{#if scanError}
					<p class="alert error">{scanError}</p>
					<button class="btn primary block big" onclick={() => ((code = ''), (view = 'code'))}>Enter code instead</button>
				{:else}
					<Scanner ondetect={onScan} onerror={(m) => (scanError = m)} />
					<p class="center muted">Point the camera at the visitor's QR code</p>
				{/if}
				<button class="btn block" onclick={() => (view = 'home')}>Back</button>
			</div>
		{:else if view === 'code'}
			<div class="panel stack">
				<h1 class="center">Enter the visitor's code</h1>
				<Keypad bind:value={code} onsubmit={submitCode} />
				<button class="btn block" onclick={() => (view = 'home')}>Back</button>
			</div>
		{:else if view === 'result' && result}
			<div class="result" class:allow={result.allow} class:deny={!result.allow}>
				<div class="verdict">
					<span class="mark" aria-hidden="true">{result.allow ? '✓' : '✕'}</span>
					<span class="word">{result.allow ? 'ALLOW' : 'DENY'}</span>
				</div>
				<div class="who">
					{#if result.claims}
						<div class="vname">{result.claims.name || (result.claims.type === 'delivery' ? 'Delivery rider' : 'Visitor')}</div>
						<div>{PASS_TYPE_LABEL[result.claims.type]}{result.pass?.purpose ? ` · ${result.pass.purpose}` : ''}</div>
						<div class="host">For <strong>{result.unit?.label ?? 'unknown house'}</strong></div>
					{/if}
					{#if !result.allow}<div class="reason">{result.message}</div>{/if}
					{#each result.warnings as w}<div class="warning">{w}</div>{/each}
				</div>
				<div class="actions">
					{#if result.allow}
						<button class="btn big primary-inv" onclick={admit}>Check in</button>
						<button class="btn big ghost-inv" onclick={refuse}>Don't let in</button>
					{:else}
						{#if result.unit && result.reason !== 'banned'}
							<button class="btn big primary-inv" onclick={askResidentFromResult}>Ask the resident</button>
						{/if}
						<button class="btn big ghost-inv" onclick={refuse}>Done</button>
					{/if}
				</div>
			</div>
		{:else if view === 'inside'}
			<div class="panel stack">
				<div class="spread"><h1>Inside now</h1><button class="btn sm" onclick={() => (view = 'home')}>Back</button></div>
				{#if !inside.length}
					<p class="muted">Nobody checked in during the last 24 hours is still inside.</p>
				{:else}
					<ul class="list">
						{#each inside as e (e.id)}
							<li class="spread">
								<span>
									<strong>{e.visitorName || 'Visitor'}</strong><br />
									<span class="small muted">{engine.unit(e.unitId)?.label ?? ''} · in at {formatTime(e.deviceTs, estate?.timeZone)}{e.kind === 'override' ? ' · override' : ''}</span>
								</span>
								<button class="btn sm" onclick={() => checkOut(e)}>Check out</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{:else if view === 'walkin'}
			<form class="panel stack" onsubmit={sendWalkin}>
				<div class="spread"><h1>Walk-in visitor</h1><button type="button" class="btn sm" onclick={() => (view = 'home')}>Back</button></div>
				<label class="field">
					<span>Which house?</span>
					<input type="search" bind:value={unitQuery} oninput={() => (walk.unitId = '')} placeholder="House number or street" autocomplete="off" />
				</label>
				{#if !walk.unitId}
					<div class="units">
						{#each unitMatches as u (u.id)}
							<button type="button" class="btn sm" onclick={() => pickUnit(u.id, u.label)}>{u.label}</button>
						{/each}
					</div>
				{/if}
				<label class="field"><span>Visitor's name</span><input type="text" bind:value={walk.name} autocomplete="off" required /></label>
				<fieldset>
					<legend>Reason</legend>
					<div class="units">
						{#each purposes as p}
							<button type="button" class="btn sm" class:chosen={walk.purpose === p} onclick={() => (walk.purpose = p)}>{p}</button>
						{/each}
					</div>
				</fieldset>
				<label class="field"><span>Visitor's phone (optional)</span><input type="tel" inputmode="tel" bind:value={walk.phone} /></label>
				{#if walkError === 'offline'}
					<div class="alert warn">
						No internet at the gate, so the resident can't be asked in the app.
						{#if selectedUnit?.phone}<br /><a class="btn primary" href="tel:{selectedUnit.phone}">Call {selectedUnit.label} · {formatPhone(selectedUnit.phone)}</a>{/if}
					</div>
				{:else if walkError}
					<p class="alert error">{walkError}</p>
				{/if}
				<button class="btn primary block big" disabled={busy}>{busy ? 'Sending…' : 'Ask resident'}</button>
			</form>
		{:else if view === 'waiting' && waiting}
			<div class="panel stack center-text">
				<h1>Waiting for {waiting.unitLabel}</h1>
				{#if waiting.status === 'pending'}
					<div class="pulse" aria-hidden="true"></div>
					<p>We've sent the request to the household{waiting.smsSent ? ' and texted them' : ''}.</p>
					{#if waiting.timedOut}
						<p class="alert warn">No answer yet. You can call them:</p>
						{#each waiting.calls as c}<a class="btn block big" href="tel:{c}">Call {formatPhone(c)}</a>{/each}
					{/if}
				{:else if waiting.status === 'denied'}
					<p class="alert error"><strong>Declined</strong> by {waiting.by ?? 'the resident'}{waiting.note ? `: “${waiting.note}”` : ''}. Don't let them in.</p>
				{:else if waiting.status === 'expired'}
					<p class="alert warn">The request expired with no answer.</p>
				{/if}
				<button class="btn block" onclick={leaveWaiting}>{waiting.status === 'pending' ? 'Cancel' : 'Done'}</button>
			</div>
		{:else if view === 'override'}
			<form class="panel stack" onsubmit={doOverride}>
				<div class="spread"><h1>Override entry</h1><button type="button" class="btn sm" onclick={() => (view = 'home')}>Back</button></div>
				<p class="alert warn">Use this only when someone must enter without a pass. It is recorded with your name and the estate manager is told straight away.</p>
				<fieldset>
					<legend>Why?</legend>
					<div class="reasons">
						{#each OVERRIDE_REASONS as r}
							<label class="reason-opt" class:chosen={ov.reason === r}><input type="radio" name="reason" value={r} bind:group={ov.reason} /> {r}</label>
						{/each}
					</div>
				</fieldset>
				{#if ov.reason === 'Other'}<label class="field"><span>Explain</span><input type="text" bind:value={ov.other} required /></label>{/if}
				<label class="field"><span>Name of person entering</span><input type="text" bind:value={ov.name} required /></label>
				<label class="field">
					<span>House they're going to (optional)</span>
					<select bind:value={ov.unitId}><option value="">Not a particular house</option>{#each units as u (u.id)}<option value={u.id}>{u.label}</option>{/each}</select>
				</label>
				<button class="btn primary block big" disabled={!ov.reason || !ov.name.trim()}>Record override and let in</button>
			</form>
		{/if}
	</main>

	{#if toast}<div class="toast {toast.tone}" role="status">{toast.text}</div>{/if}
</div>

<style>
	.console {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--paper);
	}
	.bar {
		background: var(--gate);
		color: var(--gate-ink);
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		padding-top: calc(10px + env(safe-area-inset-top));
	}
	.gate-name {
		font-weight: 800;
		font-size: 1.125rem;
	}
	.small {
		font-size: 0.8125rem;
		opacity: 0.85;
	}
	.status {
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 700;
		border-radius: 999px;
		padding: 8px 12px;
		border: 0;
		background: #1fa463;
		color: #fff;
		white-space: nowrap;
	}
	.status.stale {
		background: var(--wait);
		color: #1d1600;
	}
	.status.off {
		background: #4b4b4b;
		color: #fff;
	}
	main {
		flex: 1;
		width: 100%;
		max-width: 520px;
		margin: 0 auto;
		padding: 16px;
	}
	.panel h1 {
		font-size: 1.35rem;
	}
	.brand {
		font-weight: 800;
		color: var(--gate);
	}
	.center {
		text-align: center;
	}
	.center-text {
		text-align: center;
	}
	.codeinput {
		font-family: var(--font-plate);
		font-size: 1.6rem;
		letter-spacing: 0.15em;
		text-transform: uppercase;
		text-align: center;
	}
	.btn.big {
		min-height: 60px;
		font-size: 1.125rem;
	}
	.guards {
		display: grid;
		gap: 8px;
	}

	/* home */
	.home {
		display: grid;
		gap: 12px;
	}
	.big-action,
	.mid-action {
		display: grid;
		gap: 2px;
		align-content: center;
		text-align: left;
		border: 0;
		border-radius: var(--r-lg);
		padding: 20px;
		font: inherit;
		cursor: pointer;
		touch-action: manipulation;
	}
	.big-action {
		min-height: 120px;
	}
	.big-action .label {
		font-size: 1.75rem;
		font-weight: 800;
	}
	.big-action.scan {
		background: var(--gate);
		color: var(--gate-ink);
	}
	.big-action.code {
		background: var(--plate);
		color: var(--plate-ink);
	}
	.hint {
		font-size: 0.9375rem;
		opacity: 0.85;
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.mid-action {
		min-height: 96px;
		background: var(--card);
		color: var(--ink);
		border: 1px solid var(--line);
	}
	.mid-action .label {
		font-size: 1.25rem;
		font-weight: 800;
	}
	.foot {
		display: flex;
		justify-content: space-between;
	}

	/* result */
	.result {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		padding: 24px 20px calc(20px + env(safe-area-inset-bottom));
		color: #fff;
		z-index: 20;
	}
	.result.allow {
		background: var(--allow);
	}
	.result.deny {
		background: var(--deny);
	}
	.verdict {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-top: 8vh;
	}
	.mark {
		font-size: 4.5rem;
		line-height: 1;
		font-weight: 900;
	}
	.word {
		font-size: 3.25rem;
		font-weight: 900;
		letter-spacing: 0.04em;
	}
	.who {
		margin-top: 24px;
		font-size: 1.125rem;
		display: grid;
		gap: 6px;
	}
	.vname {
		font-size: 2rem;
		font-weight: 800;
		line-height: 1.15;
	}
	.host {
		margin-top: 6px;
	}
	.reason {
		font-size: 1.375rem;
		font-weight: 700;
		margin-top: 12px;
	}
	.warning {
		background: rgba(0, 0, 0, 0.22);
		border-radius: 8px;
		padding: 8px 12px;
		font-weight: 600;
	}
	.actions {
		margin-top: auto;
		display: grid;
		gap: 10px;
	}
	.primary-inv {
		background: #fff;
		color: var(--ink);
		border-color: #fff;
	}
	.ghost-inv {
		background: transparent;
		color: #fff;
		border-color: rgba(255, 255, 255, 0.6);
	}

	/* walk-in */
	.units {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chosen {
		background: var(--gate);
		color: var(--gate-ink);
		border-color: var(--gate);
	}
	.reasons {
		display: grid;
		gap: 6px;
	}
	.reason-opt {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 52px;
		padding: 0 14px;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		background: var(--card);
		font-weight: 600;
	}
	.reason-opt input {
		width: 20px;
		height: 20px;
	}
	.pulse {
		width: 64px;
		height: 64px;
		margin: 16px auto;
		border-radius: 50%;
		background: var(--wait);
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		0%,
		100% {
			transform: scale(0.85);
			opacity: 0.6;
		}
		50% {
			transform: scale(1);
			opacity: 1;
		}
	}
	.toast {
		position: fixed;
		left: 16px;
		right: 16px;
		bottom: calc(16px + env(safe-area-inset-bottom));
		max-width: 488px;
		margin: 0 auto;
		padding: 14px 16px;
		border-radius: var(--r);
		font-weight: 600;
		background: var(--ink);
		color: var(--paper);
		z-index: 30;
	}
	.toast.error {
		background: var(--deny);
		color: #fff;
	}
</style>
