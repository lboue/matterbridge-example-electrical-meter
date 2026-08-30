/**
 * @file src/flatTariff.ts
 * @description Minimal CommodityTariff (0x0700) attachment for the electricalEnergyTariff device
 * type: a single flat-rate tariff component covering the whole day, every day — just enough to
 * show the cluster's shape on EP2/EP3 without the day/night scheduling logic. A real deployment
 * with a day/night contract (e.g. Heures Creuses / Heures Pleines) would build several DayEntry /
 * TariffComponent entries instead of the single flat-rate one built here.
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

import { CommodityTariff } from '@matter/main/clusters/commodity-tariff';
import { TariffPriceType, TariffUnit } from '@matter/types/globals';
import type { MatterbridgeEndpoint } from 'matterbridge';
import { MatterbridgeCommodityTariffServer } from 'matterbridge/devices';
import type { AnsiLogger } from 'matterbridge/logger';

const ALL_DAYS_OF_WEEK: CommodityTariff.DayPatternDayOfWeek = {
  sunday: true,
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: true,
};

const DAY_ENTRY_ID = 1;
const DAY_PATTERN_ID = 1;
const DECIMAL_POINTS = 4;
const EUR = 978; // ISO 4217 currency code

/** The single `TariffComponent` id this flat-rate example publishes — shared with `commodityExtras.ts` so `CommodityMetering.meteredQuantity` can reference the same component. */
export const TARIFF_COMPONENT_ID = 1;

/**
 * Input for {@link buildFlatTariff}: the label, provider and flat price of a single-rate tariff.
 */
export interface FlatTariffConfig {
  /** Displayed tariff label, e.g. "Standard". */
  label: string;
  /** Provider name, e.g. "Matterbridge Example". */
  providerName: string;
  /** Flat price, in EUR/kWh. */
  priceEurPerKwh: number;
  /** Tariff start date, epoch seconds. Defaults to now. */
  startDate?: number;
}

/**
 * Builds the attributes for a single flat-rate CommodityTariff: one `DayEntry` covering the whole
 * day, one `DayPattern` (every day), one `CalendarPeriod`, and one `TariffComponent`/`TariffPeriod`.
 * Since the tariff never changes, "current" and "next" always resolve to the same entry/component.
 *
 * @param {FlatTariffConfig} config Label, provider, flat price and optional start date.
 * @returns {CommodityTariff.Attributes} The full attribute set to pass to {@link attachFlatTariff}.
 */
export function buildFlatTariff(config: FlatTariffConfig): CommodityTariff.Attributes {
  const currency = { currency: EUR, decimalPoints: DECIMAL_POINTS };
  const startDate = config.startDate ?? Math.floor(Date.now() / 1000);

  const dayEntries: CommodityTariff.DayEntry[] = [{ dayEntryId: DAY_ENTRY_ID, startTime: 0 }];
  const dayPatterns: CommodityTariff.DayPattern[] = [{ dayPatternId: DAY_PATTERN_ID, daysOfWeek: ALL_DAYS_OF_WEEK, dayEntryIDs: [DAY_ENTRY_ID] }];
  const calendarPeriods: CommodityTariff.CalendarPeriod[] = [{ startDate, dayPatternIDs: [DAY_PATTERN_ID] }];
  const tariffComponents: CommodityTariff.TariffComponent[] = [
    {
      tariffComponentId: TARIFF_COMPONENT_ID,
      price: { priceType: TariffPriceType.Standard, price: Math.round(config.priceEurPerKwh * 10 ** currency.decimalPoints) },
      threshold: null, // mandatory field, not used for a flat rate (no block/tiered pricing)
      label: config.label,
    },
  ];
  const tariffPeriods: CommodityTariff.TariffPeriod[] = [{ label: config.label, dayEntryIDs: [DAY_ENTRY_ID], tariffComponentIDs: [TARIFF_COMPONENT_ID] }];

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const todayMidnightEpoch = Math.floor(todayMidnight.getTime() / 1000);
  const [dayEntry] = dayEntries;

  return {
    tariffInfo: { tariffLabel: config.label, providerName: config.providerName, currency, blockMode: CommodityTariff.BlockMode.NoBlock },
    tariffUnit: TariffUnit.KWh,
    startDate,
    dayEntries,
    dayPatterns,
    calendarPeriods,
    individualDays: [], // no holiday/exception overrides for this flat-rate example
    tariffComponents,
    tariffPeriods,
    // Randomization feature not enabled here — no randomized start-time offset.
    defaultRandomizationOffset: null,
    defaultRandomizationType: null,
    currentDay: { date: todayMidnightEpoch, dayType: CommodityTariff.DayType.Standard, dayEntryIDs: [DAY_ENTRY_ID] },
    nextDay: { date: todayMidnightEpoch + 24 * 60 * 60, dayType: CommodityTariff.DayType.Standard, dayEntryIDs: [DAY_ENTRY_ID] },
    currentDayEntry: dayEntry,
    currentDayEntryDate: todayMidnightEpoch,
    nextDayEntry: dayEntry,
    nextDayEntryDate: todayMidnightEpoch + 24 * 60 * 60,
    currentTariffComponents: tariffComponents,
    nextTariffComponents: tariffComponents,
  };
}

