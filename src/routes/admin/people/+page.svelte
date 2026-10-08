<script lang="ts">
	import { enhance } from '$app/forms';
	import { ROLE_LABEL } from '$lib/shared/types';
	import { formatPhone } from '$lib/shared/phone';
	import { relativeTime } from '$lib/shared/format';
	let { data, form } = $props();
	let adding = $state(false);
	let role = $state('guard');
	let pinFor = $state<string | null>(null);
	let q = $state('');
	const f = $derived(form as Record<string, unknown> | null);
	const v = $derived((f?.values ?? {}) as Record<string, string>);
	const shown = $derived(
		q.trim() ? data.residents.filter((r) => `${r.name} ${r.phone} ${r.unitLabel}`.toLowerCase().includes(q.trim().toLowerCase())) : data.residents
	);
</script>

<svelte:head><title>People · OpenSesma admin</title></svelte:head>

<div class="stack">
	<h1>People</h1>
	{#if f?.ok}<p class="alert ok">{f.ok}</p>{/if}
	{#if f?.error}<p class="alert error" role="alert">{f.error}</p>{/if}

	{#if data.pending.length}
		<section class="stack">
			<h2>Join requests</h2>
			<ul class="list">
				{#each data.pending as m (m.id)}
					<li class="stack">
						<div class="spread">
							<span><strong>{m.name || formatPhone(m.phone)}</strong> wants to join <strong>{m.unitLabel}</strong></span>
							<span class="small muted">{relativeTime(m.createdAt)}</span>
						</div>
						<p class="small">“{m.proofNote}” · {formatPhone(m.phone)}</p>
						<form method="POST" action="?/decide" use:enhance class="row">
							<input type="hidden" name="membershipId" value={m.id} />
							<button class="btn sm primary" name="decision" value="approve">Approve</button>
							<button class="btn sm danger" name="decision" value="reject">Decline</button>
						</form>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="stack">
		<div class="spread">
			<h2>Guards & estate staff</h2>
			<button class="btn sm primary" onclick={() => (adding = !adding)}>Add guard or staff</button>
		</div>
		{#if adding}
			<form method="POST" action="?/addStaff" use:enhance class="card grid-form">
				<label class="field"><span>Role</span>
					<select name="role" bind:value={role}>
						<option value="guard">Guard</option>
						{#if data.canManageAdmins}<option value="security_officer">Security officer</option><option value="estate_admin">Estate manager</option>{/if}
					</select></label>
				<label class="field"><span>Name</span><input name="name" type="text" value={v.name ?? ''} required /></label>
				<label class="field"><span>Phone</span><input name="phone" type="tel" inputmode="tel" value={v.phone ?? ''} required /></label>
				{#if role === 'guard'}
					<label class="field"><span>4-digit PIN</span><input name="pin" type="text" inputmode="numeric" pattern={"[0-9]{4}"} maxlength="4" required />
						<small>The guard types this on the gate phone to start a shift.</small></label>
				{/if}
				<div class="row full"><button class="btn primary">Add</button><button type="button" class="btn ghost" onclick={() => (adding = false)}>Cancel</button></div>
			</form>
		{/if}
		{#if !data.staff.length}
			<p class="muted">No guards yet.</p>
		{:else}
			<div class="table-wrap">
				<table>
					<thead><tr><th>Name</th><th>Role</th><th>Phone</th><th></th></tr></thead>
					<tbody>
						{#each data.staff as m (m.id)}
							<tr>
								<td><strong>{m.name}</strong></td>
								<td>{ROLE_LABEL[m.role]}{m.role === 'guard' && !m.hasPin ? ' · no PIN' : ''}</td>
								<td>{formatPhone(m.phone)}</td>
								<td class="actions">
									{#if m.role === 'guard'}
										{#if pinFor === m.id}
											<form method="POST" action="?/pin" use:enhance class="row">
												<input type="hidden" name="membershipId" value={m.id} />
												<input name="pin" type="text" inputmode="numeric" pattern={"[0-9]{4}"} maxlength="4" placeholder="New PIN" required class="pin" />
												<button class="btn sm primary">Save</button>
											</form>
										{:else}
											<button class="btn sm" onclick={() => (pinFor = m.id)}>Change PIN</button>
										{/if}
									{/if}
									{#if m.userId !== data.me.id}
										<form method="POST" action="?/remove" use:enhance><input type="hidden" name="membershipId" value={m.id} /><button class="btn sm ghost danger">Remove</button></form>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<section class="stack">
		<div class="spread">
			<h2>Residents ({data.residents.length})</h2>
			<input type="search" bind:value={q} placeholder="Search name, phone or house" class="search" />
		</div>
		{#if !data.residents.length}
			<p class="muted">No residents have joined yet. Invite them from <a href="/admin/units">Houses</a> or share the join link from <a href="/admin/settings#join">Settings</a>.</p>
		{:else}
			<div class="table-wrap">
				<table>
					<thead><tr><th>House</th><th>Name</th><th>Phone</th><th>Role</th><th></th></tr></thead>
					<tbody>
						{#each shown as m (m.id)}
							<tr>
								<td>{m.unitLabel}</td>
								<td>{m.name}</td>
								<td>{formatPhone(m.phone)}</td>
								<td class="small">{ROLE_LABEL[m.role]}</td>
								<td class="actions"><form method="POST" action="?/remove" use:enhance><input type="hidden" name="membershipId" value={m.id} /><button class="btn sm ghost danger">Remove</button></form></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>

<style>
	.grid-form {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 12px;
	}
	.full {
		grid-column: 1 / -1;
	}
	.actions {
		display: flex;
		gap: 6px;
		justify-content: flex-end;
		flex-wrap: wrap;
	}
	.pin {
		width: 110px;
		min-height: 36px;
	}
	.search {
		max-width: 280px;
		min-height: 40px;
	}
</style>
