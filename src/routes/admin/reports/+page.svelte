<script lang="ts">
	import { PASS_TYPE_LABEL, type PassType } from '$lib/shared/types';
	let { data } = $props();
	const r = $derived(data.report);
	const maxHour = $derived(Math.max(1, ...r.byHour));
	const maxDay = $derived(Math.max(1, ...r.byDay.map((d) => d.count)));
	const total = $derived(r.byDay.reduce((s, d) => s + d.count, 0));
	const peak = $derived(r.byHour.indexOf(Math.max(...r.byHour)));
	const hourLabel = (h: number) => (h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`);
	const typeLabel = (t: string) => (t === 'override' ? 'Override' : t === 'walk-in' ? 'Walk-in' : (PASS_TYPE_LABEL[t as PassType] ?? t));
	const dayLabel = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric' });
</script>

<svelte:head><title>Reports · OpenSesma admin</title></svelte:head>

<div class="stack">
	<div class="spread">
		<h1>Reports</h1>
		<div class="row">
			<a class="btn sm" class:primary={data.days === 7} href="?days=7">7 days</a>
			<a class="btn sm" class:primary={data.days === 30} href="?days=30">30 days</a>
		</div>
	</div>

	<section class="card stack">
		<h2>{total} entries in the last {data.days} days{total ? `, busiest around ${hourLabel(peak)}` : ''}</h2>
		<div class="days" role="img" aria-label="Entries per day">
			{#each r.byDay as d}
				<div class="col" title="{d.count} entries">
					<div class="bar" style="height:{(d.count / maxDay) * 100}%"></div>
					<span class="n">{d.count}</span>
					{#if data.days === 7 || r.byDay.indexOf(d) % 5 === 0}<span class="lbl">{dayLabel(d.day)}</span>{:else}<span class="lbl"></span>{/if}
				</div>
			{/each}
		</div>
	</section>

	<section class="card stack">
		<h2>Entries by hour of day</h2>
		<p class="small muted">Use this to plan guard shifts.</p>
		<div class="hours" role="img" aria-label="Entries by hour">
			{#each r.byHour as n, h}
				<div class="col" title="{hourLabel(h)}: {n}">
					<div class="bar" class:peak={h === peak && n > 0} style="height:{(n / maxHour) * 100}%"></div>
					<span class="lbl">{h % 3 === 0 ? hourLabel(h) : ''}</span>
				</div>
			{/each}
		</div>
	</section>

	<div class="two">
		<section class="card stack">
			<h2>How people got in</h2>
			{#if !r.byType.length}<p class="muted">No entries yet.</p>{/if}
			{#each r.byType as [t, n]}
				<div class="hrow"><span>{typeLabel(t)}</span><span class="track"><span class="fill" style="width:{(n / Math.max(1, total)) * 100}%"></span></span><span class="num">{n}</span></div>
			{/each}
		</section>
		<section class="card stack">
			<h2>Walk-in approvals</h2>
			<p>
				<strong>{r.walkins.total}</strong> requests, <strong>{r.walkins.answered}</strong> answered{r.walkins.medianSeconds !== null ? `, half within ${r.walkins.medianSeconds < 90 ? Math.round(r.walkins.medianSeconds) + ' seconds' : Math.round(r.walkins.medianSeconds / 60) + ' minutes'}` : ''}.
			</p>
			<p class="small muted">{Math.round(r.offlineShare * 100)}% of gate activity was recorded while the gate was offline.</p>
			<h3>Overrides by guard</h3>
			{#if !r.overridesByGuard.length}<p class="small muted">None. Good.</p>{/if}
			{#each r.overridesByGuard as [g, n]}<div class="spread small"><span>{g}</span><strong>{n}</strong></div>{/each}
		</section>
	</div>
</div>

<style>
	.days,
	.hours {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
		gap: 4px;
		height: 180px;
		align-items: end;
	}
	.col {
		display: grid;
		grid-template-rows: 1fr auto auto;
		height: 100%;
		align-items: end;
		text-align: center;
		min-width: 0;
	}
	.bar {
		background: var(--gate-2);
		border-radius: 3px 3px 0 0;
		min-height: 2px;
		align-self: end;
	}
	.bar.peak {
		background: var(--plate);
		outline: 1px solid var(--plate-ink);
	}
	.n {
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--muted);
	}
	.lbl {
		font-size: 0.6875rem;
		color: var(--muted);
		white-space: nowrap;
		overflow: visible;
		height: 1.2em;
	}
	.two {
		display: grid;
		gap: 12px;
	}
	@media (min-width: 760px) {
		.two {
			grid-template-columns: 1fr 1fr;
		}
	}
	.hrow {
		display: grid;
		grid-template-columns: 9rem 1fr 3rem;
		gap: 8px;
		align-items: center;
	}
	.track {
		height: 10px;
		background: color-mix(in srgb, var(--muted) 15%, transparent);
		border-radius: 5px;
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
		background: var(--gate-2);
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
</style>
