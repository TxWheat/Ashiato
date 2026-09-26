import 'server-only'
import { Chain } from '../types'
import { traceBtcAddress } from '../chains/btc'
import { traceEthAddress } from '../chains/eth'
import { traceTronAddress } from '../chains/tron'
import { getLabel } from '../labels'
import { alertEvents } from './detect'
import { addAlerts, markChecked, WatchRow } from './store'

// Looks for new transfers at watched addresses. Reads each address's newest page of
// transactions (the same call as opening it), so a check costs one lookup per address.

export async function latestTransactions(chain: Chain, address: string) {
  const page = chain === 'btc' ? await traceBtcAddress(address) : chain === 'tron' ? await traceTronAddress(address) : await traceEthAddress(address)
  return page.rawTxs
}

/** Newest transaction time at an address: a new watch only alerts on what comes after */
export async function newestTime(chain: Chain, address: string): Promise<number> {
  const txs = await latestTransactions(chain, address)
  return txs.reduce((m, t) => Math.max(m, t.timestamp), 0)
}

/** Checks watches one by one until the time budget runs out; returns how many were checked */
export async function checkWatches(watches: WatchRow[], budgetMs: number): Promise<number> {
  const until = Date.now() + budgetMs
  let done = 0
  for (const w of watches) {
    if (Date.now() > until) break
    const chain = w.chain as Chain
    try {
      const txs = await latestTransactions(chain, w.address)
      const events = alertEvents(w.address, chain, txs, w.last_seen, a => getLabel(a, chain))
      await addAlerts(w, events)
      await markChecked(w.id, Math.max(w.last_seen, ...txs.map(t => t.timestamp)))
    } catch {
      // An upstream hiccup: try this address again next time
    }
    done++
  }
  return done
}
