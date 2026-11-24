import type { BridgeMapping } from '@/generated/openapi';

export interface Endpoint {
  radio: string;
  channel: string;
}

export interface ChannelConnection {
  id: number;
  a: Endpoint;
  b: Endpoint;
  forward?: { mapping: BridgeMapping; order: number };
  reverse?: { mapping: BridgeMapping; order: number };
}

/** Pair inverse mappings one-to-one, keeping duplicates and their original positions. */
export function groupConnections(mappings: BridgeMapping[]): ChannelConnection[] {
  const connections: ChannelConnection[] = [];
  mappings.forEach((mapping, order) => {
    const inverse = connections.find(
      (connection) =>
        !connection.reverse &&
        connection.a.radio === mapping.target_radio &&
        connection.a.channel === mapping.target_channel &&
        connection.b.radio === mapping.source_radio &&
        connection.b.channel === mapping.source_channel,
    );
    const entry = { mapping: { ...mapping }, order };
    if (inverse) {
      inverse.reverse = entry;
    } else {
      connections.push({
        id: order,
        a: { radio: mapping.source_radio, channel: mapping.source_channel },
        b: { radio: mapping.target_radio, channel: mapping.target_channel },
        forward: entry,
      });
    }
  });
  return connections;
}

function endpointFields(source: Endpoint, target: Endpoint) {
  return {
    source_radio: source.radio,
    source_channel: source.channel,
    target_radio: target.radio,
    target_channel: target.channel,
  };
}

/** Restore mapping order independently of the display order of connection cards. */
export function serializeConnections(connections: ChannelConnection[]): BridgeMapping[] {
  const entries: { mapping: BridgeMapping; order: number }[] = [];
  for (const connection of connections) {
    if (connection.forward) {
      entries.push({
        order: connection.forward.order,
        mapping: { ...connection.forward.mapping, ...endpointFields(connection.a, connection.b) },
      });
    }
    if (connection.reverse) {
      entries.push({
        order: connection.reverse.order,
        mapping: { ...connection.reverse.mapping, ...endpointFields(connection.b, connection.a) },
      });
    }
  }
  return entries.sort((a, b) => a.order - b.order).map((entry) => entry.mapping);
}

export function setConnectionDirection(
  connection: ChannelConnection,
  direction: 'forward' | 'reverse',
  enabled: boolean,
  order: number,
): void {
  const existing = connection[direction];
  if (existing) {
    existing.mapping = { ...existing.mapping, enabled };
  } else if (enabled) {
    const [source, target] =
      direction === 'forward' ? [connection.a, connection.b] : [connection.b, connection.a];
    connection[direction] = {
      mapping: { ...endpointFields(source, target), enabled: true },
      order,
    };
  }
}

export function connectionKind(connection: ChannelConnection): 'Same channel' | 'Cross-channel' {
  return connection.a.channel === connection.b.channel ? 'Same channel' : 'Cross-channel';
}
