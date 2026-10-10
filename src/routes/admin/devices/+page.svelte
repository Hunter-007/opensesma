<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatTime, relativeTime } from '$lib/shared/format';
	let { data, form } = $props();
	const f = $derived(form as Record<string, unknown> | null);
</script>

<svelte:head><title>Gate phones · OpenSesma admin</title></svelte:head>

<div class="stack">
	<h1>Gate phones</h1>
	<p class="muted">
		Any Android phone with Chrome works. On the gate phone, open <strong>{data.gateUrl}</strong>, tap “Add to Home screen”, and enter the setup code below. Codes work once and expire in 24 hours.
	</p>
	<p class="small muted">A guard can be on duty at only one gate at a time. If a guard is stuck on duty at a phone (left without ending the shift, or the phone is off), end the shift here.</p>
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
							{#if d.onDuty}
								<div class="duty">On duty: <strong>{d.onDuty.guardName}</strong> since {formatTime(d.onDuty.startedAt, data.timeZone)}</div>
							{:else}
								<div class="small muted">No guard on duty</div>
							{/if}
						{:else}
							<div class="small muted">Setup code expired — make a new one.</div>
						{/if}
					</div>
					<div class="row">
						{#if d.onDuty}
							<form method="POST" action="?/endShift" use:enhance><input type="hidden" name="shiftId" value={d.onDuty.id} /><button class="btn sm">End {d.onDuty.guardName.split(' ')[0]}'s shift</button></form>
						{/if}
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
	.duty {
		margin-top: 4px;
		color: var(--allow, #1f8a4c);
	}
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
