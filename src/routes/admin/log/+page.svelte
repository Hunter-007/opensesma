<script lang="ts">
	import { page } from '$app/state';
	import { PASS_TYPE_LABEL, reasonText } from '$lib/shared/types';
	import { formatDateTime } from '$lib/shared/format';
	let { data } = $props();
	const tz = $derived(data.estate.timeZone);
	const kindLabel: Record<string, string> = { entry: 'In', exit: 'Out', deny: 'Refused', override: 'Override' };
	const methodLabel: Record<string, string> = { qr: 'QR', code: 'Code', walkin: 'Walk-in', override: 'Override', manual: 'Manual' };
	const exportHref = $derived(`/admin/log/export${page.url.search}`);
	const pageHref = (n: number) => {
		const u = new URL(page.url);
		u.searchParams.set('page', String(n));
		return u.pathname + u.search;
	};
</script>

<svelte:head><title>Gate log · OpenSesma admin</title></svelte:head>

<div class="stack">
	<div class="spread">
		<h1>{data.view === 'inside' ? 'Visitors inside now' : 'Gate log'}</h1>
		<div class="row">
			{#if data.view === 'inside'}<a class="btn sm" href="/admin/log">Full log</a>{:else}<a class="btn sm" href="/admin/log?view=inside">Inside now</a>{/if}
			<a class="btn sm" href={exportHref} download>Export CSV</a>
		</div>
	</div>

	{#if data.view === 'log'}
		<form method="GET" class="filters card">
			<label class="field"><span>From</span><input type="date" name="from" value={data.filter.from} /></label>
			<label class="field"><span>To</span><input type="date" name="to" value={data.filter.to} /></label>
			<label class="field"><span>House</span>
				<select name="unit"><option value="">All houses</option>{#each data.units as u}<option value={u.id} selected={u.id === data.filter.unit}>{u.label}</option>{/each}</select></label>
			<label class="field"><span>Gate</span>
				<select name="gate"><option value="">All gates</option>{#each data.gates as g}<option value={g.id} selected={g.id === data.filter.gate}>{g.name}</option>{/each}</select></label>
			<label class="field"><span>What</span>
				<select name="kind">
					<option value="">Everything</option>
					{#each Object.entries(kindLabel) as [k, l]}<option value={k} selected={k === data.filter.kind}>{l}</option>{/each}
				</select></label>
			<label class="field"><span>How</span>
				<select name="method">
					<option value="">Any way</option>
					{#each Object.entries(methodLabel) as [k, l]}<option value={k} selected={k === data.filter.method}>{l}</option>{/each}
				</select></label>
			<label class="field grow"><span>Search</span><input type="search" name="q" value={data.filter.q} placeholder="Visitor, guard or reason" /></label>
			<label class="check"><input type="checkbox" name="conflicts" value="1" checked={data.filter.conflicts} /> Only double entries</label>
			<div class="row"><button class="btn primary sm">Filter</button><a class="btn ghost sm" href="/admin/log">Clear</a></div>
		</form>
	{/if}

	{#if !data.rows.length}
		<p class="muted">{data.view === 'inside' ? 'Nobody checked in over the last 24 hours is still inside.' : 'No gate activity matches these filters.'}</p>
	{:else}
		<div class="table-wrap">
			<table>
				<thead>
					<tr><th>Time</th><th>Visitor</th><th>House</th><th></th><th>Pass</th><th>Gate · guard</th><th>Notes</th></tr>
				</thead>
				<tbody>
					{#each data.rows as r (r.id)}
						<tr class:flag={r.kind === 'override' || r.conflict}>
							<td class="nowrap">{formatDateTime(r.at, tz)}</td>
							<td>{r.visitor || '—'}</td>
							<td>{r.unit || '—'}</td>
							<td><span class="chip" class:allow={r.kind === 'entry'} class:deny={r.kind === 'deny'} class:wait={r.kind === 'override'}>{kindLabel[r.kind]}</span></td>
							<td class="small">{r.type ? PASS_TYPE_LABEL[r.type] : ''}{r.type ? ' · ' : ''}{methodLabel[r.method]}</td>
							<td class="small">{r.gate}{r.guard ? ` · ${r.guard}` : ''}</td>
							<td class="small">
								{reasonText(r.reason)}
								{#if r.conflict}<span class="chip deny">Double entry</span>{/if}
								{#if r.offline}<span class="chip">Offline</span>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if data.view === 'log' && (data.page > 0 || data.hasMore)}
			<div class="row">
				{#if data.page > 0}<a class="btn sm" href={pageHref(data.page - 1)}>Newer</a>{/if}
				{#if data.hasMore}<a class="btn sm" href={pageHref(data.page + 1)}>Older</a>{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	.filters {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 12px;
		align-items: end;
	}
	.filters .grow {
		grid-column: span 2;
	}
	.check {
		display: flex;
		gap: 8px;
		align-items: center;
		min-height: 48px;
	}
	.nowrap {
		white-space: nowrap;
	}
	tr.flag td {
		background: color-mix(in srgb, var(--wait) 8%, transparent);
	}
	td .chip + .chip {
		margin-left: 4px;
	}
</style>
