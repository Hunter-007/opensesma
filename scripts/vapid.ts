// Generate Web Push keys. Put them in .env (and Netlify env vars).
import webpush from 'web-push';
const k = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}`);
