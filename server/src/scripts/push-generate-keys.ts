/**
 * Mint the Web Push application key pair — `npm run push:generate-keys -w @mantua/server`.
 *
 * Prints a fresh VAPID pair (task 071, MX-004) to YOUR terminal and nowhere
 * else. Copy the three lines into `server/.env` (gitignored) and the
 * hosting env. Rotating the pair invalidates every existing subscription:
 * browsers re-subscribe on their next visit, so rotate deliberately.
 */
import { generateVapidKeys } from "../lib/push/vapid.ts";

const keys = generateVapidKeys();
console.log("\nAdd to server/.env and the hosting env:\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("VAPID_SUBJECT=mailto:ops@mantua.ai\n");
console.log("The private key is the sender's identity: keep it out of git and out of logs.\n");
