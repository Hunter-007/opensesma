<script lang="ts">
	import WalkinDecision from '$lib/components/WalkinDecision.svelte';
	let { data, form } = $props();
</script>

<svelte:head><title>Visitor at the gate · OpenSesma</title></svelte:head>

<WalkinDecision walkin={data.walkin} {form} />
