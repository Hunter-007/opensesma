<script lang="ts">
	import { enhance } from '$app/forms';
	import ShareButtons from '$lib/components/ShareButtons.svelte';
	import { formatPhone } from '$lib/shared/phone';
	let { data, form } = $props();
	let mode = $state<'none' | 'add' | 'import'>('none');
	let inviting = $state<string | null>(null);
	const f = $derived(form as Record<string, unknown> | null);
	const invite = $derived(f?.invite as { name: string; phone: string; message: string } | undefined);
	const preview = $derived(f?.preview as { csv: string; valid: { line: number; street: string; number: string; name: string; phone: string | null }[]; validCount: number; errors: { line: number; message: string; raw: string }[] } | undefined);
	const sample = 'street,number,name,phone\nAdeyemi Street,14,Bello Musa,0803 111 2222\nAdeyemi Street,15,,\nOkafor Close,2,Chidi Nwosu,08031112224';
	const sampleHref = `data:text/csv;charset=utf-8,${encodeURIComponent(sample)}`;
</script>

<svelte:head><title>Houses & dues · OpenSesma admin</title></svelte:head>

<div class="stack">
	<div class="spread">
		<h1>Houses & dues</h1>
		<div class="row">
			<button class="btn sm" onclick={() => (mode = mode === 'add' ? 'none' : 'add')}>Add a house</button>
			<button class="btn sm primary" onclick={() => (mode = mode === 'import' ? 'none' : 'import')}>Import spreadsheet</button>
		</div>
	</div>

	{#if f?.ok}<p class="alert ok">{f.ok}</p>{/if}
	{#if invite}
		<section class="card stack" aria-label="Send invite">
			<p><strong>Send the invite to {invite.name || formatPhone(invite.phone)}</strong>{invite.name ? ` (${formatPhone(invite.phone)})` : ''}</p>
			<ShareButtons message={invite.message} phone={invite.phone} />
			<p class="small muted">Opening the link and tapping Join signs them in. It works once, for 14 days.</p>
		</section>
	{/if}
	{#if f?.error}<p class="alert error" role="alert">{f.error}</p>{/if}

	{#if mode === 'add'}
		<form method="POST" action="?/add" use:enhance class="card grid-form">
			<label class="field"><span>Street or block</span><input name="street" type="text" placeholder="Adeyemi Street" required /></label>
			<label class="field"><span>House number</span><input name="number" type="text" placeholder="14" required /></label>
			<label class="field"><span>Resident's name (optional)</span><input name="name" type="text" /></label>
			<label class="field"><span>Resident's phone (optional)</span><input name="phone" type="tel" inputmode="tel" /></label>
			<div class="row full"><button class="btn primary">Add house</button><span class="small muted">With a phone number, you get an invite to send on WhatsApp or by text.</span></div>
		</form>
	{/if}

	{#if mode === 'import' || preview}
		{#if preview}
			<section class="card stack">
				<h2>Check before importing</h2>
				<p>{preview.validCount} houses ready{preview.errors.length ? `, ${preview.errors.length} rows need fixing (they'll be skipped)` : ''}.</p>
				{#if preview.errors.length}
					<ul class="errors small">
						{#each preview.errors as e}<li>Row {e.line}: {e.message} <span class="muted">({e.raw})</span></li>{/each}
					</ul>
				{/if}
				<div class="table-wrap">
					<table>
						<thead><tr><th>Row</th><th>House</th><th>Resident</th><th>Phone</th></tr></thead>
						<tbody>
							{#each preview.valid.slice(0, 20) as r}<tr><td>{r.line}</td><td>{r.number} {r.street}</td><td>{r.name}</td><td>{r.phone ?? ''}</td></tr>{/each}
						</tbody>
					</table>
				</div>
				{#if preview.validCount > 20}<p class="small muted">…and {preview.validCount - 20} more.</p>{/if}
				<form method="POST" action="?/import" use:enhance class="stack">
					<input type="hidden" name="csv" value={preview.csv} />
					{#if data.smsInvites}<label class="row"><input type="checkbox" name="sendInvites" checked /> Text each resident their invite link now</label>{/if}
					<div class="row"><button class="btn primary">Import {preview.validCount} houses</button><a class="btn ghost" href="/admin/units">Cancel</a></div>
				</form>
			</section>
		{:else}
			<form method="POST" action="?/preview" enctype="multipart/form-data" use:enhance class="card stack">
				<h2>Import houses from a spreadsheet</h2>
				<p class="small muted">
					Save your sheet as CSV with columns <strong>street, number, name, phone</strong>. Name and phone can be empty.
					<a href={sampleHref} download="opensesma-houses.csv">Download a sample</a>.
				</p>
				<input type="file" name="file" accept=".csv,text/csv" />
				<details><summary class="small">Or paste rows</summary><textarea name="csv" placeholder={sample}></textarea></details>
				<button class="btn primary">Check file</button>
			</form>
		{/if}
	{/if}

	<div class="row">
		<span class="muted small">{data.total} houses</span>
		<a class="btn sm" class:primary={!data.dues} href="/admin/units">All</a>
		<a class="btn sm" class:primary={data.dues === 'owing'} href="/admin/units?dues=owing">Owing</a>
		<a class="btn sm" class:primary={data.dues === 'paid'} href="/admin/units?dues=paid">Paid</a>
	</div>

	{#if !data.units.length}
		<p class="muted">{data.total ? 'No houses match.' : 'No houses yet. Import your resident list to get started.'}</p>
	{:else}
		<div class="table-wrap">
			<table>
				<thead><tr><th>House</th><th>Residents</th><th>Dues</th><th></th></tr></thead>
				<tbody>
					{#each data.units as u (u.id)}
						<tr class:inactive={!u.active}>
							<td><strong>{u.label}</strong>{#if !u.active}<br /><span class="chip">Inactive</span>{/if}</td>
							<td class="small">{u.residents.length ? u.residents.join(', ') : '—'}</td>
							<td>
								<form method="POST" action="?/dues" use:enhance class="row">
									<input type="hidden" name="unitId" value={u.id} />
									<select name="status" class="dues dues-{u.duesStatus}" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
										<option value="unknown" selected={u.duesStatus === 'unknown'}>Not set</option>
										<option value="paid" selected={u.duesStatus === 'paid'}>Paid</option>
										<option value="owing" selected={u.duesStatus === 'owing'}>Owing</option>
									</select>
								</form>
							</td>
							<td class="actions">
								{#if inviting === u.id}
									<form method="POST" action="?/invite" use:enhance class="inv">
										<input type="hidden" name="unitId" value={u.id} />
										<input name="name" type="text" placeholder="Name" />
										<input name="phone" type="tel" inputmode="tel" placeholder="Phone" required />
										<button class="btn sm primary">Create invite</button>
									</form>
								{:else}
									<button class="btn sm" onclick={() => (inviting = u.id)}>Invite resident</button>
								{/if}
								<form method="POST" action="?/toggle" use:enhance>
									<input type="hidden" name="unitId" value={u.id} />
									<input type="hidden" name="active" value={String(!u.active)} />
									<button class="btn sm ghost">{u.active ? 'Deactivate' : 'Reactivate'}</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="small muted">
			Dues status is used by your levy rule (Settings): currently <strong>{data.estate.settings.levyRule === 'off' ? 'off' : data.estate.settings.levyRule === 'warn' ? 'guards see a warning' : 'event and multi-day passes paused for owing houses'}</strong>.
		</p>
	{/if}
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
	.errors {
		color: var(--deny);
		margin: 0;
		padding-left: 1.2em;
	}
	.dues {
		min-height: 36px;
		padding: 4px 8px;
		width: auto;
	}
	.dues-owing {
		color: var(--deny);
		font-weight: 600;
	}
	.dues-paid {
		color: var(--allow);
		font-weight: 600;
	}
	.actions {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	.inv {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.inv input {
		min-height: 36px;
		width: 140px;
	}
	tr.inactive td {
		opacity: 0.6;
	}
</style>
