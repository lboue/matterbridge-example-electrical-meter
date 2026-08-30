/**
 * @file src/module.ts
 * @description Generic example of the Matter 1.6 "Basic Utility Meter" endpoint topology
 * (§14.9.6.1): a parent electricalUtilityMeter endpoint with two electricalEnergyTariff /
 * electricalMeter / electricalSensor child endpoints (current + upcoming tariff), with simulated
 * power/energy readings.
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

import { MeterIdentification } from '@matter/main/clusters/meter-identification';
import { TariffUnit } from '@matter/types/globals';
import { type BasePlatformConfig, MatterbridgeDynamicPlatform, type MatterbridgeEndpoint, type PlatformMatterbridge, getSemtag } from 'matterbridge';
import { ElectricalUtilityMeter } from 'matterbridge/devices';
import type { AnsiLogger, LogLevel } from 'matterbridge/logger';
import { CommodityTariffChronologyTag, CommodityTariffCommodityTag, CommodityTariffFlowTag, ElectricalMeasurementTag, PowerSourceTag } from 'matterbridge/matter';

import { updateCommodityMetering } from './commodityExtras.js';
import { TARIFF_COMPONENT_ID, attachFlatTariff, buildFlatTariff } from './flatTariff.js';

// This allows to have type checking and autocompletion for the instance config.
export type ElectricalMeterPlatformConfig = BasePlatformConfig & {
  whiteList: string[];
  blackList: string[];
  /** How often the simulated power/energy readings are refreshed, in seconds. Defaults to 10. */
  updateIntervalSeconds?: number;
};

const ENDPOINT_ID = 'electricalMeter1';
const SERIAL_NUMBER = 'EM-0000001';
const DEFAULT_UPDATE_INTERVAL_SECONDS = 10;
const NOMINAL_VOLTAGE_V = 230;
const NOMINAL_FREQUENCY_HZ = 50;
const NOMINAL_POWER_W = 1500;
const CURRENT_PRICE_EUR_PER_KWH = 0.2;
const UPCOMING_PRICE_EUR_PER_KWH = 0.22;
const EUR_CURRENCY = { currency: 978, decimalPoints: 4 }; // ISO 4217 currency code

// Semantic tags shared by the "current" and "upcoming" tariff child endpoints (EP2/EP3): both are
// AC, on the Grid power source, on the Import flow — they only differ by chronology (Current/Upcoming).
const GRID_IMPORT_AC_TAGS = [getSemtag(ElectricalMeasurementTag.Ac), getSemtag(PowerSourceTag.Grid), getSemtag(CommodityTariffFlowTag.Import)];

/**
 * This is the standard interface for Matterbridge plugins.
 * Each plugin should export a default function that follows this signature.
 *
 * @param {PlatformMatterbridge} matterbridge - An instance of MatterBridge.
 * @param {AnsiLogger} log - An instance of AnsiLogger. This is used for logging messages in a format that can be displayed with ANSI color codes and in the frontend.
 * @param {ElectricalMeterPlatformConfig} config - The platform configuration.
 * @returns {ElectricalMeterPlatform} - An instance of the MatterbridgeDynamicPlatform class. This is the main interface for interacting with the Matterbridge system.
 */
export default function initializePlugin(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: ElectricalMeterPlatformConfig): ElectricalMeterPlatform {
  return new ElectricalMeterPlatform(matterbridge, log, config);
}

// Here we define the ElectricalMeterPlatform class, which extends the MatterbridgeDynamicPlatform.
export class ElectricalMeterPlatform extends MatterbridgeDynamicPlatform {
  /** EP2: the "current" child endpoint, holding the power/energy measurement clusters that the periodic timer updates. */
  private measurement?: MatterbridgeEndpoint;
  private updateTimer?: NodeJS.Timeout;
  private cumulativeEnergyWh = 0;
  /** Typed platform config, captured once instead of casting `this.config` (typed `BasePlatformConfig` by the base class) at each use site. */
  private readonly pluginConfig: ElectricalMeterPlatformConfig;

  constructor(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: ElectricalMeterPlatformConfig) {
    // Always call super(matterbridge, log, config)
    super(matterbridge, log, config);
    this.pluginConfig = config;

    // Verify that Matterbridge is the correct version. The ElectricalUtilityMeter single-class device
    // (matterbridge/devices) and its `energyTariff` option on addElectricalMeter() are new in 3.10.8.
    if (typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion('3.10.8')) {
      throw new Error(
        `This plugin requires Matterbridge version >= "3.10.8". Please update Matterbridge from ${this.matterbridge.matterbridgeVersion} to the latest version in the frontend.`,
      );
    }

    this.log.info('Initializing Platform...');
  }

  override async onStart(reason?: string): Promise<void> {
    this.log.info(`onStart called with reason: ${reason ?? 'none'}`);

    // Wait for the platform to fully load the select if you use them.
    await this.ready;

    // Clean the selectDevice and selectEntity maps, if you want to reset the select.
    await this.clearSelect();

    await this.createElectricalMeter();
  }

