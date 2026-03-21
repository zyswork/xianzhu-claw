// 知识库模型定义

export interface KnowledgeBaseDocument {
  id: string
  enterpriseId: string
  title: string
  content: string
  contentType: 'text' | 'markdown' | 'html'
  tags: string[]
  permissions: {
    read: string[]
    write: string[]
  }
  version: number
  status: 'draft' | 'published' | 'archived'
  createdBy: string
  createdAt: Date
  updatedAt: Date
  vectorized: boolean
}

export interface CreateDocumentRequest {
  title: string
  content: string
  contentType?: 'text' | 'markdown' | 'html'
  tags?: string[]
  permissions?: {
    read: string[]
    write: string[]
  }
}

export interface UpdateDocumentRequest {
  title?: string
  content?: string
  contentType?: 'text' | 'markdown' | 'html'
  tags?: string[]
  permissions?: {
    read: string[]
    write: string[]
  }
  status?: 'draft' | 'published' | 'archived'
}

export interface DocumentSearchRequest {
  query: string
  tags?: string[]
  limit?: number
  offset?: number
}

export interface DocumentResponse {
  id: string
  enterpriseId: string
  title: string
  content: string
  contentType: string
  tags: string[]
  permissions: {
    read: string[]
    write: string[]
  }
  version: number
  status: string
  createdBy: string
  createdAt: string
  updatedAt: string
  vectorized: boolean
}

export interface DocumentVersion {
  version: number
  content: string
  createdAt: Date
  createdBy: string
  changeDescription?: string
}
