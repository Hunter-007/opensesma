<script lang="ts">
	let { length = 6, value = $bindable(''), onsubmit, label = 'Code', mask = false }: { length?: number; value?: string; onsubmit: (v: string) => void; label?: string; mask?: boolean } = $props();

	const press = (d: string) => {
		if (value.length < length) value += d;
		if (value.length === length) onsubmit(value);
	};
	const back = () => (value = value.slice(0, -1));

	function onkey(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
		if (/^\d$/.test(e.key)) press(e.key);
		else if (e.key === 'Backspace') back();
		else if (e.key === 'Enter' && value.length) onsubmit(value);
	}
</script>

<svelte:window onkeydown={onkey} />

<div class="pad">
	<div class="display" aria-label={label} aria-live="polite">
		{#each Array(length) as _, i}
			<span class="slot" class:filled={i < value.length}>{i < value.length ? (mask ? '•' : value[i]) : ''}</span>
		{/each}
	</div>
	<div class="keys">
		{#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as d}
			<button type="button" onclick={() => press(d)}>{d}</button>
		{/each}
		<button type="button" class="aux" onclick={() => (value = '')} aria-label="Clear">Clear</button>
		<button type="button" onclick={() => press('0')}>0</button>
		<button type="button" class="aux" onclick={back} aria-label="Delete last digit">⌫</button>
	</div>
</div>

<style>
	.pad {
		display: grid;
		gap: 16px;
	}
	.display {
		display: flex;
		gap: 6px;
		justify-content: center;
	}
	.slot {
		width: 44px;
		height: 60px;
		display: grid;
		place-items: center;
		font-family: var(--font-plate);
		font-weight: 700;
		font-size: 2rem;
		border-radius: 6px;
		background: var(--card);
		border: 2px solid var(--line);
	}
	.slot.filled {
		background: var(--plate);
		color: var(--plate-ink);
		border-color: var(--plate-ink);
	}
	.keys {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}
	.keys button {
		min-height: 64px;
		font: inherit;
		font-size: 1.75rem;
		font-weight: 700;
		border-radius: var(--r);
		border: 1px solid var(--line);
		background: var(--card);
		color: var(--ink);
		cursor: pointer;
		touch-action: manipulation;
	}
	.keys button:active {
		background: color-mix(in srgb, var(--gate) 15%, var(--card));
	}
	.keys .aux {
		font-size: 1.125rem;
		color: var(--muted);
	}
</style>
