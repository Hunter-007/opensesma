<script lang="ts">
	let { data } = $props();
</script>

<svelte:head><title>SMS outbox (dev)</title></svelte:head>
<main class="wrap stack" style="padding:24px 16px">
	<h1>SMS outbox</h1>
	<p class="muted small">Development only. With SMS_DRIVER=console, texts land here instead of a phone. Refresh to update.</p>
	{#if !data.messages.length}<p class="muted">No messages yet.</p>{/if}
	<ul class="list">
		{#each data.messages as m}
			<li><strong>{m.to}</strong> <span class="small muted">{new Date(m.at).toLocaleTimeString()}</span><br />{m.body}</li>
		{/each}
	</ul>
</main>
