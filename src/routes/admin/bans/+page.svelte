<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatPhone } from '$lib/shared/phone';
	import { formatDateTime } from '$lib/shared/format';
	let { data, form } = $props();
	const f = $derived(form as Record<string, unknown> | null);
	const v = $derived((f?.values ?? {}) as Record<string, string>);
</script>

<svelte:head><title>Ban list · OpenSesma admin</title></svelte:head>

<div class="stack">
	<h1>Ban list</h1>
	<p class="muted">People on this list get a red “Refer to supervisor” screen at every gate, even with a valid pass. Matched by phone number or exact name.</p>
	{#if f?.ok}<p class="alert ok">{f.ok}</p>{/if}
	{#if f?.error}<p class="alert error" role="alert">{f.error}</p>{/if}

	<form method="POST" action="?/add" use:enhance class="card grid-form">
		<label class="field"><span>Name</span><input name="name" type="text" value={v.name ?? ''} /></label>
		<label class="field"><span>Phone</span><input name="phone" type="tel" inputmode="tel" value={v.phone ?? ''} /></label>
		<label class="field full"><span>Reason</span><input name="reason" type="text" value={v.reason ?? ''} placeholder="Former driver at 14 Adeyemi, theft reported to police" required /></label>
		<label class="field"><span>Until (optional)</span><input name="until" type="date" value={v.until ?? ''} /></label>
		<div class="row full"><button class="btn primary">Add to ban list</button></div>
	</form>

	{#if !data.bans.length}
		<p class="muted">Nobody is banned.</p>
	{:else}
		<ul class="list">
			{#each data.bans as b (b.id)}
				<li class="spread">
					<span>
						<strong>{b.name ?? formatPhone(b.phone)}</strong>{b.name && b.phone ? ` · ${formatPhone(b.phone)}` : ''}
						<div class="small">{b.reason}</div>
						<div class="small muted">Added {formatDateTime(b.createdAt, data.estate.timeZone)}{b.expiresAt ? ` · until ${formatDateTime(b.expiresAt, data.estate.timeZone)}` : ''}</div>
					</span>
					<form method="POST" action="?/remove" use:enhance><input type="hidden" name="banId" value={b.id} /><button class="btn sm ghost">Remove</button></form>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.grid-form {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 12px;
	}
	.full {
		grid-column: 1 / -1;
	}
</style>
