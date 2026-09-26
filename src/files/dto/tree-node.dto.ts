export interface TreeNode {
  name: string;
  path: string; // relative path from project root
  type: 'file' | 'folder';
  sizeBytes?: number;
  fileId?: string;
  isBinary?: boolean;
  children?: TreeNode[];
}
