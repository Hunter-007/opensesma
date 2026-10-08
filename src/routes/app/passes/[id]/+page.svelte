<script lang="ts">
	import { enhance } from '$app/forms';
	import { PASS_TYPE_LABEL } from '$lib/shared/types';
	import { formatDateTime, formatSchedule } from '$lib/shared/format';
	import { formatPhone } from '$lib/shared/phone';
	let { data } = $props();
	const p = $derived(data.pass);
	const tz = $derived(data.estate.timeZone);

	let copied = $state(false);
	let confirming = $state(false);
	let canShare = $state(false);
	$effect(() => {
		canShare = 'share' in navigator;
	});
	const wa = $derived(`https://wa.me/${p.phone ? p.phone.replace('+', '') : ''}?text=${encodeURIComponent(data.message)}`);
	const sms = $derived(`sms:${p.phone ?? ''}?&body=${encodeURIComponent(data.message)}`);

	async function nativeShare() {
		try {
			await navigator.share({ title: 'Gate pass', text: data.message });
		} catch {
			/* user cancelled */
		}
	}
	async function copy() {
		await navigator.clipboard.writeText(data.message);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
	const kindLabel = { entry: 'Came in', exit: 'Left', deny: 'Turned away', override: 'Let in without pass' } as const;
</script>

<svelte:head><title>{p.name || PASS_TYPE_LABEL[p.type]} · OpenSesma</title></svelte:head>

<div class="stack">
	{#if data.isNew}<p class="alert ok">Pass created. Send it to {p.name ? p.name.split(' ')[0] : 'your visitor'} now.</p>{/if}

	<section class="pass card" class:dead={!p.live}>
		<div class="spread">
			<span class="chip">{PASS_TYPE_LABEL[p.type]}</span>
			{#if p.status === 'revoked'}<span class="chip deny">Cancelled</span>
			{:else if !p.live}<span class="chip">Finished</span>
			{:else}<span class="chip allow">Active</span>{/if}
		</div>
		<h1>{p.name || 'Delivery rider'}</h1>
		{#if p.purpose}<p class="muted">{p.purpose}</p>{/if}
		<div class="code"><span class="plate">{p.code.slice(0, 3)} {p.code.slice(3)}</span></div>
		<div class="qr" aria-label="QR code for the pass">{@html data.qr}</div>
		<dl>
			<dt>Valid</dt>
			<dd>
				{#if p.schedule}{formatSchedule(p.schedule)}{:else}{formatDateTime(p.validFrom, tz)}{p.validTo ? ` – ${formatDateTime(p.validTo, tz)}` : ''}{/if}
			</dd>
			<dt>Entries</dt>
			<dd>{p.maxEntries === 0 ? `Unlimited (${p.entriesUsed} so far)` : `${p.entriesUsed} of ${p.maxEntries} used`}</dd>
			{#if p.phone}<dt>Phone</dt><dd>{formatPhone(p.phone)}</dd>{/if}
		</dl>
	</section>

	{#if p.live}
		<section class="share stack">
			<a class="btn primary block wa" href={wa} target="_blank" rel="noopener">Send on WhatsApp</a>
			<div class="row">
				<a class="btn" href={sms}>Send by SMS</a>
				{#if canShare}<button class="btn" onclick={nativeShare}>Share…</button>{/if}
				<button class="btn" onclick={copy}>{copied ? 'Copied' : 'Copy message'}</button>
			</div>
		</section>
	{/if}

	{#if data.events.length}
		<section class="stack">
			<h2>Gate activity</h2>
			<ul class="list">
				{#each data.events as e (e.id)}
					<li class="spread">
						<span>{kindLabel[e.kind]}{e.guard ? ` · ${e.guard}` : ''}</span>
						<span class="small muted">{formatDateTime(e.at, tz)}{e.offline ? ' · recorded offline' : ''}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if p.status === 'active' && p.live}
		{#if confirming}
			<form method="POST" action="?/revoke" use:enhance class="card stack">
				<p>Cancel this pass? The code stops working at the gate within a minute.</p>
				<div class="row">
					<button class="btn danger">Cancel pass</button>
					<button type="button" class="btn ghost" onclick={() => (confirming = false)}>Keep it</button>
				</div>
			</form>
		{:else}
			<button class="btn ghost danger" onclick={() => (confirming = true)}>Cancel this pass</button>
		{/if}
	{/if}
</div>

<style>
	.pass {
		text-align: center;
		display: grid;
		gap: 8px;
	}
	.pass.dead {
		opacity: 0.7;
	}
	.pass h1 {
		margin: 8px 0 0;
	}
	.code .plate {
		font-size: 2.6rem;
		padding: 4px 18px;
	}
	.qr {
		width: min(240px, 70vw);
		margin: 4px auto;
		border-radius: 8px;
		overflow: hidden;
	}
	.qr :global(svg) {
		display: block;
		width: 100%;
		height: auto;
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 4px 16px;
		text-align: left;
		margin: 8px 0 0;
	}
	dt {
		color: var(--muted);
	}
	dd {
		margin: 0;
	}
	.wa {
		background: #1f8a4c;
		border-color: #1f8a4c;
	}
	.share .row .btn {
		flex: 1;
	}
</style>
