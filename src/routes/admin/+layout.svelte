<script lang="ts">
	import { page } from '$app/state';
	import { ROLE_LABEL } from '$lib/shared/types';
	let { data, children } = $props();
	const nav = [
		{ href: '/admin', label: 'Overview' },
		{ href: '/admin/log', label: 'Gate log' },
		{ href: '/admin/units', label: 'Houses & dues' },
		{ href: '/admin/people', label: 'People' },
		{ href: '/admin/devices', label: 'Gate phones' },
		{ href: '/admin/bans', label: 'Ban list' },
		{ href: '/admin/reports', label: 'Reports' },
		{ href: '/admin/settings', label: 'Settings' }
	];
	const active = (href: string) => (href === '/admin' ? page.url.pathname === '/admin' : page.url.pathname.startsWith(href));
</script>

<div class="admin">
	<aside>
		<div class="id">
			<div class="estate">{data.estate.name}</div>
			<div class="who">{data.me.name} · {ROLE_LABEL[data.me.role]}</div>
		</div>
		<nav aria-label="Admin">
			{#each nav as n}
				<a href={n.href} aria-current={active(n.href) ? 'page' : undefined}>{n.label}</a>
			{/each}
		</nav>
		<form method="POST" action="/logout" class="out"><button class="btn ghost sm">Sign out</button></form>
	</aside>
	<main>{@render children()}</main>
</div>

<style>
	.admin {
		min-height: 100dvh;
	}
	aside {
		background: var(--gate);
		color: var(--gate-ink);
		padding: 12px 16px 0;
	}
	.estate {
		font-weight: 800;
		font-size: 1.0625rem;
	}
	.who {
		font-size: 0.8125rem;
		opacity: 0.8;
	}
	nav {
		display: flex;
		gap: 4px;
		overflow-x: auto;
		margin: 12px -16px 0;
		padding: 0 16px;
		scrollbar-width: none;
	}
	nav a {
		color: var(--gate-ink);
		opacity: 0.8;
		text-decoration: none;
		font-weight: 600;
		font-size: 0.9375rem;
		padding: 10px 12px;
		white-space: nowrap;
		border-bottom: 3px solid transparent;
	}
	nav a[aria-current='page'] {
		opacity: 1;
		border-bottom-color: var(--plate);
	}
	.out {
		display: none;
	}
	main {
		padding: 20px 16px 48px;
		max-width: 1100px;
	}
	@media (min-width: 900px) {
		.admin {
			display: grid;
			grid-template-columns: 240px 1fr;
		}
		aside {
			position: sticky;
			top: 0;
			height: 100dvh;
			padding: 20px 12px;
			display: flex;
			flex-direction: column;
		}
		.id {
			padding: 0 12px;
		}
		nav {
			flex-direction: column;
			margin: 24px 0 0;
			padding: 0;
			overflow: visible;
		}
		nav a {
			border-bottom: 0;
			border-left: 3px solid transparent;
			border-radius: 0 6px 6px 0;
		}
		nav a[aria-current='page'] {
			border-left-color: var(--plate);
			background: rgba(255, 255, 255, 0.08);
		}
		.out {
			display: block;
			margin-top: auto;
		}
		.out .btn {
			color: var(--gate-ink);
		}
		main {
			padding: 28px 32px 48px;
		}
	}
</style>
