# AI usage

ETHGlobal allows AI tools if their use is documented. This file says where and how they were used.

## Tools

- **Claude Code** (Anthropic): writing and reviewing code, research, documentation
- **Cursor**: editor, used by the team

## Before the event (up to `pre-hackathon-baseline`)

Most of the pre-existing code was written by Claude Code under the direction of the project
owner (Nicolas Turnbull / TxWheat). Commits authored "Claude" in the history are those. The owner
set the goals and features, tested the app against real scam cases, reported what was wrong
(e.g. mislabelled addresses, missing transactions, confusing views) and decided what to keep.
Feedback from a professional investigator (consultant) shaped the client-payment intake,
pooling cut-off and Tron support.

## During the event

How we work:

1. The team decides what to build and how (see [docs/HACKATHON_PLAN.md](docs/HACKATHON_PLAN.md),
   which was itself drafted with Claude Code from the owner's ideas).
2. Code drafted by Claude Code is committed **only on a separate branch**, with
   `Co-Authored-By: Claude` in the commit message.
3. The owner reviews each branch and opens and merges the pull request into `master`.
   Nothing reaches `master` without that review.
4. Work written by the team directly is committed under their own name.

Log (updated as work lands):

| Change | Written by | Reviewed / merged by |
|---|---|---|
| Rename to Ashiato; repo links; HACKATHON.md; this file | Claude Code (drafted) | Owner |
| Community labels: EAS version first, then gasless EIP-712 signed labels (owner's call to drop gas): validation, signature checks, Supabase store, API routes, trust scoring, Inspector panel, tests | Claude Code (drafted) | Owner |
| Fixes from the owner's live testing (poisoning, clustering, graph lines, node removal); Tronscan labels | Claude Code (drafted), bugs found and verified by owner | Owner |
| Bridgers cross-chain hops (owner researched the Bridgers API and chose it); email-wallet network fix; app icon | Claude Code (drafted) | Owner |
| DEX swap detection and follow-through; graph layout/zoom fixes from the owner's testing | Claude Code (drafted) | Owner |
| Cleaner auto-trace (spam/dust filter, main-trail only, busy-hub and bridge stops, both directions) from the owner's live cases | Claude Code (drafted), problems found by owner | Owner |
| Scam lists and bridge labels (owner chose the sources; licences checked, GPL list kept out of the repo) | Claude Code (drafted) | Owner |
| Accounts: wallet/email sign-in, sessions, Supabase case storage, My cases page, home page sign-in (owner's design and screenshots) | Claude Code (drafted) | Owner |
| Ashiato Pro (owner's pricing and payment model: cheap, USDC months, cards later): payments table, on-chain USDC checks, pricing page, account-menu status; API routes require sign-in | Claude Code (drafted) | Owner |
| Pro features (owner's picks from the roadmap): watch alerts with a daily cron, Claude-written trace summary (Anthropic SDK), Base / Arbitrum / Optimism / BNB Chain / Polygon support | Claude Code (drafted) | Owner |

## Prompts and plans

The main planning document is [docs/HACKATHON_PLAN.md](docs/HACKATHON_PLAN.md). Significant
prompts and design decisions made during the event are added to `docs/` as we go.
