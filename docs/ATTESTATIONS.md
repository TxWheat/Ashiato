# Community labels (wallet-signed, free)

Investigators label addresses and vote on each other's labels. Each label, vote and
withdrawal is an **EIP-712 message signed by the investigator's wallet**: a signature, not a
transaction, so it costs nothing and works on any network. The server checks the signature
and stores the signed message in Supabase. Anyone can fetch the original and re-check who
signed it.

| Message | Fields |
|---|---|
| Label | `address attester, string chain, string subject, string category, string name, string evidence, uint8 confidence, uint64 time` |
| Vote | `address attester, bytes32 label, int8 trust, string reason, uint64 time` (−2 wrong · −1 doubtful · +1 plausible · +2 confirmed) |
| Revoke | `address attester, bytes32 uid, uint64 time` |

Domain: `{ name: 'Ashiato Community Labels', version: '1' }` (no chainId). A label's or vote's
uid is the EIP-712 hash of the signed message.

## Rules the server enforces

- Signed in (SIWE session) with the same wallet that signed.
- Signing time within 10 minutes of now (no backdating to win "latest counts").
- Evidence required for scam / phishing / hack; valid address for the chain.
- No votes on your own label; only the signer can withdraw.
- 200 labels and votes per wallet per day.
- Ordinary wallets are verified offline; smart-contract wallets (email sign-ins) via EIP-1271/6492 on mainnet.

## Trust score

- One live label per wallet per address and category, and one live vote per wallet per label: the latest wins.
- The creator counts as a +2 vote. Voter weight: 1, or 2 with a verified ENS name.
- Trust = weighted support ÷ (support + disputes). 70%+ trusted, 40–69% contested, below 40% disputed.

## API

- `GET /api/community/{chain}/{address}`: labels with votes and trust (public, CORS open)
- `GET /api/community?uid=0x…`: the signed record (`typedData`, `signature`, `signer`, and the signed withdrawal if revoked). Check it with viem `verifyTypedData({ address: signer, signature, ...typedData })`.
- `POST /api/community`: `{ kind: 'label' | 'vote' | 'revoke', message, signature }`

## Setup

Create the `community_attestations` table once in Supabase → SQL Editor. It uses the same
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` as saved cases.

## Code

| File | What |
|---|---|
| `lib/attest/signed.ts` | EIP-712 types, uid, request validation, signature check (shared, tested) |
| `lib/attest/sign.ts` | Browser: sign with the connected wallet and send |
| `lib/attest/store.ts` | Supabase reads and writes |
| `lib/attest/trust.ts` | Labels + trust scores from stored labels and votes (pure, tested) |
| `lib/attest/encode.ts` | Label validation; ABI encoding (EAS-compatible, for on-chain anchoring later) |
| `app/api/community/` | The routes above |
| `components/CommunityLabels.tsx` | Inspector panel: list, trust meter, votes, label form |

A later option: anchor a daily Merkle root of all signed labels on-chain, one cheap transaction for everyone.
