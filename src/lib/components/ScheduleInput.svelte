<script lang="ts">
	let { days = [1, 2, 3, 4, 5, 6], start = '06:00', end = '20:00' }: { days?: number[]; start?: string; end?: string } = $props();
	const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const order = [1, 2, 3, 4, 5, 6, 0];
</script>

<fieldset class="stack">
	<legend>Days they come</legend>
	<div class="days">
		{#each order as d}
			<label class="day">
				<input type="checkbox" name="days" value={d} checked={days.includes(d)} />
				<span>{names[d]}</span>
			</label>
		{/each}
	</div>
	<div class="two">
		<label class="field"><span>From</span><input type="time" name="start" value={start} required /></label>
		<label class="field"><span>Until</span><input type="time" name="end" value={end} required /></label>
	</div>
	<small class="muted">Night shift? Set "Until" earlier than "From", e.g. 20:00 to 06:00.</small>
</fieldset>

<style>
	.days {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 4px;
	}
	.day input {
		position: absolute;
		opacity: 0;
	}
	.day span {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		background: var(--card);
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
	}
	.day input:checked + span {
		background: var(--gate);
		border-color: var(--gate);
		color: var(--gate-ink);
	}
	.day input:focus-visible + span {
		outline: 3px solid var(--focus);
	}
	.two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
</style>
