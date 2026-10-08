<script lang="ts">
	import PassRow from '$lib/components/PassRow.svelte';
	import PushPrompt from '$lib/components/PushPrompt.svelte';
	let { data } = $props();

	const quick = [
		{ type: 'guest', label: 'Guest' },
		{ type: 'delivery', label: 'Delivery' },
		{ type: 'artisan', label: 'Artisan' },
		{ type: 'event', label: 'Party / event' }
	].filter((q) => !data.estate.disabledPassTypes.includes(q.type as never));
	const staff = $derived(data.passes.filter((p) => p.type === 'staff'));
	const visitors = $derived(data.passes.filter((p) => p.type !== 'staff'));
</script>

<svelte:head><title>Passes · OpenSesma</title></svelte:head>

<div class="stack">
	{#if data.unit.duesStatus === 'owing' && data.estate.levyRule !== 'off'}
		<p class="alert warn">
			Your household has outstanding estate dues.
			{data.estate.levyRule === 'restrict' ? 'Event and multi-day passes are paused until it’s settled.' : 'Guards can see this when your visitors arrive.'}
		</p>
	{/if}

	<section>
		<h1 class="sr-only">Passes</h1>
		<div class="quick">
			{#each quick as q}
				<a class="btn" href="/app/invite?type={q.type}">{q.label}</a>
			{/each}
		</div>
	</section>

	<PushPrompt vapidKey={data.vapidKey} />

	<section class="stack">
		<h2>Visitors</h2>
		{#if visitors.length}
			<ul class="list">
				{#each visitors as p (p.id)}<li><PassRow pass={p} timeZone={data.estate.timeZone} /></li>{/each}
			</ul>
		{:else}
			<div class="card empty">
				<p>No visitor passes right now.</p>
				<p class="small muted">Expecting someone? Create a pass and send it on WhatsApp. They show the code at the gate and walk in.</p>
				<a class="btn primary" href="/app/invite?type=guest">Invite a guest</a>
			</div>
		{/if}
	</section>

	<section class="stack">
		<div class="spread"><h2>Staff</h2><a class="small" href="/app/household#staff">Manage staff</a></div>
		{#if staff.length}
			<ul class="list">
				{#each staff as p (p.id)}<li><PassRow pass={p} timeZone={data.estate.timeZone} /></li>{/each}
			</ul>
		{:else}
			<p class="small muted">Add your driver, nanny or cleaner once and they'll get in on their schedule without you doing anything.</p>
		{/if}
	</section>
</div>

<style>
	.quick {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 8px;
	}
	@media (min-width: 480px) {
		.quick {
			grid-template-columns: repeat(4, 1fr);
		}
	}
	.empty .btn {
		margin-top: 4px;
	}
	section h2 {
		margin: 0;
	}
</style>
