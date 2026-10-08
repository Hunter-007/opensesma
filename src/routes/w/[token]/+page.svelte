<script lang="ts">
	import WalkinDecision from '$lib/components/WalkinDecision.svelte';
	let { data, form } = $props();
</script>

<svelte:head>
	<title>Visitor at the gate · OpenSesma</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="wrap" style="padding-top:24px;padding-bottom:40px;max-width:480px">
	<WalkinDecision walkin={data.walkin} {form} />
</main>
