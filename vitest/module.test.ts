/**
 * @file vitest/module.test.ts
 * @description Tests for the example electrical meter plugin.
 * @author https://github.com/lboue
 */

/**
 * WARNING!!!
 * The tests in this unit are supposed to run sequentially because they depend on the Matterbridge/Matter state.
 * Is not possible for timing reasons to create and destroy a Matter node each test to keep isolation.
 */

import path from 'node:path';

import type { MatterbridgeEndpoint, PlatformMatterbridge } from 'matterbridge';
import { AnsiLogger, LogLevel } from 'matterbridge/logger';
import { VendorId } from 'matterbridge/matter';

import { ElectricalMeterPlatform, type ElectricalMeterPlatformConfig } from '../src/module.js';

const mockMatterbridge: PlatformMatterbridge = {
  systemInformation: {
    interfaceName: 'eth0',
    macAddress: 'aa:bb:cc:dd:ee:ff',
    ipv4Address: '192.168.1.1',
    ipv6Address: 'fd78:cbf8:4939:746:a96:8277:346f:416e',
    osRelease: 'x.y.z',
    nodeVersion: '22.10.0',
    hostname: 'matterbridge',
    user: 'jest',
    osType: 'Linux',
    osPlatform: 'linux',
    osArch: 'x64',
    totalMemory: '0 B',
    freeMemory: '0 B',
    systemUptime: '0s',
    processUptime: '0s',
    cpuUsage: '0%',
    processCpuUsage: '0%',
    rss: '0 B',
    heapTotal: '0 B',
    heapUsed: '0 B',
  },
  uuid: '00000000-0000-0000-0000-000000000000',
  rootDirectory: path.join('.cache', 'vitest', 'ElectricalMeterPlugin'),
  homeDirectory: path.join('.cache', 'vitest', 'ElectricalMeterPlugin'),
  matterbridgeDirectory: path.join('.cache', 'vitest', 'ElectricalMeterPlugin', '.matterbridge'),
  matterbridgePluginDirectory: path.join('.cache', 'vitest', 'ElectricalMeterPlugin', 'Matterbridge'),
  matterbridgeCertDirectory: path.join('.cache', 'vitest', 'ElectricalMeterPlugin', '.mattercert'),
  globalModulesDirectory: path.join('.cache', 'vitest', 'ElectricalMeterPlugin', 'node_modules'),
  matterbridgeVersion: '3.10.0',
  matterbridgeLatestVersion: '3.10.0',
  matterbridgeDevVersion: '3.10.0',
  frontendVersion: '3.0.0',
  bridgeMode: 'bridge',
  restartMode: 'docker',
  virtualMode: 'mounted_switch',
  aggregatorVendorId: VendorId(0xfff1),
  aggregatorVendorName: 'Matterbridge',
  aggregatorProductId: 0x8000,
  aggregatorProductName: 'Matterbridge Vitest Aggregator',
};

const mockLog = {
  fatal: vi.fn((message: string, ...parameters: any[]) => {}),
  error: vi.fn((message: string, ...parameters: any[]) => {}),
  warn: vi.fn((message: string, ...parameters: any[]) => {}),
  notice: vi.fn((message: string, ...parameters: any[]) => {}),
  info: vi.fn((message: string, ...parameters: any[]) => {}),
  debug: vi.fn((message: string, ...parameters: any[]) => {}),
} as unknown as AnsiLogger;

const mockConfig: ElectricalMeterPlatformConfig = {
  name: 'matterbridge-example-electrical-meter',
  type: 'DynamicPlatform',
  version: '1.0.0',
  whiteList: [],
  blackList: [],
  debug: false,
  unregisterOnShutdown: false,
  updateIntervalSeconds: 10,
};

// Mocked methods
const addBridgedEndpoint = vi.fn(async (pluginName: string, device: MatterbridgeEndpoint) => {});
const removeBridgedEndpoint = vi.fn(async (pluginName: string, device: MatterbridgeEndpoint) => {});
const removeAllBridgedEndpoints = vi.fn(async (pluginName: string) => {});
const registerVirtualDevice = vi.fn(async (name: string, type: 'light' | 'outlet' | 'switch' | 'mounted_switch', callback: () => Promise<void>) => {});

// Mock the logger
const loggerLogSpy = vi.spyOn(AnsiLogger.prototype, 'log').mockImplementation((level: string, message: string, ...parameters: any[]) => {});

