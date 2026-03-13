/**
 * RAG服务
 */

import type { Document, SearchResult } from './types';

export class RAGService {
  async indexDocument(doc: Document): Promise<void> {
    // TODO: 向量化并存入ChromaDB
  }

  async search(query: string, user: { department: string }, topK = 5): Promise<SearchResult[]> {
    // TODO: 混合检索
    return [];
  }

  buildContext(results: SearchResult[]): string {
    return results.map((r, i) => `[来源 ${i + 1}] ${r.title}\n${r.content}`).join('\n---\n');
  }
}
