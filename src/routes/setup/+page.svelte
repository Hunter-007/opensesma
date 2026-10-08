<script lang="ts">
	let { form } = $props();
	const v = $derived((form?.values ?? {}) as Record<string, string>);
</script>

<svelte:head><title>Set up your estate · OpenSesma</title></svelte:head>

<main class="wrap shell stack">
	<p class="brand">OpenSesma</p>
	<h1>Set up your estate</h1>
	<p class="muted">This takes two minutes. You can add houses, guards and gate phones next.</p>
	<form method="POST" class="stack">
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
		{#if form?.error}<p class="alert error" role="alert">{form.error}</p>{/if}
		<button class="btn primary block">Create estate</button>
	</form>
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
</style>
