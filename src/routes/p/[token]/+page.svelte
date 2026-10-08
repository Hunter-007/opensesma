<script lang="ts">
	import { formatCode } from '$lib/shared/encoding';
	let { data } = $props();
</script>

<svelte:head>
	<title>Gate pass · {data.estateName}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class:off={data.state === 'cancelled' || data.state === 'finished'}>
	<header>
		<p class="estate">{data.estateName}</p>
		<h1>{data.name ? `${data.name.split(' ')[0]}, show this at the gate` : 'Show this at the gate'}</h1>
	</header>

	{#if data.state === 'cancelled'}
		<p class="banner">This pass was cancelled by your host.</p>
	{:else if data.state === 'finished'}
		<p class="banner">This pass has expired or been used.</p>
	{:else if data.state === 'upcoming'}
		<p class="banner soon">Not active yet — valid {data.when}.</p>
	{/if}

	<section class="pass">
		<div class="qr">{@html data.qr}</div>
		<p class="or">or tell the guard this code</p>
		<p class="plate">{formatCode(data.code)}</p>
	</section>

	<dl>
		<dt>Visiting</dt>
		<dd>{data.unit}{data.hostName ? ` (${data.hostName})` : ''}</dd>
		<dt>Valid</dt>
		<dd>{data.when}</dd>
		{#if data.group}<dt>Group</dt><dd>Up to {data.group} people can use this code</dd>{/if}
		{#if data.address}<dt>Address</dt><dd>{data.address}</dd>{/if}
		{#if data.directions}<dt>Directions</dt><dd>{data.directions}</dd>{/if}
	</dl>

	<p class="foot">Gate passes by OpenSesma</p>
</main>

<style>
	main {
		max-width: 420px;
		margin: 0 auto;
		padding: 20px 16px 32px;
	}
	.estate {
		color: var(--muted);
		margin: 0;
		font-size: 0.875rem;
	}
	h1 {
		font-size: 1.35rem;
		margin-top: 4px;
	}
	.banner {
		background: color-mix(in srgb, var(--deny) 12%, var(--card));
		color: var(--deny);
		padding: 10px 12px;
		border-radius: 8px;
		font-weight: 600;
	}
	.banner.soon {
		background: color-mix(in srgb, var(--wait) 14%, var(--card));
		color: color-mix(in srgb, var(--wait) 70%, var(--ink));
	}
	.off .pass {
		opacity: 0.35;
		filter: grayscale(1);
	}
	.pass {
		background: #fff;
		border-radius: 16px;
		border: 1px solid var(--line);
		padding: 20px;
		text-align: center;
		margin: 16px 0;
	}
	.qr {
		width: min(260px, 72vw);
		margin: 0 auto;
	}
	.qr :global(svg) {
		width: 100%;
		height: auto;
		display: block;
	}
	.or {
		color: #555;
		margin: 12px 0 6px;
		font-size: 0.875rem;
	}
	.plate {
		font-size: 2.8rem;
		padding: 4px 18px;
		margin: 0;
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 6px 16px;
	}
	dt {
		color: var(--muted);
	}
	dd {
		margin: 0;
	}
	.foot {
		text-align: center;
		color: var(--muted);
		font-size: 0.75rem;
		margin-top: 24px;
	}
</style>
