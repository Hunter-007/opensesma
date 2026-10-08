<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatPhone } from '$lib/shared/phone';
	import { relativeTime } from '$lib/shared/format';
	let {
		walkin,
		form
	}: {
		walkin: { name: string; phone: string | null; purpose: string; status: string; gate: string; guard: string; unit: string; createdAt: number; decidedByName: string | null };
		form: { decided?: boolean; already?: boolean; status?: string; by?: string | null; error?: string } | null;
	} = $props();
	let busy = $state(false);
	const status = $derived(form?.status ?? walkin.status);
	const by = $derived(form?.by ?? walkin.decidedByName);
</script>

<div class="stack">
	<p class="muted">{walkin.gate} · {relativeTime(walkin.createdAt)}</p>
	<h1>{walkin.name} is at the gate</h1>
	<div class="card">
		<dl>
			<dt>For</dt>
			<dd>{walkin.unit}</dd>
			{#if walkin.purpose}<dt>Reason</dt><dd>{walkin.purpose}</dd>{/if}
			{#if walkin.phone}<dt>Phone</dt><dd><a href="tel:{walkin.phone}">{formatPhone(walkin.phone)}</a></dd>{/if}
			{#if walkin.guard}<dt>Guard</dt><dd>{walkin.guard}</dd>{/if}
		</dl>
	</div>

	{#if status === 'pending'}
		<form
			method="POST"
			class="stack"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update();
					busy = false;
				};
			}}
		>
			<label class="field">
				<span>Message for the guard (optional)</span>
				<input name="note" type="text" placeholder="Tell them to wait 10 minutes" />
			</label>
			<div class="two">
				<button class="btn primary" name="decision" value="approve" disabled={busy}>Let in</button>
				<button class="btn danger" name="decision" value="deny" disabled={busy}>Decline</button>
			</div>
		</form>
	{:else if status === 'approved'}
		<p class="alert ok">{form?.already ? `Already let in by ${by}.` : 'Done — the guard can let them in now.'}</p>
	{:else if status === 'denied'}
		<p class="alert error">{form?.already ? `Already declined by ${by}.` : 'Declined. The guard has been told.'}</p>
	{:else}
		<p class="alert warn">This request expired. If they're still at the gate, the guard will ask again.</p>
	{/if}
	{#if form?.error}<p class="alert error">{form.error}</p>{/if}
</div>

<style>
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 4px 16px;
		margin: 0;
	}
	dt {
		color: var(--muted);
	}
	dd {
		margin: 0;
	}
	.two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.two .btn {
		min-height: 56px;
		font-size: 1.0625rem;
	}
</style>
