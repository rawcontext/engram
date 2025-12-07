import { FalkorClient } from '@the-soul/storage';
import { createBitemporal, MAX_DATE, now } from './utils/time';
import { BaseNode } from './models/base';

export class GraphWriter {
  constructor(private client: FalkorClient) {}

  async writeNode<T extends BaseNode>(
    label: string, 
    data: Omit<T, 'vt_start' | 'vt_end' | 'tt_start' | 'tt_end'>, 
    validFrom: number = now()
  ): Promise<void> {
    const temporal = createBitemporal(validFrom);
    const nodeData = { ...data, ...temporal };
    
    // Construct Cypher query dynamically based on keys
    // Note: We need to serialize props carefully.
    // In a real system, we'd use a query builder.
    
    // Extract keys for CREATE clause
    const propKeys = Object.keys(nodeData);
    const propsString = propKeys.map(k => `${k}: $${k}`).join(', ');
    
    const query = `CREATE (n:${label} { ${propsString} })`;
    
    await this.client.query(query, nodeData);
  }

  async writeEdge(
    fromId: string, 
    toId: string, 
    relationType: string, 
    props: Record<string, any> = {},
    validFrom: number = now()
  ): Promise<void> {
    const temporal = createBitemporal(validFrom);
    const edgeData = { ...props, ...temporal };

    // We assume nodes exist.
    // MATCH (a {id: $from}), (b {id: $to})
    // CREATE (a)-[:REL { ... }]->(b)
    
    const propKeys = Object.keys(edgeData);
    const propsString = propKeys.map(k => `${k}: $${k}`).join(', ');

    const query = `
      MATCH (a {id: $fromId}), (b {id: $toId})
      CREATE (a)-[:${relationType} { ${propsString} }]->(b)
    `;

    await this.client.query(query, { fromId, toId, ...edgeData });
  }
}
