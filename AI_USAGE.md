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
| EAS community labels: schemas, encode/decode, trust scoring, indexer reads, API route, Inspector panel, schema registration script, tests | Claude Code (drafted) | Owner |
| Fixes from the owner's live testing (poisoning, clustering, graph lines, node removal); Tronscan labels | Claude Code (drafted), bugs found and verified by owner | Owner |
| Bridgers cross-chain hops (owner researched the Bridgers API and chose it); email-wallet network fix; app icon | Claude Code (drafted) | Owner |
| Accounts: wallet/email sign-in, sessions, Supabase case storage, My cases page, home page sign-in (owner's design and screenshots) | Claude Code (drafted) | Owner |

## Prompts and plans

The main planning document is [docs/HACKATHON_PLAN.md](docs/HACKATHON_PLAN.md). Significant
prompts and design decisions made during the event are added to `docs/` as we go.
