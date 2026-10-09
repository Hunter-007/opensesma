<script lang="ts">
	import { formatDateTime, relativeTime } from '$lib/shared/format';
	import PushPrompt from '$lib/components/PushPrompt.svelte';
	let { data } = $props();
	const tz = $derived(data.estate.timeZone);
	const steps = $derived([
		{ done: data.setup.units > 0, label: 'Add the houses', href: '/admin/units', hint: 'Upload a spreadsheet or add them one by one, then send each resident their invite on WhatsApp.' },
		{ done: data.setup.guards > 0, label: 'Add your guards', href: '/admin/people', hint: 'Each guard gets a 6-digit PIN for the gate phone.' },
		{ done: data.setup.devices > 0, label: 'Set up the gate phones', href: '/admin/devices', hint: 'One phone per gate. Open /gate on it and enter the setup code.' },
		data.smsLogin
			? { done: data.setup.residents > 0, label: 'Get residents on board', href: '/admin/settings#join', hint: 'Share the join link in the estate WhatsApp group.' }
			: { done: data.setup.residents > 0, label: 'Get residents on board', href: '/admin/units', hint: 'Send each resident their invite from Houses on WhatsApp or by text.' }
	]);
	const setupDone = $derived(steps.every((s) => s.done));
</script>

<svelte:head><title>Overview · OpenSesma admin</title></svelte:head>

<div class="stack">
	<h1>Overview</h1>

	{#if data.demo}
		<section class="card stack">
			<h2>Try it out with the test house</h2>
			<ol class="steps">
				<li><strong>Resident:</strong> go to <a href="/admin/people">People</a>, tap <em>Sign-in link</em> next to Ada Test, and send it to a second phone (or open it in a private browser window). Tap <em>Sign in</em>, then create a pass and send it on WhatsApp or by text.</li>
				<li><strong>Guard:</strong> go to <a href="/admin/devices">Gate phones</a> and tap <em>Add a phone for Main gate</em> to get a setup code. On another phone open <strong>{data.origin}/gate</strong>, enter the code, choose Test Guard and type the PIN you set. Then type the visitor's 8-digit code.</li>
				<li><strong>Manager:</strong> that's you, here. Watch entries appear under <a href="/admin/log">Gate log</a>.</li>
			</ol>
		</section>
	{/if}

	{#if !setupDone}
		<section class="card stack">
			<h2>{data.welcome ? 'Your estate is ready. Four steps to go live:' : 'Finish setting up'}</h2>
			<ol class="steps">
				{#each steps as s}
					<li class:done={s.done}>
						<a href={s.href}><strong>{s.label}</strong></a>
						{#if s.done}<span class="chip allow">Done</span>{/if}
						<div class="small muted">{s.hint}</div>
					</li>
				{/each}
			</ol>
		</section>
	{/if}

	<PushPrompt vapidKey={data.vapidKey} />

	<section class="tiles">
		<a class="tile" href="/admin/log"><span class="n">{data.entriesToday}</span><span class="l">entries today</span></a>
		<a class="tile" href="/admin/log?view=inside"><span class="n">{data.insideCount}</span><span class="l">visitors inside now</span></a>
		<a class="tile" class:alert-tile={data.overridesWeek > 0} href="/admin/log?method=override"><span class="n">{data.overridesWeek}</span><span class="l">overrides this week</span></a>
		<a class="tile" class:alert-tile={data.conflictsWeek > 0} href="/admin/log?flagged=1"><span class="n">{data.conflictsWeek}</span><span class="l">entries needing review</span></a>
		<a class="tile" class:alert-tile={data.pendingMembers > 0} href="/admin/people"><span class="n">{data.pendingMembers}</span><span class="l">join requests waiting</span></a>
		<a class="tile" href="/admin/units?dues=owing"><span class="n">{data.owing}</span><span class="l">houses owing dues</span></a>
	</section>

	<section class="stack">
		<h2>Gate phones</h2>
		{#if !data.devices.length}
			<p class="muted">No gate phones yet. <a href="/admin/devices">Set one up</a>.</p>
		{:else}
			<ul class="list">
				{#each data.devices as d (d.id)}
					<li class="spread">
						<span><strong>{d.gateName}</strong> <span class="small muted">· {d.name}</span></span>
						{#if !d.enrolled}<span class="chip wait">Not set up</span>
						{:else if d.online}<span class="chip allow">Online</span>
						{:else}<span class="chip deny">Last seen {d.lastSyncAt ? relativeTime(d.lastSyncAt) : 'never'}</span>{/if}
					</li>
				{/each}
			</ul>
			<p class="small muted">An offline gate phone still checks passes. It sends its log when the connection returns.</p>
		{/if}
	</section>

	{#if data.recentOverrides.length}
		<section class="stack">
			<h2>Recent overrides</h2>
			<ul class="list">
				{#each data.recentOverrides as o (o.id)}
					<li>
						<strong>{o.name || 'Unnamed'}</strong> — {o.reason}
						<div class="small muted">{o.guard || 'Unknown guard'} · {o.gate} · {formatDateTime(o.at, tz)}</div>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<style>
	.steps {
		margin: 0;
		padding-left: 1.25em;
		display: grid;
		gap: 10px;
	}
	.steps li.done a {
		color: var(--muted);
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: 10px;
	}
	.tile {
		display: grid;
		gap: 2px;
		padding: 14px 16px;
		border: 1px solid var(--line);
		border-radius: var(--r);
		background: var(--card);
		color: inherit;
		text-decoration: none;
	}
	.tile .n {
		font-size: 2rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}
	.tile .l {
		color: var(--muted);
		font-size: 0.875rem;
	}
	.tile.alert-tile .n {
		color: var(--deny);
	}
</style>
