<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	let { children } = $props();

	onMount(() => {
		if ('serviceWorker' in navigator && !import.meta.env.DEV) {
			navigator.serviceWorker.register('/service-worker.js', { type: 'module' }).catch(() => {});
		}
	});
</script>

{@render children()}
