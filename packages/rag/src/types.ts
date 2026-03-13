/**
 * RAG模块类型定义
 */

export interface Document {
  docId: string;
  title: string;
  content: string;
  metadata: DocumentMetadata;
}

export interface DocumentMetadata {
  department: string;
  classification: 'public' | 'internal' | 'confidential';
  author: string;
  createdAt: string;
  source: string;
  tags: string[];
}

export interface SearchResult {
  docId: string;
  title: string;
  content: string;
  metadata: DocumentMetadata;
  score: number;
}
