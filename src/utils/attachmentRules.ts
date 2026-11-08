export const DEFAULT_MAX_FILES = 10

const MB = 1024 * 1024

type AttachmentRule = {
  extensions: readonly string[]
  maxBytes: number
  limitLabel: string
}

const rules: readonly AttachmentRule[] = [
  { extensions: ['stp', 'step', 'igs', 'iges'], maxBytes: 500 * MB, limitLabel: '500 MB' },
  { extensions: ['csv', 'xls', 'xlsx'], maxBytes: 20 * MB, limitLabel: '20 MB' },
  { extensions: ['yjwl'], maxBytes: 500 * MB, limitLabel: '500 MB' },
  { extensions: ['stl'], maxBytes: 400 * MB, limitLabel: '400 MB' },
  { extensions: ['ply', 'obj', 'glb', '3mf'], maxBytes: 500 * MB, limitLabel: '500 MB' },
  // The reference gives no separate image/video limit. Keep the preview payload bounded.
  { extensions: ['png', 'jpg', 'jpeg', 'gif', 'mp4'], maxBytes: 20 * MB, limitLabel: '20 MB' },
]

export const ATTACHMENT_ACCEPT = rules
  .flatMap((rule) => rule.extensions)
  .map((extension) => `.${extension}`)
  .join(',')

export function getExtension(name: string): string {
  const filename = name.split(/[\\/]/).pop() ?? ''
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

export function validateAttachment(name: string, size?: number): string | null {
  const extension = getExtension(name)
  const rule = rules.find((entry) => entry.extensions.includes(extension))
  if (!rule) {
    return `“${name}”格式暂不支持。请上传模型、表格、图片或 MP4 视频。`
  }

  if (size !== undefined && size >= rule.maxBytes) {
    return `“${name}”需小于 ${rule.limitLabel}。`
  }

  return null
}

export function formatFileSize(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '大小未知'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / MB).toFixed(1)} MB`
}

export function isImageAttachment(name: string): boolean {
  return ['png', 'jpg', 'jpeg', 'gif'].includes(getExtension(name))
}
