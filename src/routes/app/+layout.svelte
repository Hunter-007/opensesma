<script lang="ts">
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	let { data, children } = $props();

	const tabs = [
		{ href: '/app', label: 'Passes' },
		{ href: '/app/invite', label: 'Invite' },
		{ href: '/app/household', label: 'Household' },
		{ href: '/app/history', label: 'History' }
	];
	const current = (href: string) => (href === '/app' ? page.url.pathname === '/app' : page.url.pathname.startsWith(href));

	// Keep walk-in requests fresh while the app is open (cheap: one small request every 20 s).
	onMount(() => {
		const t = setInterval(() => document.visibilityState === 'visible' && invalidateAll(), 20_000);
		return () => clearInterval(t);
	});
</script>

<div class="frame">
	<header>
		<div class="wrap spread">
			<div>
				<div class="estate">{data.estate.name}</div>
				<div class="unit">{data.unit.label}</div>
			</div>
			<a class="new btn sm" href="/app/invite">New pass</a>
		</div>
	</header>

	{#if data.pendingWalkins.length && !page.url.pathname.startsWith('/app/walkin')}
		<a class="walkin" href="/app/walkin/{data.pendingWalkins[0].id}">
			<span class="wrap">
				<strong>{data.pendingWalkins[0].name}</strong> is at the {data.pendingWalkins[0].gateName.toLowerCase()} for you. Tap to answer.
			</span>
		</a>
	{/if}

	<main class="wrap">{@render children()}</main>

	<nav aria-label="Main">
		{#each tabs as t}
			<a href={t.href} aria-current={current(t.href) ? 'page' : undefined}>{t.label}</a>
		{/each}
	</nav>
</div>

<style>
	.frame {
		min-height: 100dvh;
		padding-bottom: calc(64px + env(safe-area-inset-bottom));
	}
	header {
		background: var(--gate);
		color: var(--gate-ink);
		padding: 14px 0;
		padding-top: calc(14px + env(safe-area-inset-top));
	}
	.estate {
		font-size: 0.8125rem;
		opacity: 0.8;
	}
	.unit {
		font-weight: 700;
		font-size: 1.0625rem;
	}
	.new {
		background: var(--plate);
		color: var(--plate-ink);
		border-color: var(--plate);
	}
	.walkin {
		display: block;
		background: var(--wait);
		color: #1d1600;
		text-decoration: none;
		padding: 12px 0;
		font-size: 0.9375rem;
	}
	.walkin .wrap {
		display: block;
	}
	main {
		padding-top: 20px;
		padding-bottom: 24px;
	}
	nav {
		position: fixed;
		inset: auto 0 0 0;
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		background: var(--card);
		border-top: 1px solid var(--line);
		padding-bottom: env(safe-area-inset-bottom);
		z-index: 10;
	}
	nav a {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 56px;
		color: var(--muted);
		text-decoration: none;
		font-weight: 600;
		font-size: 0.875rem;
		border-top: 3px solid transparent;
	}
	nav a[aria-current='page'] {
		color: var(--gate-2);
		border-top-color: var(--gate-2);
	}
	@media (prefers-color-scheme: dark) {
		nav a[aria-current='page'] {
			color: #6fd3a3;
			border-top-color: #6fd3a3;
		}
	}
</style>
