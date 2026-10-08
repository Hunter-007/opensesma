<script lang="ts">
	import { onMount } from 'svelte';
	import { enablePush, pushState, type PushState } from '$lib/client/push';
	let { vapidKey }: { vapidKey: string | null } = $props();
	let status = $state<PushState | 'loading'>('loading');
	let busy = $state(false);

	onMount(async () => {
		status = await pushState();
	});

	async function turnOn() {
		if (!vapidKey) return;
		busy = true;
		try {
			status = await enablePush(vapidKey);
		} catch {
			status = 'off';
		}
		busy = false;
	}
</script>

{#if vapidKey && status === 'off'}
	<div class="card prompt">
		<div>
			<strong>Get told when visitors arrive</strong>
			<p class="small muted">Turn on alerts so you can let in unexpected visitors with one tap. Otherwise we'll text you.</p>
		</div>
		<button class="btn primary sm" onclick={turnOn} disabled={busy}>{busy ? 'Turning on…' : 'Turn on alerts'}</button>
	</div>
{:else if vapidKey && status === 'needs-install'}
	<div class="card prompt">
		<p class="small muted">
			On iPhone, add OpenSesma to your home screen (Share → Add to Home Screen) to get arrival alerts. Until then we'll text you.
		</p>
	</div>
{:else if status === 'denied'}
	<p class="small muted">Alerts are blocked in your browser settings, so we'll text you about visitors instead.</p>
{/if}

<style>
	.prompt {
		display: flex;
		gap: 12px;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
	}
	.prompt p {
		margin: 4px 0 0;
	}
</style>