describe('Matterbridge Example Electrical Meter', () => {
  let instance: ElectricalMeterPlatform;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('should throw an error if matterbridge is not the required version', () => {
    expect(() => new ElectricalMeterPlatform({ ...mockMatterbridge, matterbridgeVersion: '2.0.0' }, mockLog, mockConfig)).toThrow(
      'This plugin requires Matterbridge version >= "3.10.0". Please update Matterbridge from 2.0.0 to the latest version in the frontend.',
    );
  });

  it('should create an instance of the platform', async () => {
    instance = (await import('../src/module.js')).default(mockMatterbridge, mockLog, mockConfig);
    expect(instance).toBeInstanceOf(ElectricalMeterPlatform);
    // @ts-expect-error Accessing private method for testing purposes
    instance.setMatterNode(addBridgedEndpoint, removeBridgedEndpoint, removeAllBridgedEndpoints, registerVirtualDevice);
    expect(instance.matterbridge).toBe(mockMatterbridge);
    expect(instance.log).toBe(mockLog);
    expect(instance.config).toBe(mockConfig);
    expect(mockLog.info).toHaveBeenCalledWith('Initializing Platform...');
  });

  it('should start and register the EP1/EP2/EP3 electrical meter endpoint tree', async () => {
    await instance.onStart('Vitest');
    expect(mockLog.info).toHaveBeenCalledWith('onStart called with reason: Vitest');
    // A single registerDevice() call registers the whole tree (parent + its two children).
    expect(addBridgedEndpoint).toHaveBeenCalledTimes(1);

    const [meter] = instance.getDevices();
    expect(meter.deviceName).toBe('Electrical Meter');
    expect(meter.hasClusterServer('MeterIdentification')).toBe(true);
    expect(meter.hasClusterServer('Identify')).toBe(true);

    const current = meter.getChildEndpointById('electricalMeterCurrent');
    expect(current?.hasClusterServer('PowerTopology')).toBe(true);
    expect(current?.hasClusterServer('ElectricalPowerMeasurement')).toBe(true);
    expect(current?.hasClusterServer('ElectricalEnergyMeasurement')).toBe(true);
    expect(current?.hasClusterServer('CommodityTariff')).toBe(true);
    expect(current?.hasClusterServer('CommodityPrice')).toBe(true);
    expect(current?.hasClusterServer('CommodityMetering')).toBe(true);

    const upcoming = meter.getChildEndpointById('electricalMeterUpcoming');
    expect(upcoming?.hasClusterServer('CommodityTariff')).toBe(true);
  });

  it('should configure and start the periodic simulated updates', async () => {
    vi.useFakeTimers();

    // The mocked addBridgedEndpoint never brings the endpoint's construction to the Active
    // state, so setAttribute() is a no-op here — spy on it to verify the timer wires the
    // simulated power/energy readings to the right cluster/attribute instead of reading state back.
    const [meter] = instance.getDevices();
    const current = meter.getChildEndpointById('electricalMeterCurrent');
    if (!current) throw new Error('electricalMeterCurrent child endpoint not found');
    const setAttributeSpy = vi.spyOn(current, 'setAttribute');

    await instance.onConfigure();
    expect(mockLog.info).toHaveBeenCalledWith('onConfigure called');

    await vi.advanceTimersByTimeAsync(10_000);

    expect(setAttributeSpy).toHaveBeenCalledWith('ElectricalPowerMeasurement', 'activePower', expect.any(Number), mockLog);
    expect(setAttributeSpy).toHaveBeenCalledWith('ElectricalPowerMeasurement', 'activeCurrent', expect.any(Number), mockLog);
    expect(setAttributeSpy).toHaveBeenCalledWith('ElectricalEnergyMeasurement', 'cumulativeEnergyImported', { energy: expect.any(Number) }, mockLog);
    expect(setAttributeSpy).toHaveBeenCalledWith('CommodityMetering', 'meteredQuantity', expect.any(Array), mockLog);
    expect(setAttributeSpy).toHaveBeenCalledWith('CommodityMetering', 'meteredQuantityTimestamp', expect.any(Number), mockLog);

    vi.useRealTimers();
  });

  it('should change logger level', async () => {
    await instance.onChangeLoggerLevel(LogLevel.DEBUG);
    expect(mockLog.info).toHaveBeenCalledWith('onChangeLoggerLevel called with: debug');
  });

  it('should shutdown and stop the periodic updates', async () => {
    await instance.onShutdown('Vitest');
    expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason: Vitest');
    expect(removeAllBridgedEndpoints).not.toHaveBeenCalled();

    // Mock the unregisterOnShutdown behavior
    mockConfig.unregisterOnShutdown = true;
    await instance.onShutdown();
    expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason: none');
    expect(removeAllBridgedEndpoints).toHaveBeenCalled();
    mockConfig.unregisterOnShutdown = false;
  });
});