  override async onConfigure(): Promise<void> {
    // Always call super.onConfigure()
    await super.onConfigure();

    this.log.info('onConfigure called');
    this.startPeriodicUpdates();
  }

  // oxlint-disable-next-line typescript/require-await
  override async onChangeLoggerLevel(logLevel: LogLevel): Promise<void> {
    this.log.info(`onChangeLoggerLevel called with: ${logLevel}`);
  }

  override async onShutdown(reason?: string): Promise<void> {
    // Always call super.onShutdown(reason)
    await super.onShutdown(reason);

    this.log.info(`onShutdown called with reason: ${reason ?? 'none'}`);

    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = undefined;
    }

    if (this.config.unregisterOnShutdown) await this.unregisterAllDevices();
  }

  /**
   * Creates and registers the example electrical meter endpoint tree.
   *
   * Follows the "Basic Utility Meter" topology from the Matter 1.6 spec (§14.9.6.1,
   * `chip/1.6.0/specs`): a parent endpoint plus two child endpoints, built with the `ElectricalUtilityMeter`
   * single-class device (`matterbridge/devices`) and its `addElectricalMeter()`/`addElectricalEnergyTariff()`
   * composition helpers:
   * - EP1 (parent, this method's `meter`): `electricalUtilityMeter` (0x0511) + `meterReferencePoint`
   *   (0x0512) + `powerSource`. Requires `MeterIdentification` and `Identify`, both created by the
   *   `ElectricalUtilityMeter` constructor. Tagged `ElectricalEnergy`.
   * - EP2 (child `electricalMeterCurrent`, this method's `measurement`), via `addElectricalMeter()`:
   *   `electricalMeter` (0x0514) + `electricalEnergyTariff` (0x0513) + `electricalSensor` (0x0510) —
   *   the combination the periodic timer updates. Requires `PowerTopology`, `ElectricalPowerMeasurement`,
   *   `ElectricalEnergyMeasurement`. Tagged AC / Grid / Import / Current. The `energyTariff` option
   *   exposes `CommodityPrice`/`CommodityTariff`/`ElectricalGridConditions` directly on this same
   *   endpoint; `CommodityTariff` is then overridden with the full flat-rate schedule built by
   *   `flatTariff.ts`, which goes beyond what the `energyTariff` option covers (`TariffInfo`/`TariffUnit`
   *   only). `CommodityMetering` is set via the `meteredQuantity*`/`tariffUnit` options.
   * - EP3 (optional child `electricalMeterUpcoming`), via `addElectricalEnergyTariff()`:
   *   `electricalEnergyTariff` alone. Tagged AC / Grid / Import / Upcoming. Carries a different
   *   flat-rate `CommodityTariff` to illustrate the "upcoming" period.
   *
   * @returns {Promise<void>} Resolves once the endpoint tree has been registered.
   */
  private async createElectricalMeter(): Promise<void> {
    this.log.info('Creating the example electrical meter...');

    // EP1: the utility meter's own identity / reference point for the whole tree.
    const meter = new ElectricalUtilityMeter('Electrical Meter', SERIAL_NUMBER, {
      id: ENDPOINT_ID,
      meterType: MeterIdentification.MeterType.Utility,
      pointOfDelivery: SERIAL_NUMBER,
      meterSerialNumber: SERIAL_NUMBER,
      tagList: [getSemtag(CommodityTariffCommodityTag.ElectricalEnergy)],
    });

    // EP2: the grid import tariff endpoint, combining the three device types this example demonstrates
    // and holding the simulated power/energy measurement clusters. `energyTariff` exposes the Electrical
    // Energy Tariff clusters directly on this same meter endpoint.
    const measurement = meter.addElectricalMeter('Electrical Meter Current', {
      id: 'electricalMeterCurrent',
      voltage: voltsToMilli(NOMINAL_VOLTAGE_V),
      current: ampsToMilli(NOMINAL_POWER_W / NOMINAL_VOLTAGE_V),
      power: wattsToMilli(NOMINAL_POWER_W),
      energyImported: wattHoursToMilli(this.cumulativeEnergyWh),
      meteredQuantity: [{ tariffComponentIDs: [TARIFF_COMPONENT_ID], quantity: 0 }],
      meteredQuantityTimestamp: Math.floor(Date.now() / 1000),
      tariffUnit: TariffUnit.KWh,
      tagList: [...GRID_IMPORT_AC_TAGS, getSemtag(CommodityTariffChronologyTag.Current)],
      energyTariff: {
        tariffLabel: 'Standard',
        providerName: 'Matterbridge Example',
        currency: EUR_CURRENCY,
        currentPrice: {
          periodStart: Math.floor(Date.now() / 1000),
          periodEnd: null,
          price: Math.round(CURRENT_PRICE_EUR_PER_KWH * 10 ** EUR_CURRENCY.decimalPoints),
        },
      },
    });
    // addElectricalMeter()'s own ElectricalPowerMeasurement setup doesn't take a frequency option —
    // report the nominal grid frequency too.
    measurement.createDefaultElectricalPowerMeasurementClusterServer(
      voltsToMilli(NOMINAL_VOLTAGE_V),
      ampsToMilli(NOMINAL_POWER_W / NOMINAL_VOLTAGE_V),
      wattsToMilli(NOMINAL_POWER_W),
      hertzToMilli(NOMINAL_FREQUENCY_HZ),
    );

    // CommodityTariff is overridden here with the full day/tariff-component schedule: the `energyTariff`
    // option above only covers TariffInfo/TariffUnit — see flatTariff.ts. A flat rate is used throughout
    // to keep this example minimal.
    attachFlatTariff(measurement, buildFlatTariff({ label: 'Standard', providerName: 'Matterbridge Example', priceEurPerKwh: CURRENT_PRICE_EUR_PER_KWH }), this.log);

    // EP3 (optional): the upcoming tariff endpoint from the spec topology, with a different flat
    // rate to illustrate the "Upcoming" chronology tag.
    const upcoming = meter.addElectricalEnergyTariff('Electrical Meter Upcoming', {
      id: 'electricalMeterUpcoming',
      tagList: [...GRID_IMPORT_AC_TAGS, getSemtag(CommodityTariffChronologyTag.Upcoming)],
    });
    attachFlatTariff(upcoming, buildFlatTariff({ label: 'Standard (upcoming)', providerName: 'Matterbridge Example', priceEurPerKwh: UPCOMING_PRICE_EUR_PER_KWH }), this.log);

    this.setSelectDevice(SERIAL_NUMBER, 'Electrical Meter');
    if (this.validateDevice(['Electrical Meter', SERIAL_NUMBER])) {
      await this.registerDevice(meter);
      this.measurement = measurement;
    }
  }

  /**
   * Starts the timer that periodically refreshes the simulated power and energy readings.
   *
   * @returns {void}
   */
  private startPeriodicUpdates(): void {
    const intervalSeconds = this.pluginConfig.updateIntervalSeconds ?? DEFAULT_UPDATE_INTERVAL_SECONDS;
    this.updateTimer = setInterval(() => {
      this.updateSimulatedReading().catch((error: unknown) => {
        this.log.error(`Failed to update the simulated reading: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, intervalSeconds * 1000);
  }

  /**
   * Simulates a new instantaneous power reading (±20% around the nominal power), accumulates the
   * corresponding energy, and publishes both on the endpoint.
   *
   * @returns {Promise<void>} Resolves once the attributes have been updated.
   */
  private async updateSimulatedReading(): Promise<void> {
    if (!this.measurement) return;

    const intervalSeconds = this.pluginConfig.updateIntervalSeconds ?? DEFAULT_UPDATE_INTERVAL_SECONDS;
    const powerW = NOMINAL_POWER_W * (0.8 + Math.random() * 0.4);
    const currentA = powerW / NOMINAL_VOLTAGE_V;
    this.cumulativeEnergyWh += (powerW * intervalSeconds) / 3600;

    await this.measurement.setAttribute('ElectricalPowerMeasurement', 'activePower', wattsToMilli(powerW), this.log);
    await this.measurement.setAttribute('ElectricalPowerMeasurement', 'activeCurrent', ampsToMilli(currentA), this.log);
    await this.measurement.setAttribute('ElectricalEnergyMeasurement', 'cumulativeEnergyImported', { energy: wattHoursToMilli(this.cumulativeEnergyWh) }, this.log);
    await updateCommodityMetering(this.measurement, this.cumulativeEnergyWh, this.log);
  }
}

/**
 * Converts volts to the millivolt integer expected by ElectricalPowerMeasurement.voltage.
 *
 * @param {number} value Voltage in volts.
 * @returns {number} Voltage in millivolts.
 */
function voltsToMilli(value: number): number {
  return Math.round(value * 1000);
}

/**
 * Converts watts to the milliwatt integer expected by ElectricalPowerMeasurement.activePower.
 *
 * @param {number} value Power in watts.
 * @returns {number} Power in milliwatts.
 */
function wattsToMilli(value: number): number {
  return Math.round(value * 1000);
}

/**
 * Converts amps to the milliamp integer expected by ElectricalPowerMeasurement.activeCurrent.
 *
 * @param {number} value Current in amps.
 * @returns {number} Current in milliamps.
 */
function ampsToMilli(value: number): number {
  return Math.round(value * 1000);
}

/**
 * Converts hertz to the millihertz integer expected by ElectricalPowerMeasurement.frequency.
 *
 * @param {number} value Frequency in hertz.
 * @returns {number} Frequency in millihertz.
 */
function hertzToMilli(value: number): number {
  return Math.round(value * 1000);
}

/**
 * Converts watt-hours to the milliwatt-hour integer expected by
 * ElectricalEnergyMeasurement.cumulativeEnergyImported.energy.
 *
 * @param {number} value Energy in watt-hours.
 * @returns {number} Energy in milliwatt-hours.
 */
function wattHoursToMilli(value: number): number {
  return Math.round(value * 1000);
}
