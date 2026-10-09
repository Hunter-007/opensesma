<script lang="ts">
	import { page } from '$app/state';
	import { ROLE_LABEL } from '$lib/shared/types';
	let { data, form } = $props();
	let busy = $state(false);
</script>

<svelte:head><title>Join your estate · OpenSesma</title></svelte:head>

<main class="wrap shell stack">
	<p class="brand">OpenSesma</p>
	{#if !data.invite}
		<h1>This invite has expired</h1>
		<p class="muted">Invite links last 14 days and work once. Ask your estate manager or household head to send a new one.</p>
	{:else}
		<h1>Join {data.invite.estateName}</h1>
		<div class="card stack">
			{#if data.invite.unitLabel}<p><strong>{data.invite.unitLabel}</strong></p>{/if}
			<p class="muted">You're invited as {ROLE_LABEL[data.invite.role].toLowerCase()}.</p>
		</div>
		{#if data.otherAccount}
			<p>This phone is signed in to another OpenSesma account. Sign out, then join.</p>
			<form method="POST" action="/logout?next={encodeURIComponent(page.url.pathname)}">
				<button class="btn primary block">Sign out and continue</button>
			</form>
		{:else if !data.signedIn && !data.invite.linkSignIn}
			<p>First, confirm your phone number.</p>
			<a class="btn primary block" href="/login?next={encodeURIComponent(page.url.pathname)}">Continue with my phone</a>
		{:else}
			<form method="POST" class="stack" onsubmit={() => (busy = true)}>
				<label class="field">
					<span>Your name</span>
					<input name="name" type="text" autocomplete="name" value={form?.values?.name ?? (data.userName || data.invite.name)} required />
					<small>Guards see this name on your visitors' passes.</small>
				</label>
				{#if form?.error}<p class="alert error" role="alert">{form.error}</p>{/if}
				<button class="btn primary block" disabled={busy}>{busy ? 'Joining…' : 'Join and sign in'}</button>
			</form>
			{#if !data.signedIn}<p class="small muted">This link works once and signs you in on this phone. Don't forward it.</p>{/if}
		{/if}
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
