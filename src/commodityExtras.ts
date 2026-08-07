/**
 * @file src/commodityExtras.ts
 * @description Minimal CommodityPrice (0x0095, optional on electricalEnergyTariff) and
 * CommodityMetering (0x0B07, optional on electricalMeter) attachments for EP2, matching the
 * "Electrical Meter Topology" figure in the Matter 1.6 spec (§14.9.6). Kept deliberately simple —
 * CommodityPrice mirrors the flat-rate CommodityTariff price from flatTariff.ts, and
 * CommodityMetering reports the same cumulative energy already tracked for
 * ElectricalEnergyMeasurement, just expressed in whole kWh instead of milliwatt-hours.
 * @author https://github.com/lboue
 * @created 2026-08-07
 * @version 1.0.0
 * @license Apache-2.0
 *
 * Copyright 2026 Ludovic Boué.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { CommodityMeteringServer } from '@matter/main/behaviors/commodity-metering';
import { CommodityPriceServer } from '@matter/main/behaviors/commodity-price';
import type { CommodityPrice } from '@matter/main/clusters/commodity-price';
import { TariffUnit } from '@matter/types/globals';
import type { MatterbridgeEndpoint } from 'matterbridge';
import type { AnsiLogger } from 'matterbridge/logger';

import { TARIFF_COMPONENT_ID } from './flatTariff.js';

const DECIMAL_POINTS = 4;
const EUR = 978; // ISO 4217 currency code
const WH_PER_KWH = 1000;

/**
 * `CommodityPriceServer` with the mandatory `GetDetailedPrice` command implemented: it always
 * returns the current price as-is, ignoring the requested `details` bitmap (this flat-rate example
 * never populates the optional Description/Components fields differently per request).
 */
class FlatCommodityPriceServer extends CommodityPriceServer {
  override getDetailedPriceRequest(): CommodityPrice.GetDetailedPriceResponse {
    return { currentPrice: this.state.currentPrice };
  }
}

/**
 * Attaches a `CommodityPrice` server mirroring a flat rate to the given endpoint.
 *
 * @param {MatterbridgeEndpoint} endpoint The endpoint to attach the cluster to (EP2 in this example).
 * @param {number} priceEurPerKwh Flat price, in EUR/kWh — the same rate published by the endpoint's `CommodityTariff`.
 * @param {AnsiLogger} [log] Optional logger for the debug trace.
 * @returns {void}
 */
export function attachFlatCommodityPrice(endpoint: MatterbridgeEndpoint, priceEurPerKwh: number, log?: AnsiLogger): void {
  const currency = { currency: EUR, decimalPoints: DECIMAL_POINTS };
  endpoint.behaviors.require(FlatCommodityPriceServer, {
    tariffUnit: TariffUnit.KWh,
    currency,
    currentPrice: { periodStart: Math.floor(Date.now() / 1000), periodEnd: null, price: Math.round(priceEurPerKwh * 10 ** currency.decimalPoints) },
  });
  log?.debug(`CommodityPrice attached on ${endpoint.id}: ${priceEurPerKwh} EUR/kWh`);
}

/**
 * Attaches a `CommodityMetering` server to the given endpoint, reporting `energyWh` (converted to
 * whole kWh) against the flat-rate tariff component from `flatTariff.ts`.
 *
 * @param {MatterbridgeEndpoint} endpoint The endpoint to attach the cluster to (EP2 in this example).
 * @param {number} energyWh Cumulative energy, in watt-hours.
 * @param {AnsiLogger} [log] Optional logger for the debug trace.
 * @returns {void}
 */
export function attachCommodityMetering(endpoint: MatterbridgeEndpoint, energyWh: number, log?: AnsiLogger): void {
  endpoint.behaviors.require(CommodityMeteringServer, {
    meteredQuantity: [{ tariffComponentIDs: [TARIFF_COMPONENT_ID], quantity: energyWh / WH_PER_KWH }],
    meteredQuantityTimestamp: Math.floor(Date.now() / 1000),
    tariffUnit: TariffUnit.KWh,
    maximumMeteredQuantities: 1,
  });
  log?.debug(`CommodityMetering attached on ${endpoint.id}: ${(energyWh / WH_PER_KWH).toFixed(3)} kWh`);
}

/**
 * Refreshes `CommodityMetering.meteredQuantity`/`meteredQuantityTimestamp` on an already-attached
 * endpoint — called on the same periodic timer that updates `ElectricalEnergyMeasurement`.
 *
 * @param {MatterbridgeEndpoint} endpoint The endpoint `attachCommodityMetering()` was called on.
 * @param {number} energyWh Cumulative energy, in watt-hours.
 * @param {AnsiLogger} [log] Optional logger for the attribute-change trace.
 * @returns {Promise<void>} Resolves once the attributes have been updated.
 */
export async function updateCommodityMetering(endpoint: MatterbridgeEndpoint, energyWh: number, log?: AnsiLogger): Promise<void> {
  await endpoint.setAttribute('CommodityMetering', 'meteredQuantity', [{ tariffComponentIDs: [TARIFF_COMPONENT_ID], quantity: energyWh / WH_PER_KWH }], log);
  await endpoint.setAttribute('CommodityMetering', 'meteredQuantityTimestamp', Math.floor(Date.now() / 1000), log);
}
