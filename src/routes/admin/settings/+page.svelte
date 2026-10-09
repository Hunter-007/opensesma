<script lang="ts">
	import { enhance } from '$app/forms';
	import { PASS_TYPE_LABEL, type PassType } from '$lib/shared/types';
	import { formatDateTime } from '$lib/shared/format';
	let { data, form } = $props();
	const s = $derived(data.estate.settings);
	let copied = $state(false);
	const types: PassType[] = ['guest', 'delivery', 'artisan', 'multiday', 'event'];
	const share = $derived(`Our estate now uses OpenSesma for gate access. Join with your phone number: ${data.joinUrl}`);
</script>

<svelte:head><title>Settings · OpenSesma admin</title></svelte:head>

<div class="stack">
	<h1>Settings</h1>
	{#if form?.ok}<p class="alert ok">{form.ok}</p>{/if}
	{#if form?.error}<p class="alert error" role="alert">{form.error}</p>{/if}

	{#if data.smsLogin}
	<section class="card stack" id="join">
		<h2>Estate join link</h2>
		<p class="small muted">Post this in the estate WhatsApp group. Residents request to join their house and you approve them under People.</p>
		<p class="link">{data.joinUrl}</p>
		<div class="row">
			<a class="btn sm primary" href="https://wa.me/?text={encodeURIComponent(share)}" target="_blank" rel="noopener">Share on WhatsApp</a>
			<button class="btn sm" onclick={async () => { await navigator.clipboard.writeText(data.joinUrl); copied = true; }}>{copied ? 'Copied' : 'Copy link'}</button>
		</div>
	</section>
	{:else}
		<section class="card stack" id="join">
			<h2>Getting residents on board</h2>
			<p class="small muted">Add each house under <a href="/admin/units">Houses</a> with the resident's phone number, then send them their invite on WhatsApp or by text. Opening it signs them in. Heads of household can invite the rest of their household from the app.</p>
		</section>
	{/if}

	<form method="POST" use:enhance={() => async ({ update }) => update({ reset: false })} class="stack">
		<section class="card stack">
			<h2>Estate</h2>
			<label class="field"><span>Name</span><input name="name" type="text" value={data.estate.name} required /></label>
			<label class="field"><span>Address</span><input name="address" type="text" value={data.estate.address} /></label>
			<label class="field"><span>Directions for visitors</span><input name="directionsNote" type="text" value={s.directionsNote} placeholder="After Shoprite, second right. Gate is beside the mosque." />
				<small>Shown on every pass a resident shares.</small></label>
		</section>

		<section class="card stack">
			<h2>Estate dues and access</h2>
			<fieldset class="stack">
				<legend>When a house is marked as owing dues</legend>
				<label class="opt"><input type="radio" name="levyRule" value="off" checked={s.levyRule === 'off'} /> <span><strong>Do nothing</strong><br /><span class="small muted">Dues status is for your records only.</span></span></label>
				<label class="opt"><input type="radio" name="levyRule" value="warn" checked={s.levyRule === 'warn'} /> <span><strong>Warn the guard</strong><br /><span class="small muted">Visitors still get in. The guard sees “Household is owing estate dues”.</span></span></label>
				<label class="opt"><input type="radio" name="levyRule" value="restrict" checked={s.levyRule === 'restrict'} /> <span><strong>Pause party and multi-day passes</strong><br /><span class="small muted">Guests, staff, deliveries and artisans always work, so nobody is locked out of essentials.</span></span></label>
			</fieldset>
		</section>

		<section class="card stack">
			<h2>Passes</h2>
			<fieldset>
				<legend>Pass types residents can create</legend>
				<div class="types">
					{#each types as t}<label class="row"><input type="checkbox" name="types" value={t} checked={!s.disabledPassTypes.includes(t)} /> {PASS_TYPE_LABEL[t]}</label>{/each}
					<label class="row muted"><input type="checkbox" checked disabled /> Staff (always on)</label>
				</div>
			</fieldset>
			<div class="grid">
				<label class="field"><span>Guest pass lasts (hours)</span><input name="guestWindowHours" type="number" min="1" max="48" value={s.guestWindowHours} /></label>
				<label class="field"><span>Delivery pass lasts (hours)</span><input name="deliveryWindowHours" type="number" min="1" max="12" value={s.deliveryWindowHours} /></label>
				<label class="field"><span>Household members per house</span><input name="maxSubResidents" type="number" min="0" max="20" value={s.maxSubResidents} /></label>
				<label class="field"><span>Active passes per house</span><input name="maxActivePassesPerUnit" type="number" min="5" max="500" value={s.maxActivePassesPerUnit} /></label>
			</div>
		</section>

		<section class="card stack">
			<h2>Gate and privacy</h2>
			<div class="grid">
				<label class="field"><span>Warn guards after no sync for (hours)</span><input name="staleSyncHours" type="number" min="1" max="72" value={s.staleSyncHours} /></label>
				<label class="field"><span>Keep visitor names for (months)</span><input name="retentionMonths" type="number" min="1" max="60" value={s.retentionMonths} />
					<small>After this, names and phone numbers are removed from old records (NDPA).</small></label>
			</div>
		</section>

		<button class="btn primary">Save settings</button>
	</form>

	<section class="stack">
		<h2>Recent admin activity</h2>
		<ul class="list small">
			{#each data.audit as a (a.id)}<li class="spread"><span>{a.actor} · {a.action}</span><span class="muted">{formatDateTime(a.at, data.estate.timeZone)}</span></li>{/each}
		</ul>
	</section>
</div>

<style>
	.link {
		font-family: ui-monospace, monospace;
		font-size: 0.875rem;
		word-break: break-all;
		background: color-mix(in srgb, var(--muted) 10%, transparent);
		padding: 8px 10px;
		border-radius: 6px;
		margin: 0;
	}
	.opt {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 10px 12px;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
	}
	.opt input {
		margin-top: 4px;
		width: 18px;
		height: 18px;
	}
	.types {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 8px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 12px;
	}
</style>
