import { EntityLabel } from './types'
import labelsData from '../data/labels.json'

const labels = labelsData as Record<string, EntityLabel>

export function getLabel(address: string): EntityLabel | undefined {
  return labels[address.toLowerCase()]
}
