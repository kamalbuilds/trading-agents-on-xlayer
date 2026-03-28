import { createWalletClient, createPublicClient, http, defineChain, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env.local') });

// X Layer Testnet chain definition
const xlayerTestnet = defineChain({
  id: 1952,
  name: 'X Layer Testnet',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testrpc.xlayer.tech'] },
  },
  blockExplorers: {
    default: { name: 'X Layer Explorer', url: 'https://www.okx.com/web3/explorer/xlayer-test' },
  },
  testnet: true,
});

async function main() {
  const privateKey = process.env.WALLET_KEY;
  if (!privateKey) {
    console.error('ERROR: WALLET_KEY not found in .env.local');
    process.exit(1);
  }

  console.log('=== X Layer Testnet Transaction ===\n');

  // Create account from private key
  const account = privateKeyToAccount(privateKey);
  console.log('Wallet address:', account.address);

  // Create clients
  const publicClient = createPublicClient({
    chain: xlayerTestnet,
    transport: http(),
  });

  const walletClient = createWalletClient({
    account,
    chain: xlayerTestnet,
    transport: http(),
  });

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log('OKB Balance:', formatEther(balance), 'OKB');

  if (balance === 0n) {
    console.error('ERROR: No OKB balance. Get testnet OKB from https://www.okx.com/xlayer/faucet');
    process.exit(1);
  }

  // Send a self-transfer (0.001 OKB to self) as proof of on-chain activity
  const amount = parseEther('0.001');
  console.log(`\nSending ${formatEther(amount)} OKB to self (${account.address})...`);

  try {
    const hash = await walletClient.sendTransaction({
      to: account.address,
      value: amount,
    });

    console.log('\n✅ Transaction sent!');
    console.log('TX Hash:', hash);
    console.log(`Explorer: https://www.okx.com/web3/explorer/xlayer-test/tx/${hash}`);

    // Wait for confirmation
    console.log('\nWaiting for confirmation...');
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log('Status:', receipt.status === 'success' ? '✅ Confirmed' : '❌ Failed');
    console.log('Block:', receipt.blockNumber.toString());
    console.log('Gas used:', receipt.gasUsed.toString());

    // Check new balance
    const newBalance = await publicClient.getBalance({ address: account.address });
    console.log('\nNew balance:', formatEther(newBalance), 'OKB');
    console.log('Gas cost:', formatEther(balance - newBalance - amount), 'OKB');

    console.log('\n=== SAVE THIS TX HASH FOR HACKATHON SUBMISSION ===');
    console.log('TX Hash:', hash);
  } catch (err) {
    console.error('Transaction failed:', err.message || err);
    if (err.details) console.error('Details:', err.details);
    process.exit(1);
  }
}

main();
