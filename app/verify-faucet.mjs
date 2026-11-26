// verify-faucet.mjs — run from the app/ folder:  node verify-faucet.mjs
// Reads FAUCET_KEYPAIR_SECRET from ./.env.local, derives ONLY the public key,
// and checks it against the dedicated faucet keypair. The secret never leaves
// this machine and is never printed.
import { readFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';

const EXPECTED = '2BdTqQiUEe1wVwsWT3NuWKFTirCYLGvdFnJwTbdDwfaa';

const env = readFileSync(new URL('./.env.local', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('FAUCET_KEYPAIR_SECRET='));
if (!line) {
  console.log('FAIL: FAUCET_KEYPAIR_SECRET tidak ditemukan di .env.local');
  process.exit(1);
}
const b64 = line.slice('FAUCET_KEYPAIR_SECRET='.length).trim();
let pub;
try {
  pub = Keypair.fromSecretKey(Buffer.from(b64, 'base64')).publicKey.toBase58();
} catch (e) {
  console.log('FAIL: nilai tidak bisa didekode sebagai keypair Solana:', e.message);
  process.exit(1);
}
console.log('Public key dari .env.local:', pub);
console.log(
  pub === EXPECTED
    ? 'OK — ini keypair faucet khusus (2BdT...Dwfaa). Siap deploy.'
    : 'BELUM DIGANTI — ini bukan keypair faucet khusus. Nilai lama tidak akan bisa mint.'
);
