/**
 * @file src/commodityExtras.ts
 * @description Periodic refresh helper for CommodityMetering (0x0B07, optional on electricalMeter)
 * on EP2, matching the "Electrical Meter Topology" figure in the Matter 1.6 spec (§14.9.6).
 * CommodityMetering reports the same cumulative energy already tracked for
 * ElectricalEnergyMeasurement, just expressed in whole kWh instead of milliwatt-hours.
 *
 * Creating the CommodityMetering (and CommodityPrice) cluster servers themselves doesn't need a
 * helper here anymore — `ElectricalUtilityMeter.addElectricalMeter()`'s `meteredQuantity`/`tariffUnit`
 * and `energyTariff` options (`matterbridge/devices`) cover that directly (see module.ts).
 * @author https://github.com/lboue
 * @created 2026-08-07
 * @version 2.0.0
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

import type { MatterbridgeEndpoint } from 'matterbridge';
import type { AnsiLogger } from 'matterbridge/logger';

import { TARIFF_COMPONENT_ID } from './flatTariff.js';

const WH_PER_KWH = 1000;

/**
 * Refreshes `CommodityMetering.meteredQuantity`/`meteredQuantityTimestamp` on an endpoint created
 * with `createDefaultCommodityMeteringClusterServer()` — called on the same periodic timer that
 * updates `ElectricalEnergyMeasurement`.
 *
 * @param {MatterbridgeEndpoint} endpoint The endpoint `createDefaultCommodityMeteringClusterServer()` was called on.
 * @param {number} energyWh Cumulative energy, in watt-hours.
 * @param {AnsiLogger} [log] Optional logger for the attribute-change trace.
 * @returns {Promise<void>} Resolves once the attributes have been updated.
 */
export async function updateCommodityMetering(endpoint: MatterbridgeEndpoint, energyWh: number, log?: AnsiLogger): Promise<void> {
  await endpoint.setAttribute('CommodityMetering', 'meteredQuantity', [{ tariffComponentIDs: [TARIFF_COMPONENT_ID], quantity: energyWh / WH_PER_KWH }], log);
  await endpoint.setAttribute('CommodityMetering', 'meteredQuantityTimestamp', Math.floor(Date.now() / 1000), log);
}
