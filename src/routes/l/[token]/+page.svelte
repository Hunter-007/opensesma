<script lang="ts">
	let { data, form } = $props();
	let busy = $state(false);
</script>

<svelte:head><title>Sign in · OpenSesma</title></svelte:head>

<main class="wrap shell stack">
	<p class="brand">OpenSesma</p>
	{#if !data.link}
		<h1>This link has expired</h1>
		<p class="muted">Sign-in links work once and last 3 days. Ask your estate manager to send you a new one.</p>
	{:else}
		<h1>Welcome{data.link.firstName ? `, ${data.link.firstName}` : ''}</h1>
		<p class="muted">Sign in to {data.link.estateName} on this phone.</p>
		<form method="POST" class="stack" onsubmit={() => (busy = true)}>
			{#if form?.error}<p class="alert error" role="alert">{form.error}</p>{/if}
			<button class="btn primary block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
		</form>
		<p class="small muted">The link works once. You'll stay signed in on this phone.</p>
	{/if}
</main>

<style>
	.shell {
		padding-top: 32px;
		padding-bottom: 40px;
		max-width: 440px;
	}
	.brand {
		font-weight: 800;
		color: var(--gate);
	}
</style>
