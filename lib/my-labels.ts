'use client'

import { useCallback, useEffect, useState } from 'react'
import { isEvm } from './evm'
import { Chain, EntityLabel, EntityType } from './types'

/**
 * Labels the investigator sets themselves. They override every other source and
 * apply wherever the address appears, in any case. Stored in this browser only.
 */
const KEY = 'cryptotracer.myLabels.v1'
const EVENT = 'cryptotracer:my-labels'

export interface MyLabel {
  name: string
  type: EntityType
  note?: string
  updated: number
}

export const myLabelKey = (chain: Chain, address: string) => `${chain}:${isEvm(chain) ? address.toLowerCase() : address}`

function read(): Record<string, MyLabel> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export function toEntityLabel(l: MyLabel): EntityLabel {
  return { name: l.name, type: l.type, source: 'Your label (saved in this browser)' }
}

export function useMyLabels() {
  const [labels, setLabels] = useState<Record<string, MyLabel>>({})

  useEffect(() => {
    const sync = () => setLabels(read())
    sync()
    // Keep other tabs and components in step
    window.addEventListener('storage', sync)
    window.addEventListener(EVENT, sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(EVENT, sync)
    }
  }, [])

  const setLabel = useCallback((chain: Chain, address: string, label: Omit<MyLabel, 'updated'> | null) => {
    const next = { ...read() }
    const k = myLabelKey(chain, address)
    if (label && label.name.trim()) next[k] = { ...label, name: label.name.trim().slice(0, 80), updated: Date.now() }
    else delete next[k]
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // Storage blocked (private mode): keep it for this page view only
    }
    setLabels(next)
    window.dispatchEvent(new Event(EVENT))
  }, [])

  return { labels, setLabel }
}
