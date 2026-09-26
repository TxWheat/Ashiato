'use client'

import { createContext, useContext } from 'react'
import { Pricing } from '@/lib/prices'

/** Prices for valuing amounts (today's, daily history, and which to use), provided by the trace page */
export const PricingContext = createContext<Pricing>({ today: {}, history: null, atTransfer: false })
export const usePricing = () => useContext(PricingContext)
