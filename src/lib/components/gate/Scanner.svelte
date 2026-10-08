<script lang="ts">
	import { onMount } from 'svelte';
	let { ondetect, onerror }: { ondetect: (text: string) => void; onerror: (msg: string) => void } = $props();
	let video: HTMLVideoElement;
	let torchAvailable = $state(false);
	let torchOn = $state(false);
	let scanner: import('qr-scanner').default | null = null;

	onMount(() => {
		let stopped = false;
		(async () => {
			try {
				// Loaded only on the gate, only when scanning: keeps the app shell light.
				const QrScanner = (await import('qr-scanner')).default;
				if (stopped) return;
				scanner = new QrScanner(
					video,
					(result) => {
						scanner?.stop();
						ondetect(result.data);
					},
					{ preferredCamera: 'environment', highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 8 }
				);
				await scanner.start();
				torchAvailable = await scanner.hasFlash();
			} catch (err) {
				const name = (err as Error)?.name ?? String(err);
				onerror(
					/NotAllowed|Permission/i.test(name)
						? 'Camera blocked. Allow camera access for this site in the browser settings, or use Enter code.'
						: 'Camera not available on this phone. Use Enter code instead.'
				);
			}
		})();
		return () => {
			stopped = true;
			scanner?.destroy();
		};
	});

	async function toggleTorch() {
		await scanner?.toggleFlash();
		torchOn = !!scanner?.isFlashOn();
	}
</script>

<div class="cam">
	<!-- svelte-ignore a11y_media_has_caption -->
	<video bind:this={video} playsinline muted></video>
	{#if torchAvailable}
		<button type="button" class="torch" onclick={toggleTorch}>{torchOn ? 'Torch off' : 'Torch on'}</button>
	{/if}
</div>

<style>
	.cam {
		position: relative;
		border-radius: var(--r-lg);
		overflow: hidden;
		background: #000;
		aspect-ratio: 3 / 4;
		max-height: 62vh;
		margin: 0 auto;
		width: 100%;
	}
	video {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.torch {
		position: absolute;
		bottom: 12px;
		left: 50%;
		transform: translateX(-50%);
		min-height: 44px;
		padding: 0 16px;
		border-radius: 999px;
		border: 0;
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		font: inherit;
		font-weight: 600;
	}
</style>
