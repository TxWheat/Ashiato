import { RawTransaction, TxIO } from '@/lib/types'

let n = 0
export function btcTx(
  inputs: [string, number, string?][],
  outputs: [string, number, string?][],
  timestamp = 1_700_000_000,
  txid?: string
): RawTransaction {
  const id = txid ?? `tx${++n}`.padEnd(64, '0')
  return {
    txid: id,
    timestamp,
    chain: 'btc',
    asset: 'BTC',
    inputs: inputs.map(([address, amount, prev], k): TxIO => ({
      address, amount, prev: prev ?? `prev${id}${k}:0`, scriptType: address.startsWith('bc1q') ? 'v0_p2wpkh' : address.startsWith('3') ? 'p2sh' : 'p2pkh',
    })),
    outputs: outputs.map(([address, amount], index): TxIO => ({
      address, amount, index, scriptType: address.startsWith('bc1q') ? 'v0_p2wpkh' : address.startsWith('3') ? 'p2sh' : 'p2pkh',
    })),
  }
}

export function ethTx(from: string, to: string, amount: number, timestamp: number, asset = 'ETH', kind: RawTransaction['kind'] = 'normal', gasPriceGwei?: number): RawTransaction {
  return {
    txid: `0x${(++n).toString(16).padStart(64, '0')}`,
    timestamp, chain: 'eth', asset, kind, gasPriceGwei,
    inputs: [{ address: from, amount: 0 }],
    outputs: [{ address: to, amount }],
  }
}
