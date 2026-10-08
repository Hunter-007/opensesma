<script lang="ts">
	import { PASS_TYPE_LABEL, type PassType, type Schedule } from '$lib/shared/types';
	import { formatDateTime, formatSchedule, relativeTime } from '$lib/shared/format';
	import { formatCode } from '$lib/shared/encoding';
	let {
		pass,
		timeZone
	}: {
		pass: { id: string; type: PassType; name: string; purpose: string; code: string; validFrom: number; validTo: number | null; schedule: Schedule | null; maxEntries: number; entriesUsed: number };
		timeZone: string;
	} = $props();

	const when = $derived(
		pass.schedule
			? formatSchedule(pass.schedule)
			: pass.validFrom > Date.now()
				? `Starts ${formatDateTime(pass.validFrom, timeZone)}`
				: pass.validTo
					? `Ends ${relativeTime(pass.validTo)}`
					: 'No end date'
	);
	const title = $derived(pass.name || (pass.type === 'delivery' ? 'Delivery rider' : PASS_TYPE_LABEL[pass.type]));
</script>

<a class="rowlink" href="/app/passes/{pass.id}">
	<span class="top">
		<span class="name">{title}</span>
		<span class="plate">{formatCode(pass.code)}</span>
	</span>
	<span class="meta small muted">
		{PASS_TYPE_LABEL[pass.type]}{pass.purpose ? ` · ${pass.purpose}` : ''} · {when}{pass.maxEntries > 1 ? ` · ${pass.entriesUsed}/${pass.maxEntries} in` : ''}
	</span>
</a>

<style>
	.top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
	}
	.name {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.plate {
		font-size: 1rem;
		flex: none;
	}
	.meta {
		display: block;
		margin-top: 2px;
	}
</style>
