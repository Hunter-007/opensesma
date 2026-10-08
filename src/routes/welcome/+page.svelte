<script lang="ts">
	import { ROLE_LABEL } from '$lib/shared/types';
	import { formatPhone } from '$lib/shared/phone';
	let { data } = $props();
	const pending = $derived(data.memberships.filter((m) => m.status === 'pending'));
	const guard = $derived(data.memberships.find((m) => m.role === 'guard' && m.status === 'active'));
</script>

<svelte:head><title>Welcome · OpenSesma</title></svelte:head>

<main class="wrap shell stack">
	<h1>{data.name ? `Hello, ${data.name.split(' ')[0]}` : 'Hello'}</h1>
	<p class="muted">Signed in as {formatPhone(data.phone)}.</p>

	{#if pending.length}
		<div class="alert warn">
			Your request to join <strong>{pending[0].estateName}</strong> is waiting for the estate manager to approve it. We'll text you when it's done.
		</div>
	{:else if guard}
		<div class="card stack">
			<p>You're a guard at <strong>{guard.estateName}</strong>. Guards sign in on the gate phone with their PIN, not here.</p>
			<a class="btn primary" href="/gate">Go to the guard console</a>
		</div>
	{:else if data.memberships.length === 0}
		<div class="card stack">
			<p>You're not linked to an estate yet.</p>
			<p class="muted">Ask your estate manager for an invite link, or for your estate's join link so you can request access.</p>
		</div>
	{/if}

	{#if data.memberships.filter((m) => m.status === 'active').length > 1}
		<h2>Switch estate</h2>
		<ul class="list">
			{#each data.memberships.filter((m) => m.status === 'active') as m}
				<li class="spread">
					<span>{m.estateName} <span class="chip">{ROLE_LABEL[m.role]}</span></span>
					<form method="POST" action="?/switch">
						<input type="hidden" name="estateId" value={m.estateId} />
						<button class="btn sm">Open</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}

	<form method="POST" action="/logout"><button class="btn ghost sm">Sign out</button></form>
</main>

<style>
	.shell {
		padding-top: 40px;
		padding-bottom: 40px;
		max-width: 480px;
	}
</style>
