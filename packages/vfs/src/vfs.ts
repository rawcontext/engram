import * as zlib from "zlib";
import { promisify } from "util";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export interface FileNode {
  type: "file";
  name: string;
  content: string;
  lastModified: number;
}

export interface DirectoryNode {
  type: "directory";
  name: string;
  children: Record<string, FileNode | DirectoryNode>;
}

export class VirtualFileSystem {
  public root: DirectoryNode;
  public cwd: string;

  constructor(root?: DirectoryNode) {
    this.root = root || { type: "directory", name: "", children: {} };
    this.cwd = "/";
  }

  // Basic CRUD (Simplified)
  public exists(path: string): boolean {
    return !!this.resolve(path);
  }

  public mkdir(path: string): void {
    // TODO: Implement recursive mkdir
    // For V1, simplified: assumes one level
    // Real implementation needs full path traversal
    const parts = this.splitPath(path);
    let current = this.root;
    for (const part of parts) {
      if (!current.children[part]) {
        current.children[part] = { type: "directory", name: part, children: {} };
      }
      const next = current.children[part];
      if (next.type !== "directory") throw new Error(`Not a directory: ${part}`);
      current = next;
    }
  }

  public writeFile(path: string, content: string): void {
    const parts = this.splitPath(path);
    const fileName = parts.pop()!;
    let current = this.root;
    for (const part of parts) {
      if (!current.children[part]) {
        this.mkdir(this.joinPath(parts)); // Recursively create?
        // Re-traverse or just create here
        current.children[part] = { type: "directory", name: part, children: {} };
      }
      const next = current.children[part];
      if (next.type !== "directory") throw new Error(`Not a directory: ${part}`);
      current = next;
    }
    current.children[fileName] = {
      type: "file",
      name: fileName,
      content,
      lastModified: Date.now(),
    };
  }

  public readFile(path: string): string {
    const node = this.resolve(path);
    if (!node || node.type !== "file") throw new Error(`File not found: ${path}`);
    return node.content;
  }

  public readDir(path: string): string[] {
    const node = this.resolve(path);
    if (!node || node.type !== "directory") throw new Error(`Directory not found: ${path}`);
    return Object.keys(node.children);
  }

  private resolve(path: string): FileNode | DirectoryNode | null {
    const parts = this.splitPath(path);
    let current: FileNode | DirectoryNode = this.root;
    for (const part of parts) {
      if (current.type !== "directory") return null;
      if (!current.children[part]) return null;
      current = current.children[part];
    }
    return current;
  }

  private splitPath(path: string): string[] {
    return path.split("/").filter(Boolean);
  }

  private joinPath(parts: string[]): string {
    return "/" + parts.join("/");
  }

  // Snapshot Logic
  public async createSnapshot(): Promise<Buffer> {
    const state = JSON.stringify(this.root);
    return gzip(state);
  }

  public async loadSnapshot(snapshot: Buffer): Promise<void> {
    const state = await gunzip(snapshot);
    this.root = JSON.parse(state.toString());
  }
}
