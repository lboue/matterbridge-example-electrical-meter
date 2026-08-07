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

import { MeterIdentificationServer } from '@matter/main/behaviors/meter-identification';
import { MeterIdentification } from '@matter/main/clusters/meter-identification';
import {
  type BasePlatformConfig,
  MatterbridgeDynamicPlatform,
  MatterbridgeEndpoint,
  type PlatformMatterbridge,
  electricalEnergyTariff,
  electricalMeter,
  electricalSensor,
  electricalUtilityMeter,
  getSemtag,
  meterReferencePoint,
} from 'matterbridge';
import type { AnsiLogger, LogLevel } from 'matterbridge/logger';
import { CommodityTariffChronologyTag, CommodityTariffCommodityTag, CommodityTariffFlowTag, ElectricalMeasurementTag, PowerSourceTag } from 'matterbridge/matter';

import { attachCommodityMetering, attachFlatCommodityPrice, updateCommodityMetering } from './commodityExtras.js';
import { attachFlatTariff, buildFlatTariff } from './flatTariff.js';

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

  constructor(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: ElectricalMeterPlatformConfig) {
    // Always call super(matterbridge, log, config)
    super(matterbridge, log, config);

    // Verify that Matterbridge is the correct version
    if (typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion('3.10.0')) {
      throw new Error(
        `This plugin requires Matterbridge version >= "3.10.0". Please update Matterbridge from ${this.matterbridge.matterbridgeVersion} to the latest version in the frontend.`,
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
   * `chip/1.6.0/specs`): a parent endpoint plus two child endpoints, built with
   * `addChildDeviceType()`:
   * - EP1 (parent, this method's `meter`): `electricalUtilityMeter` (0x0511) + `meterReferencePoint`
   *   (0x0512). Requires `MeterIdentification` (no `createDefault...ClusterServer` helper on
   *   `MatterbridgeEndpoint`, so it is registered directly via `behaviors.require()`) and `Identify`.
   *   Tagged `ElectricalEnergy`.
   * - EP2 (child `electricalMeterCurrent`, this method's `measurement`): `electricalMeter` (0x0514) +
   *   `electricalEnergyTariff` (0x0513) + `electricalSensor` (0x0510) — the combination the periodic
   *   timer updates. Requires `PowerTopology`, `ElectricalPowerMeasurement`, `ElectricalEnergyMeasurement`.
   *   Tagged AC / Grid / Import / Current. Carries a flat-rate `CommodityTariff` (see `flatTariff.ts`),
   *   `CommodityPrice` and `CommodityMetering` (see `commodityExtras.ts`), matching the clusters shown
   *   on this endpoint in the spec's topology figure.
   * - EP3 (optional child `electricalMeterUpcoming`): `electricalEnergyTariff` alone — no required
   *   cluster. Tagged AC / Grid / Import / Upcoming. Carries a different flat-rate `CommodityTariff`
   *   to illustrate the "upcoming" period — for a full day/night HC/HP contract instead of a flat
   *   rate, see matterbridge-ecodevices (`tariffCluster.ts` / `tariffFactory.ts`).
   *
   * @returns {Promise<void>} Resolves once the endpoint tree has been registered.
   */
  private async createElectricalMeter(): Promise<void> {
    this.log.info('Creating the example electrical meter...');

    // EP1: the utility meter's own identity / reference point for the whole tree.
    const meter = new MatterbridgeEndpoint([electricalUtilityMeter, meterReferencePoint], {
      id: ENDPOINT_ID,
      tagList: [getSemtag(CommodityTariffCommodityTag.ElectricalEnergy)],
    })
      .createDefaultIdentifyClusterServer()
      .createDefaultBridgedDeviceBasicInformationClusterServer(
        'Electrical Meter',
        SERIAL_NUMBER,
        this.matterbridge.aggregatorVendorId,
        'Matterbridge',
        'Matterbridge Electrical Meter',
        10000,
        '1.0.0',
      )
      .addRequiredClusters();

    meter.behaviors.require(MeterIdentificationServer, {
      meterType: MeterIdentification.MeterType.Utility,
      pointOfDelivery: SERIAL_NUMBER,
      meterSerialNumber: SERIAL_NUMBER,
      protocolVersion: null,
    });

    // EP2: the grid import tariff endpoint, combining the three device types this example
    // demonstrates and holding the simulated power/energy measurement clusters.
    const measurement = meter
      .addChildDeviceType('electricalMeterCurrent', [electricalMeter, electricalEnergyTariff, electricalSensor], {
        tagList: [...GRID_IMPORT_AC_TAGS, getSemtag(CommodityTariffChronologyTag.Current)],
      })
      .createDefaultPowerTopologyClusterServer()
      .createDefaultElectricalPowerMeasurementClusterServer(
        voltsToMilli(NOMINAL_VOLTAGE_V),
        ampsToMilli(NOMINAL_POWER_W / NOMINAL_VOLTAGE_V),
        wattsToMilli(NOMINAL_POWER_W),
        hertzToMilli(NOMINAL_FREQUENCY_HZ),
      )
      .createDefaultElectricalEnergyMeasurementClusterServer(wattHoursToMilli(this.cumulativeEnergyWh), null)
      .addRequiredClusters();

    // CommodityTariff, CommodityPrice (electricalEnergyTariff) and CommodityMetering (electricalMeter)
    // are all optional and have no createDefault...ClusterServer helper, so they're registered
    // directly via behaviors.require() (see flatTariff.ts / commodityExtras.ts). A flat rate is used
    // here to keep this example minimal — see matterbridge-ecodevices for a full HC/HP contract.
    attachFlatTariff(measurement, buildFlatTariff({ label: 'Standard', providerName: 'Matterbridge Example', priceEurPerKwh: CURRENT_PRICE_EUR_PER_KWH }), this.log);
    attachFlatCommodityPrice(measurement, CURRENT_PRICE_EUR_PER_KWH, this.log);
    attachCommodityMetering(measurement, this.cumulativeEnergyWh, this.log);

    // EP3 (optional): the upcoming tariff endpoint from the spec topology, with a different flat
    // rate to illustrate the "Upcoming" chronology tag.
    const upcoming = meter
      .addChildDeviceType('electricalMeterUpcoming', [electricalEnergyTariff], {
        tagList: [...GRID_IMPORT_AC_TAGS, getSemtag(CommodityTariffChronologyTag.Upcoming)],
      })
      .addRequiredClusters();
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
    const intervalSeconds = (this.config as ElectricalMeterPlatformConfig).updateIntervalSeconds ?? DEFAULT_UPDATE_INTERVAL_SECONDS;
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

    const intervalSeconds = (this.config as ElectricalMeterPlatformConfig).updateIntervalSeconds ?? DEFAULT_UPDATE_INTERVAL_SECONDS;
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
