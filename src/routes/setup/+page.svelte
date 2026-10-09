<script lang="ts">
	import { page } from '$app/state';
	let { data, form } = $props();
	const v = $derived((form?.values ?? {}) as Record<string, string>);
	const q = $derived(page.url.search);
	let creating = $state(false);
	let demo = $state(true);
	$effect(() => {
		creating = !data.hasEstates;
	});
</script>

<svelte:head><title>Set up your estate · OpenSesma</title></svelte:head>

<main class="wrap shell stack">
	<p class="brand">OpenSesma</p>

	{#if data.canSignIn}
		<h1>Sign in as estate manager</h1>
		<p class="muted">For the estate manager's own phone. Keep this setup link private: it can sign in any manager.</p>
		<form method="POST" action="?/manager{q ? '&' + q.slice(1) : ''}" class="stack">
			<label class="field"><span>Manager's phone number</span><input name="managerPhone" type="tel" inputmode="tel" value={v.managerPhone ?? ''} placeholder="0803 123 4567" required /></label>
			{#if form?.error && 'managerPhone' in v}<p class="alert error" role="alert">{form.error}</p>{/if}
			<button class="btn primary block">Sign in</button>
		</form>
		{#if !creating}
			<button class="btn ghost" onclick={() => (creating = true)}>Set up another estate</button>
		{/if}
	{/if}

	{#if creating}
		<h1>Set up your estate</h1>
		<p class="muted">This takes two minutes. You can add houses, guards and gate phones next.</p>
		<form method="POST" action="?/create{q ? '&' + q.slice(1) : ''}" class="stack">
			<label class="field"><span>Estate name</span><input name="name" type="text" value={v.name ?? ''} placeholder="Harmony Gardens Estate" required /></label>
			<label class="field"><span>Address</span><input name="address" type="text" value={v.address ?? ''} placeholder="Sangotedo, Ajah, Lagos" /></label>
			<label class="field">
				<span>Gates</span>
				<textarea name="gates" placeholder="Main gate&#10;Back gate">{v.gates ?? 'Main gate\nBack gate'}</textarea>
				<small>One per line. Each gate gets its own phone and log.</small>
			</label>
			<h2>Estate manager</h2>
			<label class="field"><span>Name</span><input name="adminName" type="text" value={v.adminName ?? ''} required /></label>
			<label class="field"><span>Phone number</span><input name="adminPhone" type="tel" inputmode="tel" value={v.adminPhone ?? ''} placeholder="0803 123 4567" required /></label>
			<label class="check"><input type="checkbox" name="demo" bind:checked={demo} /> Add a test house, resident and guard so I can try it out</label>
			{#if demo}
				<label class="field"><span>Test guard's PIN</span><input name="demoPin" type="text" inputmode="numeric" pattern={"[0-9]{6}"} maxlength="6" value={v.demoPin ?? data.demoPin} required />
					<small>Note this down. "Test Guard" types it on the gate phone to start a shift.</small></label>
			{/if}
			{#if form?.error && !('managerPhone' in v)}<p class="alert error" role="alert">{form.error}</p>{/if}
			<button class="btn primary block">Create estate</button>
		</form>
	{/if}
</main>

<style>
	.shell {
		padding-top: 32px;
		padding-bottom: 48px;
		max-width: 480px;
	}
	.brand {
		font-weight: 800;
		color: var(--gate);
	}
	.check {
		display: flex;
		gap: 10px;
		align-items: flex-start;
	}
	.check input {
		width: 20px;
		height: 20px;
		margin-top: 2px;
	}
</style>
