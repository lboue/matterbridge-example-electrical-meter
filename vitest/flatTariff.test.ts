/**
 * @file vitest/flatTariff.test.ts
 * @description Tests for the flat-rate CommodityTariff builder.
 * @author https://github.com/lboue
 */

import { buildFlatTariff } from '../src/flatTariff.js';

describe('buildFlatTariff', () => {
  it('should scale the price to the currency decimal points', () => {
    const attrs = buildFlatTariff({ label: 'Standard', providerName: 'Test', priceEurPerKwh: 0.2 });
    expect(attrs.tariffComponents?.[0]?.price?.price).toBe(2000); // 0.2 EUR * 10^4 decimal points
  });

  it('should publish a single day entry covering the whole day, every day', () => {
    const attrs = buildFlatTariff({ label: 'Standard', providerName: 'Test', priceEurPerKwh: 0.2 });
    expect(attrs.dayEntries).toEqual([{ dayEntryId: 1, startTime: 0 }]);
    expect(attrs.dayPatterns?.[0]?.dayEntryIDs).toEqual([1]);
    expect(attrs.dayPatterns?.[0]?.daysOfWeek).toMatchObject({ monday: true, sunday: true });
  });

  it('should resolve current and next tariff components to the same flat-rate component', () => {
    const attrs = buildFlatTariff({ label: 'Standard', providerName: 'Test', priceEurPerKwh: 0.2 });
    expect(attrs.currentTariffComponents).toEqual(attrs.tariffComponents);
    expect(attrs.nextTariffComponents).toEqual(attrs.tariffComponents);
    expect(attrs.currentDayEntry).toEqual(attrs.nextDayEntry);
  });

  it('should default startDate to now when not provided', () => {
    const before = Math.floor(Date.now() / 1000);
    const attrs = buildFlatTariff({ label: 'Standard', providerName: 'Test', priceEurPerKwh: 0.2 });
    const after = Math.floor(Date.now() / 1000);
    expect(attrs.startDate).toBeGreaterThanOrEqual(before);
    expect(attrs.startDate).toBeLessThanOrEqual(after);
  });

  it('should use the given startDate when provided', () => {
    const attrs = buildFlatTariff({ label: 'Standard', providerName: 'Test', priceEurPerKwh: 0.2, startDate: 1_700_000_000 });
    expect(attrs.startDate).toBe(1_700_000_000);
    expect(attrs.calendarPeriods?.[0]?.startDate).toBe(1_700_000_000);
  });
});
