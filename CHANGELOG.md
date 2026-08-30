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

### Changed

- `MeterIdentification`, `CommodityPrice` and `CommodityMetering` now use `matterbridge`'s own
  `createDefault...ClusterServer()` helpers ([Luligu/matterbridge#596](https://github.com/Luligu/matterbridge/pull/596))
  instead of hand-rolled `behaviors.require()` calls — no more `@matter/main/behaviors/...` import
  for any of them. `CommodityTariff` (`src/flatTariff.ts`) now attaches through `matterbridge`'s
  exported `MatterbridgeCommodityTariffServer` (`matterbridge/behaviors`) instead of a plugin-local
  subclass, removing the need to implement `GetTariffComponent`/`GetDayEntry` in the plugin.
- `@matter/main`/`@matter/types` are no longer declared as package.json dependencies:
  `matterbridge`'s own `PluginManager` refuses to load a plugin that lists any `@matter/*` package
  under any dependency field ("Found invalid packages ... Please open an issue on the plugin
  repository to remove them.") — declaring them, done earlier to fix a CI "Cannot find module"
  error, actually broke loading the plugin entirely. `scripts/ci-link-matter.mjs` (a symlink from
  the plugin's own `node_modules/@matter` to the linked matterbridge's own copy, set up by a CI-only
  step, not via package.json) resolves the plugin's remaining deep imports (`MeterIdentification.MeterType`,
  `CommodityTariff.Feature`/`BlockMode`, `TariffUnit`, `TariffPriceType` — matterbridge doesn't
  re-export these enums/types under its own package yet) without tripping that check.
