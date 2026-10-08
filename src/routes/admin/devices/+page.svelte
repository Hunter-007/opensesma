<script lang="ts">
	import { enhance } from '$app/forms';
	import { relativeTime } from '$lib/shared/format';
	let { data, form } = $props();
	const f = $derived(form as Record<string, unknown> | null);
</script>

<svelte:head><title>Gate phones · OpenSesma admin</title></svelte:head>

<div class="stack">
	<h1>Gate phones</h1>
	<p class="muted">
		Any Android phone with Chrome works. On the gate phone, open <strong>{data.gateUrl}</strong>, tap “Add to Home screen”, and enter the setup code below. Codes work once and expire in 24 hours.
	</p>
	{#if f?.ok}<p class="alert ok">{f.ok}</p>{/if}
	{#if f?.error}<p class="alert error" role="alert">{f.error}</p>{/if}

	{#each data.gates as g (g.id)}
		<section class="card stack">
			<form method="POST" action="?/renameGate" use:enhance class="row">
				<input type="hidden" name="gateId" value={g.id} />
				<input name="name" type="text" value={g.name} class="gname" aria-label="Gate name" />
				<button class="btn sm ghost">Rename</button>
			</form>
			{#each data.devices.filter((d) => d.gateId === g.id) as d (d.id)}
				<div class="device">
					<div>
						<strong>{d.name}</strong>
						{#if d.enrollCode}
							<div class="setup">Setup code <span class="plate">{d.enrollCode}</span></div>
							<div class="small muted">Expires {relativeTime(d.enrollExpiresAt ?? 0)}</div>
						{:else if d.enrolled}
							<div class="small muted">Last synced {d.lastSyncAt ? relativeTime(d.lastSyncAt) : 'never'}</div>
						{:else}
							<div class="small muted">Setup code expired — make a new one.</div>
						{/if}
					</div>
					<div class="row">
						<form method="POST" action="?/reenroll" use:enhance><input type="hidden" name="deviceId" value={d.id} /><button class="btn sm">{d.enrolled ? 'Replace phone' : 'New code'}</button></form>
						<form method="POST" action="?/revoke" use:enhance><input type="hidden" name="deviceId" value={d.id} /><button class="btn sm ghost danger">Remove</button></form>
					</div>
				</div>
			{/each}
			<form method="POST" action="?/create" use:enhance class="row">
				<input type="hidden" name="gateId" value={g.id} />
				<input type="hidden" name="name" value="{g.name} phone" />
				<button class="btn sm primary">Add a phone for {g.name}</button>
			</form>
		</section>
	{/each}

	<form method="POST" action="?/addGate" use:enhance class="row">
		<input name="name" type="text" placeholder="New gate name" class="gname" />
		<button class="btn sm">Add gate</button>
	</form>

	<p class="small muted">Lost or stolen phone? Remove it here. It stops working immediately and wipes its data when it next connects.</p>
</div>

<style>
	.gname {
		max-width: 240px;
		min-height: 40px;
		font-weight: 700;
	}
	.device {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		padding: 12px 0;
		border-top: 1px solid var(--line);
	}
	.setup {
		margin-top: 6px;
	}
	.setup .plate {
		font-size: 1.4rem;
		margin-left: 6px;
	}
</style>
