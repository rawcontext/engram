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

    const propKeys = Object.keys(edgeData);
    const propsString = propKeys.map(k => `${k}: $${k}`).join(', ');

    const query = `
      MATCH (a {id: $fromId}), (b {id: $toId})
      CREATE (a)-[:${relationType} { ${propsString} }]->(b)
    `;

    await this.client.query(query, { fromId, toId, ...edgeData });
  }

  // Transaction Time: Update (Append-Only / Replace)
  async updateNode<T extends BaseNode>(
    oldNodeId: string,
    label: string,
    newNodeData: Omit<T, 'vt_start' | 'vt_end' | 'tt_start' | 'tt_end'>,
    validFrom: number = now()
  ): Promise<void> {
    // 1. Write the new node version
    await this.writeNode(label, newNodeData, validFrom);

    // 2. Link New -> Old via REPLACES
    // We expect newNodeData to contain the new 'id'
    await this.writeEdge(newNodeData.id, oldNodeId, 'REPLACES', {}, validFrom);
  }

  // Transaction Time: Delete (Logical Delete)
  async deleteNode(id: string): Promise<void> {
    const t = now();
    // Close the transaction time interval for the current version
    const query = `
      MATCH (n {id: $id})
      WHERE n.tt_end = ${MAX_DATE}
      SET n.tt_end = $t
    `;
    await this.client.query(query, { id, t });
  }
}