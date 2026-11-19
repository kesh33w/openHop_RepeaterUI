import { describe, expect, it } from 'vitest';
import type { BridgeMapping } from '@/generated/openapi';
import {
  connectionKind,
  groupConnections,
  serializeConnections,
  setConnectionDirection,
  type ChannelConnection,
} from '@/utils/channelConnections';

const forward: BridgeMapping = {
  source_radio: 'a',
  source_channel: 'Public',
  target_radio: 'b',
  target_channel: 'Private',
};
const reverse: BridgeMapping = {
  source_radio: 'b',
  source_channel: 'Private',
  target_radio: 'a',
  target_channel: 'Public',
};

function firstConnection(mappings: BridgeMapping[]): ChannelConnection {
  const connection = groupConnections(mappings)[0];
  if (!connection) throw new Error('Expected a connection');
  return connection;
}

describe('channel connections', () => {
  it('round-trips nonadjacent inverse pairs, duplicates, disabled states and unknown fields', () => {
    const extra = { ...forward, future: { mode: 'preserve' }, enabled: false };
    const mappings = [
      extra,
      { ...forward, source_radio: 'c' },
      { ...forward, enabled: true },
      { ...reverse, enabled: false },
      reverse,
      forward,
    ];
    const connections = groupConnections(mappings);
    expect(connections).toHaveLength(4);
    expect(connections[0]?.forward?.order).toBe(0);
    expect(connections[0]?.reverse?.order).toBe(3);
    expect(connections[2]?.forward?.order).toBe(2);
    expect(connections[2]?.reverse?.order).toBe(4);
    expect(connections[3]?.reverse).toBeUndefined();
    expect(new Set(connections.map((connection) => connection.id)).size).toBe(4);
    expect(serializeConnections(connections)).toStrictEqual(mappings);
  });

  it('pairs only exact inverse endpoints, including channel names', () => {
    const mappings = [forward, { ...reverse, target_channel: 'Other' }];
    expect(groupConnections(mappings)).toHaveLength(2);
    expect(serializeConnections(groupConnections(mappings))).toStrictEqual(mappings);
  });

  it('updates both directions when endpoints change without changing other fields', () => {
    const connection = firstConnection([forward, { ...reverse, enabled: false }]);
    connection.a = { radio: 'new-a', channel: 'New public' };
    connection.b = { radio: 'new-b', channel: 'New private' };
    expect(serializeConnections([connection])).toStrictEqual([
      {
        source_radio: 'new-a',
        source_channel: 'New public',
        target_radio: 'new-b',
        target_channel: 'New private',
      },
      {
        source_radio: 'new-b',
        source_channel: 'New private',
        target_radio: 'new-a',
        target_channel: 'New public',
        enabled: false,
      },
    ]);
  });

  it('does not create an absent direction when disabling it', () => {
    const connection = firstConnection([forward]);
    setConnectionDirection(connection, 'reverse', false, 10);
    expect(connection.reverse).toBeUndefined();
    expect(serializeConnections([connection])).toStrictEqual([forward]);
  });

  it('creates a missing direction only when explicitly enabled', () => {
    const connection = firstConnection([forward]);
    setConnectionDirection(connection, 'reverse', true, 10);
    expect(connection.reverse).toStrictEqual({ mapping: { ...reverse, enabled: true }, order: 10 });
    expect(serializeConnections([connection])).toStrictEqual([
      forward,
      { ...reverse, enabled: true },
    ]);
  });

  it('toggles existing directions without losing extras, order or mutating input', () => {
    const original = { ...forward, future: 'retained' };
    const connection = firstConnection([original]);
    setConnectionDirection(connection, 'forward', false, 99);
    expect(connection.forward).toStrictEqual({
      mapping: { ...original, enabled: false },
      order: 0,
    });
    setConnectionDirection(connection, 'forward', true, 100);
    expect(connection.forward).toStrictEqual({ mapping: { ...original, enabled: true }, order: 0 });
    expect(original).toStrictEqual({ ...forward, future: 'retained' });
  });

  it('serializes original and new directions by order even if cards are reordered', () => {
    const unrelated = { ...forward, source_radio: 'c' };
    const connections = groupConnections([forward, unrelated, reverse]);
    const second = connections[1];
    if (!second) throw new Error('Expected a second connection');
    setConnectionDirection(second, 'reverse', true, 50);
    expect(serializeConnections([...connections].reverse())).toStrictEqual([
      forward,
      unrelated,
      reverse,
      { ...reverse, target_radio: 'c', enabled: true },
    ]);
  });

  it('supports empty connections and creating either direction', () => {
    expect(groupConnections([])).toStrictEqual([]);
    expect(serializeConnections([])).toStrictEqual([]);
    const connection: ChannelConnection = {
      id: 1,
      a: { radio: 'a', channel: 'Public' },
      b: { radio: 'b', channel: 'Private' },
    };
    setConnectionDirection(connection, 'forward', false, 10);
    expect(serializeConnections([connection])).toStrictEqual([]);
    setConnectionDirection(connection, 'forward', true, 11);
    expect(serializeConnections([connection])).toStrictEqual([{ ...forward, enabled: true }]);
  });

  it('classifies connections by channel names', () => {
    const connection = firstConnection([forward]);
    expect(connectionKind(connection)).toBe('Cross-channel');
    connection.b.channel = connection.a.channel;
    expect(connectionKind(connection)).toBe('Same channel');
  });
});
