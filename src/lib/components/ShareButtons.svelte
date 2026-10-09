<script lang="ts">
	/**
	 * WhatsApp and text-message buttons that open the person's own app with the
	 * message filled in. The app sends nothing itself.
	 */
	let { message, phone = null, compact = false }: { message: string; phone?: string | null; compact?: boolean } = $props();

	let copied = $state(false);
	const digits = $derived(phone ? phone.replace(/[^\d]/g, '') : '');
	const wa = $derived(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`);
	// `?&body=` works in both Android and iPhone messaging apps; WhatsApp's
	// *bold* markers would show as literal asterisks in a text.
	const sms = $derived(`sms:${phone ?? ''}?&body=${encodeURIComponent(message.replace(/\*/g, ''))}`);

	async function copy() {
		try {
			await navigator.clipboard.writeText(message);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			/* clipboard blocked */
		}
	}
</script>

<div class="share" class:compact>
	<a class="btn primary wa" class:sm={compact} href={wa} target="_blank" rel="noopener">WhatsApp</a>
	<a class="btn primary txt" class:sm={compact} href={sms}>Text message</a>
	<button type="button" class="btn ghost" class:sm={compact} onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
</div>

<style>
	.share {
		display: grid;
		grid-template-columns: 1fr 1fr auto;
		gap: 8px;
	}
	.wa {
		background: #1f8a4c;
		border-color: #1f8a4c;
	}
</style>
