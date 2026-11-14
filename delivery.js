'use strict';

/**
 * Fulfilment adapters: the ONLY place that actually gives a player anything.
 *
 * Two kinds of items use different supply channels:
 *   - 'uc'       in-game currency (top-up supplier / official top-up channel)
 *   - 'cosmetic' suits, car skins (must come from a channel the publisher authorizes)
 *
 * Replace the 'live' branches with real integrations. The contract:
 *   resolve { ok: true, ref }  once the item is credited to pubgId
 *   throw an Error             if it failed; that line item is refunded
 *
 * DELIVERY_MODE values:
 *   simulate       everything "succeeds". Development only. NOTHING is delivered.
 *   fail           everything fails. Test suite only.
 *   fail-cosmetic  UC succeeds, cosmetics fail. Test suite only (partial refunds).
 *   (unset)        production default: nothing is configured, so every line is refunded.
 */
const DELAY_MS = 400;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function currentMode() {
  return process.env.DELIVERY_MODE || (process.env.NODE_ENV === 'production' ? 'none' : 'simulate');
}

async function fulfil({ fulfilment, orderItemId, pubgId }) {
  const mode = currentMode();
  const ok = { ok: true, ref: `SIM-${fulfilment}-${orderItemId}-${pubgId.slice(-4)}` };

  if (mode === 'simulate') {
    await delay(DELAY_MS);
    return ok;
  }
  if (mode === 'fail-cosmetic' && fulfilment === 'uc') {
    await delay(DELAY_MS);
    return ok;
  }
  if (mode === 'fail' || mode === 'fail-cosmetic') {
    throw new Error(`simulated ${fulfilment} delivery failure`);
  }

  // TODO(live): call your authorized supplier here. Choose the branch by `fulfilment`.
  throw new Error(`Delivery is not configured for "${fulfilment}" (DELIVERY_MODE=${mode})`);
}

module.exports = { fulfil, currentMode };
