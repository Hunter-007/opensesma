<script lang="ts">
	let { data, form } = $props();
</script>

<svelte:head><title>Request to join · OpenSesma</title></svelte:head>

<main class="wrap shell stack">
	<h1>Join {data.estateName}</h1>
	{#if form?.sent || data.status === 'pending'}
		<p class="alert ok">Request sent. The estate manager will check it and we'll text you once you're approved.</p>
	{:else if data.status === 'active'}
		<p class="alert ok">You're already a member. <a href="/">Open OpenSesma</a></p>
	{:else}
		<p class="muted">No invite link? Request access and the estate manager will confirm you live here.</p>
		<form method="POST" class="stack">
			<label class="field">
				<span>Your name</span>
				<input name="name" type="text" autocomplete="name" value={data.name} required />
			</label>
			<label class="field">
				<span>Your house</span>
				<select name="unitId" required>
					<option value="">Choose your house</option>
					{#each data.units as u}<option value={u.id}>{u.label}</option>{/each}
				</select>
			</label>
			<label class="field">
				<span>How can the manager confirm you live there?</span>
				<textarea name="proof" placeholder="e.g. New tenant since September, tenancy agreement with Mr Okeke (landlord)" required></textarea>
				<small>The estate manager may ask to see your tenancy agreement or a utility bill.</small>
			</label>
			{#if form?.error}<p class="alert error" role="alert">{form.error}</p>{/if}
			<button class="btn primary block">Send request</button>
		</form>
	{/if}
</main>

<style>
	.shell {
		padding-top: 32px;
		padding-bottom: 40px;
		max-width: 480px;
	}
</style>
