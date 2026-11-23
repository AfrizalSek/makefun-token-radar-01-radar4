// radar-4 — farm plans.
//
// Six concrete steps per protocol, built from that protocol's own
// snapshot fields: its first chain, its category, its TVL tier, how long
// it has run, and whether it is on the watchlist. Nothing here promises
// a token: every step is an action with a cost and a time, and step five
// says to check the protocol's own page for a points or qualification
// program and never to pay to take part.

import type { Proto } from './radar4.ts';

const CATEGORY_ACTION: Record<string, string> = {
  Lending: 'supply assets to a lending pool',
  Dexs: 'swap a small amount and add liquidity to a pool',
  Yield: 'deposit into a yield vault',
  'Yield Aggregator': 'deposit into an aggregator vault',
  Derivatives: 'open a small position on a derivatives market',
  RWA: 'take a position in a tokenised real-world-asset vault',
  CDP: 'open a collateralised debt position',
  'Basis Trading': 'take a position in a basis-trading vault',
  'Risk Curators': 'deposit into a curated vault',
  'Onchain Capital Allocator': 'allocate to a managed onchain vault',
  Chain: 'bridge a small amount onto the chain and use a native app',
  'Staking Pool': 'stake with the pool',
  'Liquidity Manager': 'deposit into a managed liquidity position',
  'Leveraged Farming': 'open a small leveraged farming position',
  Farm: 'deposit into a farm pool',
  Launchpad: 'take part in a launchpad allocation',
  Indexes: 'buy into an index vault',
  'Cross Chain Bridge': 'bridge a small amount across chains',
  'Anchor BTC': 'deposit BTC-backed collateral',
  'Decentralized BTC': 'use a BTC-backed product on the chain',
  Synthetics: 'mint a small synthetic position',
  'Options Vault': 'deposit into an options vault',
  Insurance: 'buy cover from the insurance pool',
  'Prediction Market': 'place a small prediction-market position',
  Payments: 'make a payment through the protocol',
  Privacy: 'use a private transaction feature',
  'Algo-Stables': 'take a position in the stablecoin system',
  'Dual-Token Stablecoin': 'mint a small stablecoin position',
  'Uncollateralized Lending': 'supply to an uncollateralised lending pool',
  'Interest Rate Derivatives': 'open a small rates position',
  'OTC Marketplace': 'place a small OTC order',
  'Stablecoin Issuer': 'mint a small amount of the stablecoin',
  'Stablecoin Wrapper': 'wrap a small amount of stablecoin',
  'Governance Incentives': 'vote on a governance proposal',
  'Collateral Markets': 'supply collateral to a market',
  'Reserve Currency': 'take a position in the reserve system',
  'CDP Manager': 'manage a small CDP position',
  'CeDeFi': 'deposit into a CeDeFi vault',
  'Token Locker': 'lock a small token position',
  'Crypto Card Issuer': 'order a card and make a first payment',
  'Options': 'open a small options position',
};

function tierOf(tvl: number): { label: string; amount: number; gas: string } {
  if (tvl >= 500_000_000) return { label: 'a large-protocol position', amount: 500, gas: 'about $6 of gas' };
  if (tvl >= 25_000_000) return { label: 'a mid-size position', amount: 150, gas: 'about $4 of gas' };
  return { label: 'a small early position', amount: 50, gas: 'about $2 of gas' };
}

function gasNote(chain: string): string {
  if (chain === 'Ethereum') return 'Ethereum gas is the dearest part of this plan, so check the fee before each action';
  return `On ${chain}, gas is usually under $1 per action, so check the fee before each action`;
}

export function buildPlan(p: Proto, ageDays: number, watchlist: boolean): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const action = CATEGORY_ACTION[p.category ?? ''] ?? 'use the protocol’s main product with a small amount';
  const tier = tierOf(p.tvl_usd);
  const watch = watchlist ? ' This protocol is on the snapshot watchlist, so keep the wallet separate from your main funds.' : '';
  const ageNote =
    ageDays < 180
      ? ' The protocol has run for under six months, so treat the first month as a trial and keep the amount small.'
      : ageDays >= 1095
        ? ' The protocol has run for three years or more with no token recorded, so a steady position matters more than a large one.'
        : ' The protocol has run for over six months, so a regular position is the useful signal.';
  const cat = p.category ?? 'DeFi';
  return [
    `Use a fresh wallet on ${chain} that holds only the funds you plan to farm, and keep its seed phrase offline.${watch} Cost: under $4 of gas for the first transaction. Time: 5 minutes.`,
    `On ${chain}, ${action} in ${p.name} with $${tier.amount} of capital, as ${tier.label} in ${cat}. Cost: $${tier.amount} of capital and ${tier.gas}. Time: 15 minutes to set up.`,
    `Once a week, review the position in ${p.name} and add a second small action on ${chain}, such as a top-up or a move to a second pool. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least 30 days so the activity is counted in more than one snapshot.${ageNote} ${gasNote(chain)}. Cost: the $${tier.amount} stays in the position. Time: 30 days.`,
    `Check ${p.name}’s official page on ${chain} for any points or qualification program and whether this position counts; follow only a link the protocol itself publishes, and never pay to take part. Cost: no fee to check. Time: 10 minutes.`,
    `Write the wallet, the dates and every transaction in a farm log, with the $${tier.amount} position in ${p.name} on ${chain} marked as ${tier.label} in ${cat}${watchlist ? ', marked as a watchlist position' : ''}, so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.`,
  ];
}
