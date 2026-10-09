<script lang="ts">
	import { enhance } from '$app/forms';
	import { PASS_TYPE_LABEL, type PassType } from '$lib/shared/types';
	let { data, form } = $props();

	const v = $derived((form?.values ?? {}) as Record<string, string>);
	// Initial values only; the form keeps its own state across failed submits (reset: false).
	// svelte-ignore state_referenced_locally
	let type = $state<PassType>(data.type);
	let when = $state<'now' | 'later'>('now');
	// svelte-ignore state_referenced_locally
	let phone = $state(data.prefill.phone);
	let busy = $state(false);

	const options: { type: PassType; hint: string }[] = (
		[
			{ type: 'guest', hint: 'One visit today or another day' },
			{ type: 'delivery', hint: 'Food, parcels, dispatch riders · 2 hours' },
			{ type: 'artisan', hint: 'Plumber, electrician, AC man' },
			{ type: 'multiday', hint: 'Family staying a few days' },
			{ type: 'event', hint: 'One code for a whole party' }
		] as const
	).filter((o) => !data.estate.disabledPassTypes.includes(o.type));
</script>

<svelte:head><title>New pass · OpenSesma</title></svelte:head>

<form
	method="POST"
	class="stack"
	use:enhance={() => {
		busy = true;
		return async ({ update }) => {
			await update({ reset: false });
			busy = false;
		};
	}}
>
	<h1>New pass</h1>

	<fieldset>
		<legend>Who's coming?</legend>
		<div class="types">
			{#each options as o}
				<label class="type" class:on={type === o.type}>
					<input type="radio" name="type" value={o.type} bind:group={type} />
					<strong>{PASS_TYPE_LABEL[o.type]}</strong>
					<span class="small muted">{o.hint}</span>
				</label>
			{/each}
			<a class="type" href="/app/household#staff">
				<strong>Staff</strong>
				<span class="small muted">Driver, nanny, cleaner on a schedule</span>
			</a>
		</div>
	</fieldset>

	{#if type === 'event'}
		<label class="field"><span>Event name</span><input name="name" type="text" placeholder="Tolu's 40th birthday" value={v.name ?? ''} required /></label>
		<label class="field"><span>How many guests?</span><input name="guests" type="number" inputmode="numeric" min="1" max="1000" value={v.guests ?? '30'} required />
			<small>The code stops working once this many people have entered.</small></label>
		<label class="field"><span>Date</span><input name="date" type="date" min={data.today} value={v.date ?? data.today} required /></label>
		<div class="two">
			<label class="field"><span>Starts</span><input name="start" type="time" value={v.start ?? '14:00'} required /></label>
			<label class="field"><span>Ends</span><input name="end" type="time" value={v.end ?? '23:00'} required /></label>
		</div>
	{:else}
		<label class="field">
			<span>{type === 'delivery' ? 'Rider or company (optional)' : 'Name'}</span>
			<input name="name" type="text" autocomplete="off" placeholder={type === 'delivery' ? 'Chowdeck, Jumia, GIG…' : 'Full name as on their ID'} value={v.name ?? data.prefill.name} required={type !== 'delivery'} />
		</label>
		{#if type === 'artisan'}
			<label class="field"><span>Coming to do what?</span><input name="purpose" type="text" placeholder="Fix kitchen sink" value={v.purpose ?? ''} required /></label>
		{/if}
		<label class="field">
			<span>Their phone (optional)</span>
			<input name="phone" type="tel" inputmode="tel" placeholder="0803 123 4567" bind:value={phone} />
			<small>Add it so WhatsApp or your text app opens straight to their chat.</small>
		</label>

		{#if type === 'guest'}
			<fieldset class="seg">
				<legend>When?</legend>
				<label class:on={when === 'now'}><input type="radio" name="when" value="now" bind:group={when} /> Today, from now</label>
				<label class:on={when === 'later'}><input type="radio" name="when" value="later" bind:group={when} /> Another time</label>
			</fieldset>
			{#if when === 'later'}
				<div class="two">
					<label class="field"><span>Date</span><input name="date" type="date" min={data.today} value={v.date ?? data.tomorrow} required /></label>
					<label class="field"><span>From</span><input name="time" type="time" value={v.time ?? '09:00'} required /></label>
				</div>
				<p class="small muted">The pass works for 12 hours from that time, for one entry.</p>
			{/if}
		{:else if type === 'multiday'}
			<div class="two">
				<label class="field"><span>First day</span><input name="fromDate" type="date" min={data.today} value={v.fromDate ?? data.today} required /></label>
				<label class="field"><span>Last day</span><input name="toDate" type="date" min={data.today} value={v.toDate ?? ''} required /></label>
			</div>
		{:else if type === 'artisan'}
			<label class="field"><span>Date</span><input name="date" type="date" min={data.today} value={v.date ?? data.today} required /></label>
			<div class="two">
				<label class="field"><span>From</span><input name="start" type="time" value={v.start ?? (data.nowTime < '18:00' ? data.nowTime : '08:00')} required /></label>
				<label class="field"><span>Until</span><input name="end" type="time" value={v.end ?? '18:00'} required /></label>
			</div>
		{:else if type === 'delivery'}
			<p class="small muted">Works once, for the next 2 hours. Send the code to the rider.</p>
		{/if}
	{/if}

	{#if form?.error}<p class="alert error" role="alert">{form.error}</p>{/if}
	<button class="btn primary block" disabled={busy}>{busy ? 'Creating…' : 'Create pass'}</button>
</form>

<style>
	.types {
		display: grid;
		gap: 8px;
		grid-template-columns: 1fr 1fr;
	}
	.type {
		display: grid;
		gap: 2px;
		padding: 12px;
		border: 1px solid var(--line);
		border-radius: var(--r);
		background: var(--card);
		cursor: pointer;
		color: inherit;
		text-decoration: none;
	}
	.type input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.type.on {
		border-color: var(--gate-2);
		box-shadow: inset 0 0 0 1px var(--gate-2);
		background: color-mix(in srgb, var(--gate-2) 6%, var(--card));
	}
	.type:has(input:focus-visible) {
		outline: 3px solid var(--focus);
	}
	.two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.seg {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.seg legend {
		grid-column: 1 / -1;
	}
	.seg label {
		display: flex;
		gap: 8px;
		align-items: center;
		min-height: 48px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		background: var(--card);
	}
	.seg label.on {
		border-color: var(--gate-2);
	}
</style>
