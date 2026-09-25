# Community labels on-chain (EAS)

Investigators label addresses and vote on each other's labels as
[EAS](https://attest.org) attestations on **Sepolia**. Anyone can read them; nobody owns them.

| Schema | Fields | Purpose |
|---|---|---|
| Label | `string chain, string subject, string category, string name, string evidence, uint8 confidence` | "this address is X" |
| Vote | `int8 trust, string reason` (refUID = the label) | −2 wrong · −1 doubtful · +1 plausible · +2 confirmed |
| Report | `bytes32 reportHash, string chain, string subject, string summary` | a trace report existed, unaltered, at this time |

Schema UIDs are deterministic (`lib/attest/config.ts`). Register them once:

```bash
PRIVATE_KEY=0x…test-wallet… node scripts/register-schemas.mjs
```

## Trust score

- One live label per wallet per address and category, and one live vote per wallet per label: the latest wins.
- You can't vote on your own label; the creator counts as a +2 vote.
- Voter weight: 1, or 2 with a verified ENS name.
- Trust = weighted support ÷ (support + disputes). 70%+ trusted, 40–69% contested, below 40% disputed.

## Code

| File | What |
|---|---|
| `lib/attest/config.ts` | Network, EAS addresses, schemas, categories |
| `lib/attest/encode.ts` | Encode/decode attestation data, validate a label |
| `lib/attest/trust.ts` | Build labels + trust scores from raw attestations (pure, tested) |
| `lib/attest/read.ts` | Read from the EAS indexer (GraphQL); `EAS_GRAPHQL_URL` overrides |
| `lib/attest/write.ts` | Attest / vote / revoke from the browser with a viem wallet client |
| `app/api/community/[chain]/[address]` | Public JSON API (CORS open) |
| `components/CommunityLabels.tsx` | Inspector panel: list, trust meter, votes, flag form |

## Wiring the wallet

`AddressInspector` takes an optional `attester` prop. Without it the panel is read-only.
With wagmi (Reown AppKit), build it in the trace page:

```tsx
import { usePublicClient, useWalletClient } from 'wagmi'
import { attestLabel, voteOnLabel, revokeAttestation } from '@/lib/attest/write'
import { SCHEMA_UID, ATTEST_CHAIN } from '@/lib/attest/config'

const { data: wallet } = useWalletClient()
const pub = usePublicClient({ chainId: ATTEST_CHAIN.id })
const attester = wallet && pub ? {
  address: wallet.account.address.toLowerCase(),
  label: (l) => attestLabel(wallet, pub, l),
  vote: (uid, v) => voteOnLabel(wallet, pub, uid, v),
  revoke: (uid) => revokeAttestation(wallet, pub, SCHEMA_UID.label, uid),
} : undefined

<AddressInspector … attester={attester} />
```

Include `sepolia` in the AppKit networks. The write helpers refuse to send on another network
(`WrongNetworkError`), so prompt a switch with `useSwitchChain` when you see it.
