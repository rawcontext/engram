import { Rehydrator } from './rehydrator';
import { Executor, WasmLoader, DEFAULT_CONFIG, SECURE_POLICY } from '@the-soul/wassette';

export class ReplayEngine {
  constructor(private rehydrator: Rehydrator, private loader: WasmLoader) {}

  async replay(sessionId: string, eventId: string) {
      // 1. Rehydrate VFS at event time
      // 2. Load Tool
      // 3. Execute
      // 4. Compare output
  }
}
