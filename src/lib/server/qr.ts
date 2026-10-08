import QRCode from 'qrcode';

/** Inline SVG QR (a few KB, no image request, crisp at any size). */
export async function qrSvg(text: string): Promise<string> {
	return QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } });
}
