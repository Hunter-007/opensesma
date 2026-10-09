<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatPhone } from '$lib/shared/phone';
	let { data, form } = $props();
	let busy = $state(false);
	const step = $derived(form?.step === 'code' || (form as { values?: { step?: string } })?.values?.step === 'code' ? 'code' : 'phone');
	const phone = $derived((form as { phone?: string })?.phone ?? (form as { values?: { phone?: string } })?.values?.phone ?? '');

	const submit = () => {
		busy = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			busy = false;
		};
	};
</script>

<svelte:head><title>Sign in · OpenSesma</title></svelte:head>

<main class="wrap shell">
	<a href="/" class="brand">OpenSesma</a>
	{#if !data.smsLogin}
		<h1>Sign in with your link</h1>
		<p>OpenSesma signs you in with a one-time link from your estate manager, sent on WhatsApp or by text.</p>
		<div class="card stack">
			<p><strong>New to your estate?</strong> Open the invite link your estate manager sent you.</p>
			<p><strong>New phone, or signed out?</strong> Ask your estate manager for a new sign-in link.</p>
			<p><strong>Guards:</strong> you don't sign in here. Use the gate phone and your PIN.</p>
		</div>
	{:else if step === 'phone'}
		<h1>Sign in with your phone</h1>
		<p class="muted">We'll text you a 6-digit code. No password to remember.</p>
		<form method="POST" action="?/send&next={encodeURIComponent(data.next)}" use:enhance={submit} class="stack">
			<label class="field">
				<span>Phone number</span>
				<input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="0803 123 4567" value={phone} required />
			</label>
			{#if form?.error}<p class="alert error" role="alert">{form.error}</p>{/if}
			<button class="btn primary block" disabled={busy}>{busy ? 'Sending…' : 'Text me a code'}</button>
		</form>
	{:else}
		<h1>Enter your code</h1>
		<p class="muted">Sent to {formatPhone(phone)}. It expires in 5 minutes.</p>
		{#if form && 'devCode' in form && form.devCode}
			<p class="alert warn">Development mode — your code is <strong>{form.devCode}</strong></p>
		{/if}
		<form method="POST" action="?/verify&next={encodeURIComponent(data.next)}" use:enhance={submit} class="stack">
			<input type="hidden" name="phone" value={phone} />
			<label class="field">
				<span>6-digit code</span>
				<input
					name="code"
					type="text"
					inputmode="numeric"
					autocomplete="one-time-code"
					pattern={"[0-9]{6}"}
					maxlength="6"
					class="otp"
					required
				/>
			</label>
			{#if form?.error}<p class="alert error" role="alert">{form.error}</p>{/if}
			<button class="btn primary block" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
		</form>
		<form method="POST" action="?/send&next={encodeURIComponent(data.next)}" use:enhance={submit} class="row resend">
			<input type="hidden" name="phone" value={phone} />
			<button class="btn ghost sm" disabled={busy}>Send a new code</button>
			<a class="btn ghost sm" href="/login?next={encodeURIComponent(data.next)}">Use a different number</a>
		</form>
	{/if}
</main>

<style>
	.shell {
		padding-top: 32px;
		padding-bottom: 48px;
		max-width: 420px;
	}
	.brand {
		display: inline-block;
		font-weight: 800;
		color: var(--gate);
		text-decoration: none;
		margin-bottom: 32px;
	}
	.otp {
		font-family: var(--font-plate);
		font-size: 1.75rem;
		letter-spacing: 0.3em;
		text-align: center;
		font-weight: 700;
	}
	.resend {
		margin-top: 12px;
	}
</style>
