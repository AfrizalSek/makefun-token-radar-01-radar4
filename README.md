[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/AfrizalSek/makefun-token-radar-01-radar4/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/AfrizalSek/makefun-token-radar-01-radar4/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Built for the [make.fun token-radar-01 bounty](https://make.fun/bounty/token-radar-01). Referral: https://make.fun/r/s9c6zfye

# Token Radar — radar-4

A token launch radar for the Make.fun `token-radar-01` bounty: rank
pre-token protocols by what their launch would be worth, fitted from
the live tokens that already trade.

## Model

For each live token, multiple = market cap ÷ TVL. radar-4 fits
log(multiple) by ridge regression on log TVL, seven-day TVL change,
log age and category, with a separate shrinkage penalty per feature
group, chosen by leave-one-out + walk-forward error. Seven-day growth
and age are fitted inputs; the data shrinks their weights to almost
nothing, and the dashboard says so instead of inventing multipliers.

Each row carries a calibrated 80% range (from leave-one-out
residuals), token-odds — the chance its true multiple beats the
median live multiple — and a verdict (Strong / Watch / Weak).

## Validation (computed by the program on the same snapshot)

| Check | radar-4 | Kernel-median baseline |
|---|---:|---:|
| Leave-one-out median |log error| | 1.196 | 1.331 |
| Walk-forward pooled median |log error| | 0.976 | 1.087 |

The board ranks 333 pre-token protocols (all 40 watchlist protocols
covered, plus early finds). Wrapped, staked, bridged, versioned and
exchange products are left out on purpose.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22, standard library only. No network at run time or in the
dashboard.

## License

MIT.
