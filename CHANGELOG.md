# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-08-07

### Added

- Initial version, based on [matterbridge-plugin-template](https://github.com/Luligu/matterbridge-plugin-template).
- Matter 1.6 spec §14.9.6.1 "Basic Utility Meter" endpoint topology: a parent `electricalUtilityMeter` +
  `meterReferencePoint` endpoint (EP1) with two `addChildDeviceType()` children — EP2 combining
  `electricalMeter` + `electricalEnergyTariff` + `electricalSensor` (tags AC/Grid/Import/Current) and
  the optional EP3 `electricalEnergyTariff` upcoming-tariff endpoint (tags AC/Grid/Import/Upcoming).
- Simulated power/energy readings on EP2, refreshed on a configurable timer (`updateIntervalSeconds`).
- Minimal flat-rate `CommodityTariff` (`src/flatTariff.ts`) attached to EP2 ("Standard") and EP3
  ("Standard (upcoming)"), so both tariff endpoints show more than just the Descriptor cluster.
- Minimal `CommodityPrice` and `CommodityMetering` (`src/commodityExtras.ts`) attached to EP2,
  matching the clusters shown on that endpoint in the spec's topology figure. `CommodityMetering`
  is refreshed on the same periodic timer as `ElectricalEnergyMeasurement`.
