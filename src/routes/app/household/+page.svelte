<script lang="ts">
	import { enhance } from '$app/forms';
	import ScheduleInput from '$lib/components/ScheduleInput.svelte';
	import { ROLE_LABEL } from '$lib/shared/types';
	import { formatPhone } from '$lib/shared/phone';
	import { formatSchedule } from '$lib/shared/format';
	import { formatCode } from '$lib/shared/encoding';
	let { data, form } = $props();
	let addingStaff = $state(false);
	let addingMember = $state(false);
	const v = $derived((form?.values ?? {}) as Record<string, string>);
	const ok = $derived(form && 'ok' in form ? (form.ok as string) : null);
</script>

<svelte:head><title>Household · OpenSesma</title></svelte:head>

<div class="stack">
	<h1>Household</h1>
	{#if ok}<p class="alert ok">{ok}</p>{/if}
	{#if form?.error}<p class="alert error" role="alert">{form.error}</p>{/if}

	<section class="stack">
		<h2>People who can invite visitors</h2>
		<ul class="list">
			{#each data.members as m (m.id)}
				<li class="spread">
					<span>
						<strong>{m.name || formatPhone(m.phone)}</strong>
						<span class="small muted">{ROLE_LABEL[m.role]}{m.status === 'pending' ? ' · awaiting approval' : ''}</span>
					</span>
					{#if data.isPrimary && m.role === 'resident_sub'}
						<form method="POST" action="?/removeMember" use:enhance>
							<input type="hidden" name="membershipId" value={m.id} />
							<button class="btn sm ghost danger">Remove</button>
						</form>
					{/if}
				</li>
			{/each}
			{#each data.invites as i (i.id)}
				<li class="spread"><span>{i.name || formatPhone(i.phone)} <span class="small muted">· invited</span></span></li>
			{/each}
		</ul>
		{#if data.isPrimary}
			{#if addingMember}
				<form method="POST" action="?/addMember" use:enhance class="card stack">
					<label class="field"><span>Name</span><input name="name" type="text" value={v.name ?? ''} required /></label>
					<label class="field"><span>Phone</span><input name="phone" type="tel" inputmode="tel" value={v.phone ?? ''} required /></label>
					<div class="row"><button class="btn primary">Send invite</button><button type="button" class="btn ghost" onclick={() => (addingMember = false)}>Cancel</button></div>
				</form>
			{:else}
				<button class="btn" onclick={() => (addingMember = true)}>Add spouse, child or co-tenant</button>
			{/if}
		{/if}
	</section>

	<section class="stack" id="staff">
		<h2>Staff</h2>
		<p class="small muted">Drivers, nannies, cleaners, gardeners. They use the same code every day, only on their days and hours.</p>
		{#if data.staff.length}
			<ul class="list">
				{#each data.staff as s (s.id)}
					<li class="spread">
						<span>
							<strong>{s.name}</strong> <span class="small muted">· {s.role}</span><br />
							<span class="small muted">{s.schedule ? formatSchedule(s.schedule) : 'No active pass'}</span>
						</span>
						<span class="row">
							{#if s.passId}<a href="/app/passes/{s.passId}" class="plate">{formatCode(s.code ?? "")}</a>{/if}
							<form method="POST" action="?/removeStaff" use:enhance>
								<input type="hidden" name="profileId" value={s.id} />
								<button class="btn sm ghost danger">Remove</button>
							</form>
						</span>
					</li>
				{/each}
			</ul>
		{/if}
		{#if addingStaff}
			<form method="POST" action="?/addStaff" use:enhance class="card stack">
				<label class="field"><span>Name</span><input name="name" type="text" value={v.name ?? ''} required /></label>
				<label class="field">
					<span>Role</span>
					<input name="role" type="text" list="staff-roles" value={v.role ?? ''} placeholder="Driver" required />
					<datalist id="staff-roles"><option>Driver</option><option>Nanny</option><option>Cleaner</option><option>Cook</option><option>Gardener</option><option>Night watchman</option></datalist>
				</label>
				<label class="field"><span>Phone (optional)</span><input name="phone" type="tel" inputmode="tel" value={v.phone ?? ''} /></label>
				<div class="two">
					<label class="field">
						<span>ID type</span>
						<select name="idType">
							<option value="">None yet</option>
							<option>NIN</option>
							<option>Voter's card</option>
							<option>Driver's licence</option>
							<option>International passport</option>
						</select>
					</label>
					<label class="field"><span>ID number</span><input name="idNumber" type="text" value={v.idNumber ?? ''} /></label>
				</div>
				<ScheduleInput />
				<div class="row"><button class="btn primary">Add staff</button><button type="button" class="btn ghost" onclick={() => (addingStaff = false)}>Cancel</button></div>
			</form>
		{:else}
			<button class="btn" onclick={() => (addingStaff = true)}>Add staff</button>
		{/if}
	</section>

	<section class="stack">
		<h2>You</h2>
		<p class="muted">{data.me.name} · {formatPhone(data.me.phone)}</p>
		<form method="POST" action="/logout"><button class="btn ghost sm">Sign out</button></form>
	</section>
</div>

<style>
	.two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	a.plate {
		text-decoration: none;
	}
</style>
