<script lang="ts">
	import { formatTime } from '$lib/shared/format';
	let { data } = $props();
	const tz = $derived(data.estate.timeZone);
	const dayFmt = $derived(new Intl.DateTimeFormat('en-NG', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }));
	const groups = $derived.by(() => {
		const out: { day: string; items: typeof data.events }[] = [];
		for (const e of data.events) {
			const day = dayFmt.format(e.at);
			if (out.at(-1)?.day !== day) out.push({ day, items: [] });
			out.at(-1)!.items.push(e);
		}
		return out;
	});
	const verb = { entry: 'came in', exit: 'left', override: 'let in without a pass', deny: 'turned away' } as const;
</script>

<svelte:head><title>History · OpenSesma</title></svelte:head>

<div class="stack">
	<h1>Visitor history</h1>
	{#if !groups.length}
		<p class="muted">No visitors in the last 30 days. When someone uses one of your passes it shows up here.</p>
	{/if}
	{#each groups as g}
		<section class="stack">
			<h2 class="day">{g.day}</h2>
			<ul class="list">
				{#each g.items as e (e.id)}
					<li class="spread">
						<span>
							<strong>{e.name || 'Visitor'}</strong> {verb[e.kind]}
							{#if e.kind === 'override'}<br /><span class="small muted">Reason: {e.reason}</span>{/if}
						</span>
						<span class="small muted right">{formatTime(e.at, tz)}<br />{e.gate}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</div>

<style>
	.day {
		font-size: 0.9375rem;
		color: var(--muted);
		margin: 8px 0 0;
	}
	.right {
		text-align: right;
		flex: none;
	}
</style>
