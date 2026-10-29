import webpush from 'web-push';

// Prints a fresh VAPID key pair as environment variables. Run once per installation: `npm run push:keys`.
const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:owner@example.com   # replace with a real contact address');
