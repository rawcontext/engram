import type { StreamDelta } from "./parser/interface";

export class DiffExtractor {
  private buffer = "";
  private inDiffBlock = false;
  private startMarker = "<<<<<<< SEARCH";
  private endMarker = ">>>>>>> REPLACE";

  process(chunk: string): StreamDelta {
    this.buffer += chunk;

    let content = "";
    let diffFragment = "";

    while (this.buffer.length > 0) {
      if (!this.inDiffBlock) {
        const startIndex = this.buffer.indexOf(this.startMarker);
        if (startIndex !== -1) {
          content += this.buffer.slice(0, startIndex);
          this.inDiffBlock = true;
          // Keep the marker in the diff fragment?
          // Usually markers are meta-data, but for Unified Diff tools, they might be needed.
          // Plan says "Extract these blocks... to trigger Speculative Execution".
          // Let's include markers in the 'diff' field so downstream knows format.
          diffFragment += this.startMarker; // Start diff with marker
          this.buffer = this.buffer.slice(startIndex + this.startMarker.length);
        } else {
          // Check partial match
          let partial = false;
          for (let i = 1; i < this.startMarker.length; i++) {
            if (this.buffer.endsWith(this.startMarker.slice(0, i))) {
              content += this.buffer.slice(0, this.buffer.length - i);
              this.buffer = this.buffer.slice(this.buffer.length - i);
              partial = true;
              break;
            }
          }
          if (!partial) {
            content += this.buffer;
            this.buffer = "";
          }
          break;
        }
      } else {
        // In diff block
        const endIndex = this.buffer.indexOf(this.endMarker);
        if (endIndex !== -1) {
          diffFragment += this.buffer.slice(0, endIndex + this.endMarker.length);
          this.inDiffBlock = false;
          this.buffer = this.buffer.slice(endIndex + this.endMarker.length);
        } else {
          // Check partial match for end marker
          let partial = false;
          for (let i = 1; i < this.endMarker.length; i++) {
            if (this.buffer.endsWith(this.endMarker.slice(0, i))) {
              diffFragment += this.buffer.slice(0, this.buffer.length - i);
              this.buffer = this.buffer.slice(this.buffer.length - i);
              partial = true;
              break;
            }
          }
          if (!partial) {
            diffFragment += this.buffer;
            this.buffer = "";
          }
          break;
        }
      }
    }

    const delta: StreamDelta = {};
    if (content) delta.content = content;
    if (diffFragment) {
      delta.diff = diffFragment;
    }
    return delta;
  }
}