/**
 * Attaches a flat-rate `CommodityTariff` server to the given endpoint.
 *
 * Uses `matterbridge`'s own `MatterbridgeCommodityTariffServer` (which already bakes in the `Pricing`
 * feature and implements the mandatory `GetTariffComponent`/`GetDayEntry` commands as plain lookups by
 * id — matter.js's default implementation throws "unimplemented" for both), rather than a plugin-local
 * subclass: resolving this behavior class through `matterbridge/devices` (exported alongside
 * `ElectricalUtilityMeter`) instead of a direct `@matter/main/behaviors/commodity-tariff` import
 * guarantees it is the exact same class `MatterbridgeEndpoint` itself expects for `behaviors.require()`,
 * even when `matterbridge` is consumed via `npm link`.
 *
 * This must be the *only* `behaviors.require()` call for `CommodityTariff` on `endpoint`, made before the
 * endpoint is installed (i.e. before `registerDevice()`): matter.js's `Behaviors.require()` only applies
 * the options it's given the first time a behavior is added — a second call for an already-present
 * implementation is a silent no-op. Overriding the schedule afterward via `setAttribute()` doesn't work
 * either: writing `dayEntries` hits a matter.js model bug where `DayEntryStruct.randomizationType` is
 * `[RNDM]`-gated (this cluster only enables `Pricing`) yet declares `default: 0`, so the attribute server
 * auto-fills it and then rejects that same fill for failing conformance — see
 * {@link https://github.com/matter-js/matter.js/issues/4374} (upstream matter.js bug, with a proposed fix
 * that removes the conflicting default) and
 * {@link https://github.com/Luligu/matterbridge/issues/625} (why `ElectricalUtilityMeter.addElectricalMeter()`'s
 * `energyTariff` option can't be combined with the full day-schedule set up here).
 *
 * Once matter.js#4374 ships in the matterbridge dependency this plugin builds against, the `dayEntries`
 * write stops crashing — but `behaviors.require()`'s silent no-op on an already-present behavior is
 * separate, intentional matter.js behavior, not something that fix touches. So the manual
 * `addChildDeviceType()` + single `behaviors.require()` construction here would still be needed for EP2;
 * the fix would only reopen the option of using `addElectricalMeter()`'s `energyTariff` for EP2 and then
 * overriding the full schedule via `setAttribute()` *after* `registerDevice()` (never via a second
 * `behaviors.require()` call, which stays a no-op regardless).
 *
 * @param {MatterbridgeEndpoint} endpoint The `electricalEnergyTariff` endpoint to attach the cluster to, not yet registered.
 * @param {CommodityTariff.Attributes} attrs The attributes built by {@link buildFlatTariff}.
 * @param {AnsiLogger} [log] Optional logger for the debug trace.
 * @returns {void}
 */
export function attachFlatTariff(endpoint: MatterbridgeEndpoint, attrs: CommodityTariff.Attributes, log?: AnsiLogger): void {
  endpoint.behaviors.require(MatterbridgeCommodityTariffServer, attrs);
  log?.debug(`CommodityTariff attached on ${endpoint.id}: ${attrs.tariffInfo?.tariffLabel}`);
}
