export type WidgetMessageRole = 'user' | 'assistant'

export type ChatMode = 'ai' | 'human'

export type WidgetAttachmentStatus = 'ready' | 'uploading' | 'done' | 'error'

export interface WidgetAttachment {
  id: string
  name: string
  size: number
  type: string
  url?: string
  /** Same-page preview supplied by the host for formats requiring conversion. */
  previewUrl?: string
  previewKind?: 'image' | 'video' | 'iframe'
  file?: File
  status?: WidgetAttachmentStatus
  progress?: number
  error?: string
}

export interface WidgetMessage {
  id: string
  role: WidgetMessageRole
  content: string
  createdAt?: string
  attachments?: WidgetAttachment[]
  status?: 'sending' | 'sent' | 'error'
}

export interface CloudFile {
  id: string
  name: string
  size?: number
  type?: string
  url?: string
  previewUrl?: string
  previewKind?: 'image' | 'video' | 'iframe'
  updatedAt?: string
  parentId?: string | null
  isFolder?: boolean
}

export interface SendContext {
  mode: ChatMode
  conversationId: string
  signal?: AbortSignal
  /** Append one incremental text chunk to the pending AI reply. */
  onChunk?: (text: string) => void
}

/** Internal event passed from the SDK mount bridge to the Vue widget. */
export interface WidgetIncomingMessage {
  sequence: number
  message: WidgetMessage
  conversationId?: string
}

export interface WidgetOptions {
  title?: string
  subtitle?: string
  welcomeText?: string
  initialMessages?: WidgetMessage[]
  cloudFiles?: CloudFile[]
  maxFiles?: number
  onSend?: (message: WidgetMessage, context: SendContext) => Promise<string | WidgetMessage | void> | string | WidgetMessage | void
  onUpload?: (
    file: File,
    onProgress: (percent: number) => void,
    signal?: AbortSignal,
  ) => Promise<WidgetAttachment | void> | WidgetAttachment | void
  onClose?: () => void
}
