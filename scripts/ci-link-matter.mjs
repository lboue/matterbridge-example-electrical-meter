#!/usr/bin/env node
/**
 * @file scripts/ci-link-matter.mjs
 * @description Matterbridge's own PluginManager refuses to load a plugin that lists any `@matter/*`
 * (or `matterbridge`/`@matterbridge`/`@project-chip`) package under ANY dependency field in its
 * package.json ("Found invalid packages ... Please open an issue on the plugin repository to remove
 * them.") — see packages/core/src/pluginManager.ts in the matterbridge repo. So this plugin cannot
 * declare @matter/main / @matter/types as dependencies to resolve the few deep imports it still needs
 * (MeterIdentification.MeterType, CommodityTariff.Feature/BlockMode, TariffUnit, TariffPriceType —
 * matterbridge doesn't re-export these enums/types under its own package yet).
 *
 * Locally, nested inside the matterbridge monorepo checkout, Node's own ancestor-directory
 * node_modules walk-up finds a usable @matter copy without any help. In CI, matterbridge is linked
 * from a sibling checkout (`../matterbridge`), not an ancestor directory, so nothing is found there
 * at all ("Cannot find module '@matter/main/...'"). This script symlinks (a junction on Windows,
 * which unlike a symlink doesn't require elevated privileges) the plugin's own `node_modules/@matter`
 * to the linked matterbridge's own copy, without touching package.json — a no-op if `../matterbridge`
 * doesn't exist (e.g. local nested dev, where ancestor resolution already works).
 */
import { existsSync, rmSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve('../matterbridge/node_modules/@matter');
const linkPath = resolve('node_modules/@matter');

if (!existsSync(target)) {
  console.log(`ci-link-matter: ${target} does not exist, skipping (matterbridge is not linked from a sibling checkout).`);
  process.exit(0);
}

rmSync(linkPath, { recursive: true, force: true });
symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
console.log(`ci-link-matter: linked ${linkPath} -> ${target}`);
