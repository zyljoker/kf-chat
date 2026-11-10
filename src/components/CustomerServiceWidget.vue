<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { XSender } from 'vue-element-plus-x'
import {
  ArrowDown,
  ArrowRight,
  ChatDotRound,
  Check,
  Close,
  CopyDocument,
  Delete,
  Download,
  EditPen,
  FullScreen,
  Paperclip,
  Plus,
  Promotion,
  RefreshRight,
} from '@element-plus/icons-vue'
import AttachmentPicker from './AttachmentPicker.vue'
import type { ChatMode, WidgetAttachment, WidgetIncomingMessage, WidgetMessage, WidgetOptions } from '../types'

const SpreadsheetPreview = defineAsyncComponent(() => import('./SpreadsheetPreview.vue'))
const ModelPreview = defineAsyncComponent(() => import('./ModelPreview.vue'))

interface Conversation {
  id: string
  mode: ChatMode
  title: string
  messages: WidgetMessage[]
  updatedAt: number
  unread: boolean
}

type Feedback = 'like' | 'dislike'
type SenderHandle = { getModelValue: () => unknown; clear: () => void }
type PickerHandle = { open: () => void; addFiles: (files: FileList | File[]) => void }

const props = withDefaults(defineProps<{
  options?: WidgetOptions
  incoming?: WidgetIncomingMessage[]
}>(), { options: () => ({}) })
const emit = defineEmits<{ incomingProcessed: [sequence: number] }>()
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
const firstId = newId()
const conversations = ref<Conversation[]>([{
  id: firstId,
  mode: 'ai',
  title: props.options.initialMessages?.find((message) => message.role === 'user')?.content.slice(0, 18) || '新会话',
  messages: props.options.initialMessages?.map((message) => ({ ...message })) || [],
  updatedAt: Date.now(),
  unread: false,
}])
const activeId = ref(firstId)
const panelOpen = ref(true)
const expanded = ref(false)
const panelWidth = ref(430)
const historyOpen = ref(false)
const collapsedGroups = ref<string[]>([])
const renamingId = ref<string | null>(null)
const renameText = ref('')
const deleteId = ref<string | null>(null)
const feedback = ref<Record<string, Feedback>>({})
const draftFiles = ref<WidgetAttachment[]>([])
const aiPending = ref(false)
const pendingController = ref<AbortController | null>(null)
const pendingMessageId = ref<string | null>(null)
const pendingConversationId = ref<string | null>(null)
const pendingUserId = ref<string | null>(null)
const senderRef = ref<SenderHandle | null>(null)
const pickerRef = ref<PickerHandle | null>(null)
const scrollRef = ref<HTMLElement | null>(null)
const previewFile = ref<WidgetAttachment | null>(null)
const previewDownloadAllowed = ref(false)
const expiredFiles = ref<Set<string>>(new Set())
const downloadProgress = ref<Record<string, number>>({})
const downloadErrors = ref<Set<string>>(new Set())
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | undefined
let dragStartWidth = 0
let dragStartX = 0
let lastIncomingSequence = 0
const objectUrls = new Map<string, string>()

const activeConversation = computed(() => conversations.value.find((item) => item.id === activeId.value) || conversations.value[0])
const mode = computed(() => activeConversation.value.mode)
const activeAiPending = computed(() => aiPending.value && pendingConversationId.value === activeId.value)
const currentMessages = computed(() => activeConversation.value.messages)
const isEmpty = computed(() => currentMessages.value.length === 0)
const modeHint = computed(() => mode.value === 'ai'
  ? 'AI 助手全天在线，请核实重要信息。'
  : '人工答疑：周一至周五 9:00–18:00；非服务时间可以留言。')

const historyGroups = computed(() => {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86400000
  const sevenDaysStart = todayStart - 6 * 86400000
  const buckets: Record<string, Conversation[]> = { 今天: [], 昨天: [], 最近7天: [], 更早: [] }
  for (const conversation of conversations.value) {
    const group = conversation.updatedAt >= todayStart ? '今天'
      : conversation.updatedAt >= yesterdayStart ? '昨天'
        : conversation.updatedAt >= sevenDaysStart ? '最近7天' : '更早'
    buckets[group].push(conversation)
  }
  return Object.entries(buckets)
    .filter(([, items]) => items.length)
    .map(([label, items]) => ({
      label,
      items: [...items].sort((a, b) => Number(b.unread) - Number(a.unread) || b.updatedAt - a.updatedAt),
    }))
})

watch(() => currentMessages.value.length, () => scrollToBottom())
watch(() => draftFiles.value.length, () => scrollToBottom())
watch(() => props.incoming, (batch) => {
  const previousSequence = lastIncomingSequence
  for (const incoming of batch || []) {
    if (incoming.sequence <= lastIncomingSequence) continue
    lastIncomingSequence = incoming.sequence
    const conversation = incoming.conversationId
      ? conversations.value.find((item) => item.id === incoming.conversationId)
      : activeConversation.value
    if (!conversation) {
      console.warn(`超级人工智能小U：未找到会话 ${incoming.conversationId}，消息未投递。`)
      continue
    }
    conversation.messages.push({ ...incoming.message, status: incoming.message.status || 'sent' })
    if (conversation.title === '新会话' && incoming.message.content) conversation.title = incoming.message.content.slice(0, 18)
    markActive(conversation)
  }
  if (lastIncomingSequence > previousSequence) emit('incomingProcessed', lastIncomingSequence)
  scrollToBottom()
})

function notify(message: string) {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 3600)
}

function scrollToBottom() {
  nextTick(() => {
    if (scrollRef.value) scrollRef.value.scrollTop = scrollRef.value.scrollHeight
  })
}

function createConversation(nextMode: ChatMode = mode.value) {
  const conversation: Conversation = {
    id: newId(), mode: nextMode, title: '新会话', messages: [], updatedAt: Date.now(), unread: false,
  }
  conversations.value.unshift(conversation)
  activeId.value = conversation.id
  historyOpen.value = false
  scrollToBottom()
}

function switchMode(nextMode: ChatMode) {
  if (nextMode === mode.value) return
  const existing = [...conversations.value]
    .filter((item) => item.mode === nextMode)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  if (existing) selectConversation(existing)
  else createConversation(nextMode)
}

function selectConversation(conversation: Conversation) {
  activeId.value = conversation.id
  conversation.unread = false
  historyOpen.value = false
  scrollToBottom()
}

function startRename(conversation: Conversation) {
  renamingId.value = conversation.id
  renameText.value = conversation.title
  deleteId.value = null
}

function saveRename(conversation: Conversation) {
  const title = renameText.value.trim()
  if (title) conversation.title = title
  renamingId.value = null
}

function deleteConversation(conversation: Conversation) {
  conversations.value = conversations.value.filter((item) => item.id !== conversation.id)
  deleteId.value = null
  if (!conversations.value.length) {
    createConversation('ai')
  } else if (activeId.value === conversation.id) {
    activeId.value = conversations.value[0].id
  }
  notify('会话已删除')
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(extractText).join('')
  if (value && typeof value === 'object') {
    const candidate = value as Record<string, unknown>
    if (typeof candidate.text === 'string') return candidate.text
    if (typeof candidate.value === 'string') return candidate.value
    if (Array.isArray(candidate.content)) return candidate.content.map(extractText).join('')
  }
  return ''
}

function markActive(conversation: Conversation) {
  conversation.updatedAt = Date.now()
  if (activeId.value !== conversation.id) conversation.unread = true
}

async function runResponse(userMessage: WidgetMessage, replaceId?: string) {
  const conversation = activeConversation.value
  if (conversation.mode === 'human') {
    if (!props.options.onSend) {
      userMessage.status = 'sent'
      notify('留言已保存在当前演示会话；接入 onSend 后可发送至人工客服')
      return
    }
    try {
      const response = await props.options.onSend(userMessage, { mode: 'human', conversationId: conversation.id })
      userMessage.status = 'sent'
      if (response) addResponse(conversation, response, replaceId)
      else notify('留言已发送，人工客服会在服务时间回复')
    } catch {
      userMessage.status = 'error'
      notify('留言发送失败，请重试')
    }
    return
  }

  aiPending.value = true
  const controller = new AbortController()
  pendingController.value = controller
  pendingConversationId.value = conversation.id
  pendingUserId.value = userMessage.id
  const placeholder: WidgetMessage = replaceId
    ? conversation.messages.find((message) => message.id === replaceId) || { id: replaceId, role: 'assistant', content: '' }
    : { id: newId(), role: 'assistant', content: '', status: 'sending', createdAt: new Date().toISOString() }
  placeholder.content = ''
  placeholder.status = 'sending'
  if (!replaceId) conversation.messages.push(placeholder)
  pendingMessageId.value = placeholder.id
  scrollToBottom()
  try {
    const response = props.options.onSend
      ? await props.options.onSend(userMessage, {
          mode: 'ai', conversationId: conversation.id, signal: controller.signal,
          onChunk: (text) => {
            if (controller.signal.aborted) return
            placeholder.content += text
            scrollToBottom()
          },
        })
      : await new Promise<string>((resolve) => setTimeout(() => resolve('当前为组件演示。请通过 SDK 的 onSend 回调接入您的 AI 服务。'), 550))
    if (controller.signal.aborted) return
    userMessage.status = 'sent'
    if (response) {
      const result = typeof response === 'string' ? { content: response } : response
      Object.assign(placeholder, result, { id: placeholder.id, role: 'assistant', status: 'sent' })
    } else {
      placeholder.content ||= '消息已发送，正在等待服务端回复。'
      placeholder.status = 'sent'
    }
    markActive(conversation)
  } catch {
    if (controller.signal.aborted) return
    userMessage.status = 'error'
    placeholder.content = '回复失败，请重试。'
    placeholder.status = 'error'
    notify('回复失败，请重试')
  } finally {
    if (pendingController.value === controller) {
      aiPending.value = false
      pendingController.value = null
      pendingMessageId.value = null
      pendingConversationId.value = null
      pendingUserId.value = null
    }
    scrollToBottom()
  }
}

function addResponse(conversation: Conversation, response: string | WidgetMessage, replaceId?: string) {
  const message: WidgetMessage = typeof response === 'string'
    ? { id: newId(), role: 'assistant', content: response, createdAt: new Date().toISOString(), status: 'sent' }
    : { ...response, id: response.id || newId(), role: 'assistant', status: 'sent' }
  const index = replaceId ? conversation.messages.findIndex((item) => item.id === replaceId) : -1
  if (index >= 0) conversation.messages[index] = message
  else conversation.messages.push(message)
  markActive(conversation)
  scrollToBottom()
}

async function sendMessage() {
  if (mode.value === 'ai' && aiPending.value) return
  const content = extractText(senderRef.value?.getModelValue()).trim()
  if (!content && !draftFiles.value.length) return
  if (draftFiles.value.some((file) => file.status === 'uploading')) return notify('请等待附件上传完成')
  if (draftFiles.value.some((file) => file.status === 'error')) return notify('请重试或移除上传失败的附件')
  const conversation = activeConversation.value
  const message: WidgetMessage = {
    id: newId(), role: 'user', content, createdAt: new Date().toISOString(),
    attachments: draftFiles.value.map((file) => ({ ...file })), status: 'sending',
  }
  conversation.messages.push(message)
  if (conversation.title === '新会话') conversation.title = content.slice(0, 18) || message.attachments?.[0]?.name || '文件会话'
  markActive(conversation)
  senderRef.value?.clear()
  draftFiles.value = []
  scrollToBottom()
  await runResponse(message)
}

function stopResponse() {
  pendingController.value?.abort()
  aiPending.value = false
  pendingController.value = null
  const conversation = conversations.value.find((item) => item.id === pendingConversationId.value)
  const index = conversation?.messages.findIndex((message) => message.id === pendingMessageId.value) ?? -1
  const pending = index >= 0 ? conversation?.messages[index] : undefined
  if (pending) {
    pending.content = '用户已取消'
    pending.status = 'sent'
  }
  const previousUser = conversation?.messages.find((message) => message.id === pendingUserId.value)
  if (previousUser) previousUser.status = 'sent'
  pendingMessageId.value = null
  pendingConversationId.value = null
  pendingUserId.value = null
  notify('已停止生成')
}

function retryMessage(message: WidgetMessage) {
  if (aiPending.value) return
  if (message.role === 'user') {
    message.status = 'sending'
    const index = currentMessages.value.findIndex((item) => item.id === message.id)
    const failedReply = currentMessages.value.slice(index + 1).find((item) => item.role === 'assistant' && item.status === 'error')
    void runResponse(message, failedReply?.id)
    return
  }
  const index = currentMessages.value.findIndex((item) => item.id === message.id)
  const user = [...currentMessages.value.slice(0, index)].reverse().find((item) => item.role === 'user')
  if (user) void runResponse(user, message.id)
}

async function copyText(content: string) {
  try {
    await navigator.clipboard.writeText(content)
    notify('已复制内容')
  } catch {
    notify('复制失败，请手动选择内容')
  }
}

function setFeedback(id: string, choice: Feedback) {
  if (feedback.value[id] === choice) delete feedback.value[id]
  else feedback.value[id] = choice
  notify(choice === 'like' ? '感谢您的反馈' : '已记录反馈')
}

function fileUrl(file: WidgetAttachment) {
  if (expiredFiles.value.has(file.id)) return ''
  if (file.url) return file.url
  if (!file.file) return ''
  const existing = objectUrls.get(file.id)
  if (existing) return existing
  const url = URL.createObjectURL(file.file)
  objectUrls.set(file.id, url)
  return url
}

function isImage(file: WidgetAttachment) {
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(file.name)
}

function isVideo(file: WidgetAttachment) {
  return file.type.startsWith('video/') || /\.(mp4|webm)$/i.test(file.name)
}

function previewKind(file: WidgetAttachment) {
  if (file.previewUrl) return file.previewKind || 'iframe'
  if (isImage(file)) return 'image'
  if (isVideo(file)) return 'video'
  if (/\.csv$/i.test(file.name)) return 'spreadsheet'
  if (/\.(stl|ply|obj|glb|3mf)$/i.test(file.name)) return 'model'
  if (/\.(pdf|txt)$/i.test(file.name)) return 'iframe'
  return 'unsupported'
}

function previewSource(file: WidgetAttachment): File | string {
  return file.previewUrl || file.file || fileUrl(file)
}

function preview(file: WidgetAttachment, allowDownload = false) {
  if (!previewSource(file)) return notify('文件已失效，无法预览')
  previewFile.value = file
  previewDownloadAllowed.value = allowDownload
}

function markFileExpired(file: WidgetAttachment) {
  expiredFiles.value = new Set([...expiredFiles.value, file.id])
  notify(`“${file.name}”已失效，无法预览`)
}

async function downloadFile(file: WidgetAttachment) {
  const url = fileUrl(file)
  if (!url) return notify('文件已失效，无法下载')
  // Large or unknown remote files should stream through the browser instead of
  // allocating hundreds of megabytes in JavaScript on tablets and phones.
  if (!file.file && (!file.size || file.size > 50 * 1024 * 1024)) {
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
    notify('已开始下载；大文件进度请在浏览器下载列表查看')
    return
  }
  downloadProgress.value[file.id] = 0
  try {
    let blob: Blob
    if (file.file) {
      blob = file.file
    } else {
      const response = await fetch(url, { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const total = Number(response.headers.get('content-length') || 0)
      if (response.body && total > 0) {
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let received = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          received += value.byteLength
          downloadProgress.value[file.id] = Math.min(99, Math.round(received / total * 100))
        }
        blob = new Blob(chunks as BlobPart[], { type: file.type || 'application/octet-stream' })
      } else blob = await response.blob()
    }
    const blobUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = file.name
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
    downloadProgress.value[file.id] = 100
    downloadErrors.value.delete(file.id)
    notify('文件已开始下载')
  } catch {
    downloadErrors.value = new Set([...downloadErrors.value, file.id])
    notify(`“${file.name}”下载失败，请重试`)
  } finally {
    setTimeout(() => { delete downloadProgress.value[file.id] }, 1200)
  }
}

function splitMessage(content: string): { text: string; url?: string }[] {
  const segments: { text: string; url?: string }[] = []
  const pattern = /https?:\/\/[^\s<>]+/g
  let cursor = 0
  for (const match of content.matchAll(pattern)) {
    if (match.index > cursor) segments.push({ text: content.slice(cursor, match.index) })
    segments.push({ text: match[0], url: match[0] })
    cursor = match.index + match[0].length
  }
  if (cursor < content.length) segments.push({ text: content.slice(cursor) })
  return segments
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function closePanel() {
  panelOpen.value = false
  historyOpen.value = false
  props.options.onClose?.()
}

function startResize(event: PointerEvent) {
  if (window.innerWidth <= 600) return
  dragStartX = event.clientX
  dragStartWidth = panelWidth.value
  window.addEventListener('pointermove', moveResize)
  window.addEventListener('pointerup', endResize, { once: true })
}

function moveResize(event: PointerEvent) {
  panelWidth.value = Math.max(360, Math.min(720, dragStartWidth + dragStartX - event.clientX, window.innerWidth - 32))
}

function endResize() { window.removeEventListener('pointermove', moveResize) }

function dropIntoChat(event: DragEvent) {
  if (event.dataTransfer?.files.length) pickerRef.value?.addFiles(event.dataTransfer.files)
}

onBeforeUnmount(() => {
  pendingController.value?.abort()
  if (toastTimer) clearTimeout(toastTimer)
  window.removeEventListener('pointermove', moveResize)
  for (const url of objectUrls.values()) URL.revokeObjectURL(url)
})
</script>

<template>
  <div class="kefu-root">
    <button v-if="!panelOpen" class="kefu-launcher" aria-label="打开超级人工智能小U" @click="panelOpen = true">
      <span class="robot-face robot-face--launcher"><span class="robot-eyes"><i /><i /></span></span>
      <span>咨询小U</span>
    </button>

    <section v-else class="kefu-panel" :class="{ 'kefu-panel--expanded': expanded }" :style="{ '--panel-width': `${panelWidth}px` }" aria-label="超级人工智能小U" @dragover.prevent @drop.prevent="dropIntoChat">
      <div class="resize-handle" role="separator" aria-label="拖动调整聊天窗口宽度" aria-orientation="vertical" @pointerdown="startResize" />
      <header class="panel-header">
        <span class="robot-face"><span class="robot-eyes"><i /><i /></span></span>
        <div class="panel-heading">
          <strong>{{ options.title || '超级人工智能小U' }}</strong>
          <span>{{ options.subtitle || '优解云端 · 随时为您解答' }}</span>
        </div>
        <div class="header-actions">
          <button class="icon-button" :aria-label="expanded ? '收起聊天窗口' : '展开聊天窗口'" :title="expanded ? '收起' : '展开'" @click="expanded = !expanded"><el-icon><FullScreen /></el-icon></button>
          <button class="icon-button" aria-label="关闭聊天窗口" title="关闭" @click="closePanel"><el-icon><Close /></el-icon></button>
        </div>
      </header>

      <nav class="panel-toolbar" aria-label="会话操作">
        <button class="toolbar-button" :class="{ active: historyOpen }" @click="historyOpen = !historyOpen">
          <el-icon><ChatDotRound /></el-icon><span>历史会话</span>
        </button>
        <button class="toolbar-button" @click="createConversation()"><el-icon><Plus /></el-icon><span>新会话</span></button>
        <span class="toolbar-spacer" />
        <button class="toolbar-feedback" :class="{ active: feedback[activeId] === 'like' }" aria-label="赞同本次会话" title="赞同" @click="setFeedback(activeId, 'like')">👍</button>
        <button class="toolbar-feedback" :class="{ active: feedback[activeId] === 'dislike' }" aria-label="不赞同本次会话" title="不赞同" @click="setFeedback(activeId, 'dislike')">👎</button>
      </nav>

      <div v-if="historyOpen" class="history-layer" role="dialog" aria-label="历史会话">
        <div class="history-heading"><strong>历史会话</strong><button class="icon-button" aria-label="关闭历史会话" @click="historyOpen = false"><el-icon><Close /></el-icon></button></div>
        <div class="history-scroll">
          <section v-for="group in historyGroups" :key="group.label" class="history-group">
            <button class="history-group-title" @click="collapsedGroups = collapsedGroups.includes(group.label) ? collapsedGroups.filter((label) => label !== group.label) : [...collapsedGroups, group.label]">
              <el-icon><ArrowRight v-if="collapsedGroups.includes(group.label)" /><ArrowDown v-else /></el-icon>{{ group.label }}
            </button>
            <div v-if="!collapsedGroups.includes(group.label)" class="history-items">
              <div v-for="conversation in group.items" :key="conversation.id" class="history-row" :class="{ selected: conversation.id === activeId }">
                <template v-if="renamingId === conversation.id">
                  <input v-model="renameText" class="rename-input" aria-label="会话名称" maxlength="40" @keydown.enter="saveRename(conversation)" @keydown.esc="renamingId = null" />
                  <button class="row-icon" aria-label="保存名称" @click="saveRename(conversation)"><el-icon><Check /></el-icon></button>
                </template>
                <template v-else-if="deleteId === conversation.id">
                  <span class="delete-question">删除这条会话？</span>
                  <button class="delete-yes" @click="deleteConversation(conversation)">删除</button>
                  <button class="delete-no" @click="deleteId = null">取消</button>
                </template>
                <template v-else>
                  <button class="history-select" @click="selectConversation(conversation)"><i v-if="conversation.unread" class="unread-dot" /><span>{{ conversation.title }}</span></button>
                  <span class="mode-tag" :class="conversation.mode">{{ conversation.mode === 'ai' ? 'AI' : '人工' }}</span>
                  <button class="row-icon" :aria-label="`重命名${conversation.title}`" @click="startRename(conversation)"><el-icon><EditPen /></el-icon></button>
                  <button class="row-icon" :aria-label="`删除${conversation.title}`" @click="deleteId = conversation.id"><el-icon><Delete /></el-icon></button>
                </template>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div class="mode-info"><span class="mode-info-icon">{{ mode === 'ai' ? '✦' : '●' }}</span><span>{{ modeHint }}</span></div>

      <main ref="scrollRef" class="messages" aria-label="聊天消息">
        <div v-if="isEmpty" class="welcome-state">
          <span class="robot-face robot-face--welcome"><span class="robot-eyes"><i /><i /></span></span>
          <strong>{{ mode === 'ai' ? '你好，我是超级人工智能小U' : '人工客服正在全力赶来' }}</strong>
          <p>{{ options.welcomeText || (mode === 'ai' ? '有问题或资料需要一起查看，直接告诉我。' : '请留下您的问题和文件，我们会尽快回复。') }}</p>
          <div class="welcome-suggestions" v-if="mode === 'ai'">
            <button @click="createConversation('ai'); notify('请在输入框描述您的问题')">开始新对话 <el-icon><ArrowRight /></el-icon></button>
          </div>
        </div>
        <div v-for="message in currentMessages" :key="message.id" class="message-row" :class="message.role">
          <span v-if="message.role === 'assistant'" class="robot-face robot-face--message"><span class="robot-eyes"><i /><i /></span></span>
          <div class="message-stack">
            <div class="message-meta"><span>{{ message.role === 'assistant' ? (mode === 'ai' ? '超级人工智能小U' : '人工客服') : '我' }}</span><time>{{ formatTime(message.createdAt) }}</time></div>
            <div class="message-bubble" :class="{ 'is-pending': message.status === 'sending', 'is-error': message.status === 'error' }">
              <span v-if="message.content" class="message-content"><template v-for="(segment, index) in splitMessage(message.content)" :key="index"><a v-if="segment.url" :href="segment.url" target="_blank" rel="noopener noreferrer">{{ segment.text }}</a><template v-else>{{ segment.text }}</template></template></span>
              <span v-if="message.status === 'sending' && message.role === 'assistant'" class="typing-indicator"><i /><i /><i /> {{ message.content ? '正在生成…' : '正在整理答复…' }}</span>
              <div v-if="message.attachments?.length" class="message-files">
                <div v-for="file in message.attachments" :key="file.id" class="message-file">
                  <button class="message-file-main" :aria-label="`预览${file.name}`" @click="preview(file, message.role === 'assistant')">
                    <span v-if="isImage(file) && fileUrl(file)" class="file-thumb"><img :src="fileUrl(file)" :alt="file.name" @error="markFileExpired(file)" /></span>
                    <span v-else class="file-kind">{{ expiredFiles.has(file.id) ? '!' : isVideo(file) ? '▶' : '▤' }}</span>
                    <span class="file-copy"><strong>{{ file.name }}</strong><small>{{ expiredFiles.has(file.id) ? '已失效' : downloadErrors.has(file.id) ? '下载失败' : downloadProgress[file.id] !== undefined ? `下载 ${downloadProgress[file.id]}%` : formatSize(file.size) }}</small></span>
                    <el-icon><ArrowRight /></el-icon>
                  </button>
                  <button v-if="message.role === 'assistant'" class="message-file-download" :aria-label="`下载${file.name}`" title="下载文件" @click="downloadFile(file)"><el-icon><Download /></el-icon></button>
                </div>
              </div>
            </div>
            <div class="message-actions">
              <button v-if="message.content && message.status !== 'sending'" :aria-label="`复制${message.role === 'user' ? '我的消息' : '助手回复'}`" title="复制" @click="copyText(message.content)"><el-icon><CopyDocument /></el-icon></button>
              <template v-if="message.role === 'assistant' && message.status !== 'sending'">
                <button v-if="mode === 'ai'" aria-label="重新生成回复" title="重新生成" @click="retryMessage(message)"><el-icon><RefreshRight /></el-icon></button>
                <button :class="{ active: feedback[message.id] === 'like' }" aria-label="赞同这条回复" title="赞同" @click="setFeedback(message.id, 'like')">👍</button>
                <button :class="{ active: feedback[message.id] === 'dislike' }" aria-label="不赞同这条回复" title="不赞同" @click="setFeedback(message.id, 'dislike')">👎</button>
              </template>
              <button v-if="message.status === 'error'" class="retry-label" @click="retryMessage(message)">重试</button>
            </div>
          </div>
          <span v-if="message.role === 'user'" class="user-avatar">我</span>
        </div>
      </main>

      <footer class="composer">
        <div class="mode-switch" aria-label="服务方式">
          <button :class="{ selected: mode === 'ai' }" @click="switchMode('ai')">✦ AI 助手</button>
          <button :class="{ selected: mode === 'human' }" @click="switchMode('human')">◉ 人工答疑</button>
          <span class="composer-tip">{{ mode === 'ai' ? 'Enter 发送 · Shift + Enter 换行' : '人工客服将在服务时间回复' }}</span>
        </div>
        <AttachmentPicker ref="pickerRef" v-model="draftFiles" :cloud-files="options.cloudFiles" :max-files="Math.min(options.maxFiles || 10, 10)" :on-upload="options.onUpload" @preview="preview" @notify="notify" />
        <div class="sender-wrap">
          <XSender ref="senderRef" variant="updown" device="auto" submit-type="enter" :disabled="activeAiPending" :placeholder="mode === 'ai' ? '请输入您的问题，也可以上传文件…' : '请描述您的问题，人工客服会尽快回复…'" @submit="sendMessage">
            <template #prefix>
              <button class="attach-button" aria-label="添加附件" title="添加附件" @click="pickerRef?.open()"><el-icon><Paperclip /></el-icon><span>添加文件</span></button>
            </template>
            <template #action-list>
              <button v-if="activeAiPending" class="send-button stop-button" aria-label="停止生成" @click="stopResponse"><span class="stop-square" />停止</button>
              <button v-else class="send-button" aria-label="发送消息" @click="sendMessage"><el-icon><Promotion /></el-icon><span>发送</span></button>
            </template>
          </XSender>
        </div>
        <p class="composer-footnote">{{ mode === 'ai' ? 'AI 生成内容可能有误，请核实重要信息。' : '请勿发送账号密码等敏感信息。' }}</p>
      </footer>
      <div v-if="toast" class="toast" role="status">{{ toast }}</div>
    </section>

    <div v-if="previewFile" class="preview-overlay" role="dialog" aria-modal="true" :aria-label="`预览${previewFile.name}`" @click.self="previewFile = null">
      <div class="preview-card">
        <div class="preview-bar"><strong>{{ previewFile.name }}</strong><button class="icon-button" aria-label="关闭预览" @click="previewFile = null"><el-icon><Close /></el-icon></button></div>
        <img v-if="previewKind(previewFile) === 'image' && !expiredFiles.has(previewFile.id)" :src="previewFile.previewUrl || fileUrl(previewFile)" :alt="previewFile.name" @error="markFileExpired(previewFile)" />
        <video v-else-if="previewKind(previewFile) === 'video' && !expiredFiles.has(previewFile.id)" controls :src="previewFile.previewUrl || fileUrl(previewFile)" @error="markFileExpired(previewFile)">您的浏览器无法播放此视频。</video>
        <SpreadsheetPreview v-else-if="previewKind(previewFile) === 'spreadsheet'" :source="previewSource(previewFile)" :filename="previewFile.name" />
        <ModelPreview v-else-if="previewKind(previewFile) === 'model'" :source="previewSource(previewFile)" :filename="previewFile.name" />
        <iframe v-else-if="previewKind(previewFile) === 'iframe' && !expiredFiles.has(previewFile.id)" :src="previewFile.previewUrl || fileUrl(previewFile)" :title="previewFile.name" />
        <div v-else class="preview-fallback"><strong>{{ expiredFiles.has(previewFile.id) ? '文件已失效' : '此格式需业务系统提供预览地址' }}</strong><span>{{ previewFile.name }} · {{ formatSize(previewFile.size) }}</span></div>
        <button v-if="previewDownloadAllowed" class="preview-download" @click="downloadFile(previewFile)"><el-icon><Download /></el-icon> 下载文件</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; }
.kefu-root { --ink:#203046; --muted:#65758a; --orange:#bd4c12; --orange-soft:#fff1e7; --line:#e5eaf0; --blue:#305db9; font-family: Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif; color:var(--ink); font-size:13px; }
button { font:inherit; cursor:pointer; }
button:focus-visible, input:focus-visible { outline:2px solid var(--orange); outline-offset:2px; }
.kefu-panel { position:fixed; z-index:2147483000; right:24px; bottom:22px; display:flex; flex-direction:column; width:min(var(--panel-width), calc(100vw - 32px)); height:min(704px, calc(100dvh - 44px)); min-width:0; overflow:hidden; background:#fff; border:1px solid #dce3ea; border-radius:16px; box-shadow:0 18px 60px rgba(27,44,65,.2), 0 3px 14px rgba(27,44,65,.08); }
.kefu-panel--expanded { width:min(660px, calc(100vw - 32px)); height:min(860px, calc(100dvh - 32px)); }
.resize-handle { position:absolute; z-index:5; left:0; top:80px; bottom:110px; width:7px; cursor:ew-resize; }
.resize-handle:hover { background:#fce2d1; }
.panel-header { display:flex; align-items:center; gap:10px; min-height:66px; padding:11px 14px; background:linear-gradient(180deg,#f9fbfd,#f2f6fa); border-bottom:1px solid var(--line); }
.robot-face { position:relative; display:grid; flex:0 0 auto; place-items:center; width:38px; height:38px; border:3px solid #384961; border-radius:50%; background:#fff; box-shadow:inset 0 -3px 0 #dce8ef; }
.robot-face::before { content:''; position:absolute; top:-5px; left:50%; width:5px; height:6px; border-radius:4px 4px 0 0; background:#384961; transform:translateX(-50%); }
.robot-face::after { content:''; position:absolute; right:-1px; bottom:0; width:8px; height:8px; border:2px solid #fff; border-radius:50%; background:#ef7629; }
.robot-eyes { display:flex; justify-content:space-evenly; align-items:center; width:25px; height:17px; border-radius:8px; background:#25374e; }
.robot-eyes i { width:4px; height:5px; border-radius:50%; background:#b4ebff; }
.panel-heading { display:flex; flex:1; flex-direction:column; gap:1px; min-width:0; }
.panel-heading strong { font-size:16px; line-height:22px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.panel-heading span { color:var(--muted); font-size:11px; line-height:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.header-actions { display:flex; gap:2px; }
.icon-button { display:grid; place-items:center; width:30px; height:30px; padding:0; color:#647386; background:transparent; border:0; border-radius:7px; }
.icon-button:hover { color:var(--orange); background:#fff; }
.panel-toolbar { display:flex; align-items:stretch; flex:0 0 46px; padding:0 8px; border-bottom:1px solid var(--line); }
.toolbar-button { display:flex; align-items:center; justify-content:center; gap:6px; min-width:94px; padding:0 9px; color:var(--orange); background:transparent; border:0; border-bottom:2px solid transparent; font-weight:600; }
.toolbar-button:hover, .toolbar-button.active { background:#fff8f3; border-bottom-color:var(--orange); }
.toolbar-button .el-icon { font-size:16px; }
.toolbar-spacer { flex:1; }
.toolbar-feedback { width:32px; padding:0; background:transparent; border:0; border-radius:6px; filter:grayscale(.25); }
.toolbar-feedback:hover, .toolbar-feedback.active { background:var(--orange-soft); filter:none; }
.mode-info { display:flex; align-items:center; gap:7px; flex:0 0 auto; min-height:30px; padding:6px 16px; color:#5f6d7c; background:#fbfcfd; border-bottom:1px solid #f0f2f5; font-size:11px; line-height:16px; }
.mode-info-icon { color:var(--blue); font-size:15px; }
.messages { flex:1; min-height:0; overflow:auto; padding:18px 15px 22px; overscroll-behavior:contain; scrollbar-color:#cdd6df transparent; }
.welcome-state { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100%; padding:30px 14px; text-align:center; }
.robot-face--welcome { width:56px; height:56px; margin-bottom:17px; border-width:4px; box-shadow:0 9px 22px rgba(33,58,85,.12); }
.robot-face--welcome .robot-eyes { width:36px; height:23px; }
.robot-face--welcome .robot-eyes i { width:5px; height:7px; }
.welcome-state strong { font-size:18px; line-height:27px; }
.welcome-state p { margin:8px 0 18px; color:var(--muted); line-height:20px; }
.welcome-suggestions button { display:flex; align-items:center; gap:5px; padding:8px 12px; color:var(--orange); background:#fff; border:1px solid #f0c8b4; border-radius:18px; }
.welcome-suggestions button:hover { background:var(--orange-soft); }
.message-row { display:flex; align-items:flex-start; gap:7px; margin-bottom:19px; }
.message-row.user { justify-content:flex-end; }
.robot-face--message { width:27px; height:27px; border-width:2px; }
.robot-face--message::before { width:4px; height:5px; top:-4px; }
.robot-face--message::after { width:6px; height:6px; }
.robot-face--message .robot-eyes { width:18px; height:12px; }
.robot-face--message .robot-eyes i { width:3px; height:4px; }
.user-avatar { display:grid; place-items:center; flex:0 0 27px; width:27px; height:27px; color:#fff; background:#3e61ad; border-radius:50%; font-size:11px; font-weight:700; }
.message-stack { display:flex; flex-direction:column; align-items:flex-start; min-width:0; max-width:calc(100% - 35px); }
.message-row.user .message-stack { align-items:flex-end; }
.message-meta { display:flex; gap:7px; align-items:center; margin-bottom:5px; color:#5d6d81; font-size:10px; line-height:15px; }
.message-bubble { max-width:100%; min-width:52px; padding:10px 11px; background:#f5f7fa; border:1px solid #e8edf2; border-radius:4px 12px 12px 12px; line-height:20px; overflow-wrap:anywhere; }
.message-row.user .message-bubble { color:#fff; background:var(--orange); border-color:var(--orange); border-radius:12px 4px 12px 12px; }
.message-bubble.is-error { border-color:#e8b5a3; }
.message-content { white-space:pre-wrap; }
.message-content a { color:#2858ba; text-decoration:underline; text-underline-offset:2px; overflow-wrap:anywhere; }
.message-row.user .message-content a { color:#fff; }
.typing-indicator { display:flex; align-items:center; gap:4px; color:var(--muted); }
.typing-indicator i { width:4px; height:4px; background:var(--orange); border-radius:50%; animation:typing 1s infinite alternate; }
.typing-indicator i:nth-child(2) { animation-delay:.2s; }.typing-indicator i:nth-child(3) { animation-delay:.4s; margin-right:4px; }
.message-files { display:flex; flex-direction:column; gap:6px; margin-top:7px; max-width:100%; }
.message-content + .message-files { padding-top:8px; border-top:1px solid rgba(127,144,160,.2); }
.message-file { display:flex; align-items:center; width:100%; min-width:0; max-width:260px; color:var(--ink); text-align:left; background:#fff; border:1px solid #e0e7ee; border-radius:9px; overflow:hidden; }
.message-file:hover { border-color:#dc9f7f; }
.message-file-main { display:flex; align-items:center; gap:7px; flex:1; min-width:0; padding:6px; color:inherit; text-align:left; background:transparent; border:0; }
.message-file-download { display:grid; place-items:center; flex:0 0 30px; width:30px; align-self:stretch; padding:0; color:#5d6d81; background:#f7f9fb; border:0; border-left:1px solid #e0e7ee; }
.message-file-download:hover { color:var(--orange); background:var(--orange-soft); }
.file-kind, .file-thumb { display:grid; place-items:center; flex:0 0 34px; width:34px; height:34px; color:var(--blue); background:#eaf1ff; border-radius:6px; font-size:18px; overflow:hidden; }
.file-thumb img { width:100%; height:100%; object-fit:cover; }
.file-copy { display:flex; flex:1; flex-direction:column; min-width:0; }
.file-copy strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; font-weight:600; }
.file-copy small { color:var(--muted); font-size:10px; }
.message-file-main > .el-icon { color:#5d6d81; }
.message-actions { display:flex; align-items:center; gap:2px; min-height:24px; margin-top:3px; }
.message-actions button { display:grid; place-items:center; min-width:25px; height:23px; padding:0 4px; color:#5d6d81; background:transparent; border:0; border-radius:5px; font-size:11px; }
.message-actions button:hover, .message-actions button.active { color:var(--orange); background:var(--orange-soft); }
.message-actions .retry-label { padding:0 7px; color:var(--orange); }
.composer { flex:0 0 auto; padding:10px 12px max(10px, env(safe-area-inset-bottom)); background:#fff; border-top:1px solid var(--line); box-shadow:0 -5px 18px rgba(30,48,70,.035); }
.mode-switch { display:flex; align-items:center; gap:6px; min-width:0; margin-bottom:8px; }
.mode-switch button { padding:5px 10px; color:#5d6c7b; background:#f5f7fa; border:1px solid transparent; border-radius:14px; font-size:11px; font-weight:600; white-space:nowrap; }
.mode-switch button.selected { color:var(--orange); background:var(--orange-soft); border-color:#f2ccbb; }
.mode-switch button:nth-child(2).selected { color:var(--blue); background:#eaf1ff; border-color:#cddcfb; }
.composer-tip { flex:1; min-width:0; overflow:hidden; text-align:right; text-overflow:ellipsis; white-space:nowrap; color:#5d6d81; font-size:10px; }
.sender-wrap { border:1px solid #dde4eb; border-radius:12px; overflow:hidden; }
.sender-wrap:focus-within { border-color:var(--orange); box-shadow:0 0 0 2px #fce6d9; }
.sender-wrap :deep(.elx-sender), .sender-wrap :deep(.x-sender) { border:0; box-shadow:none; }
.attach-button { display:flex; align-items:center; gap:5px; padding:5px 6px; color:#687789; background:transparent; border:0; border-radius:6px; font-size:11px; }
.attach-button:hover { color:var(--orange); background:var(--orange-soft); }
.attach-button .el-icon { font-size:16px; }
.send-button { display:flex; align-items:center; justify-content:center; gap:6px; min-width:66px; height:30px; margin:0 2px 1px 0; padding:0 10px; color:#fff; background:var(--orange); border:0; border-radius:8px; font-size:12px; font-weight:600; }
.send-button:hover { background:#a8410d; }
.stop-button { background:#345dc9; }.stop-button:hover { background:#244cae; }
.stop-square { width:10px; height:10px; background:#fff; border-radius:2px; }
.composer-footnote { margin:7px 0 0; color:#5d6d81; text-align:center; font-size:10px; line-height:15px; }
.history-layer { position:absolute; z-index:10; left:8px; top:111px; width:min(330px, calc(100% - 16px)); max-height:calc(100% - 190px); overflow:hidden; background:#fff; border:1px solid #dfe5eb; border-radius:10px; box-shadow:0 12px 35px rgba(23,42,64,.2); }
.history-heading { display:flex; align-items:center; justify-content:space-between; padding:9px 12px; border-bottom:1px solid var(--line); font-size:13px; }
.history-scroll { max-height: min(430px, calc(100dvh - 260px)); overflow:auto; padding:7px; }
.history-group + .history-group { margin-top:6px; }
.history-group-title { display:flex; align-items:center; gap:5px; width:100%; height:30px; padding:0 9px; color:#516175; background:#f1f4f7; border:0; border-radius:5px; text-align:left; font-weight:600; }
.history-group-title .el-icon { font-size:12px; }
.history-row { display:flex; align-items:center; gap:3px; min-height:37px; padding:3px 4px; border-bottom:1px solid #f1f3f5; border-radius:5px; }
.history-row.selected { background:#fff3eb; }
.history-select { display:flex; align-items:center; gap:5px; flex:1; min-width:0; padding:3px 4px; color:var(--ink); background:transparent; border:0; text-align:left; }
.history-select span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.unread-dot { flex:0 0 6px; width:6px; height:6px; background:#f17827; border-radius:50%; }
.mode-tag { min-width:26px; padding:2px 4px; text-align:center; border-radius:5px; font-size:10px; }
.mode-tag.ai { color:var(--blue); background:#e9f0ff; }.mode-tag.human { color:var(--orange); background:var(--orange-soft); }
.row-icon { display:grid; place-items:center; flex:0 0 22px; width:22px; height:23px; padding:0; color:#7d8996; background:transparent; border:0; border-radius:4px; }
.row-icon:hover { color:var(--orange); background:#fff; }
.rename-input { flex:1; min-width:0; height:26px; padding:2px 6px; border:1px solid var(--orange); border-radius:4px; }
.delete-question { flex:1; color:#a7481d; font-size:11px; }.delete-yes,.delete-no { padding:3px 5px; background:transparent; border:0; font-size:11px; }.delete-yes { color:#b84219; }.delete-no { color:var(--muted); }
.toast { position:absolute; z-index:20; left:50%; bottom:175px; max-width:calc(100% - 32px); padding:8px 12px; color:#fff; background:rgba(35,48,63,.92); border-radius:7px; line-height:18px; text-align:center; transform:translateX(-50%); box-shadow:0 5px 18px rgba(22,35,49,.18); }
.kefu-launcher { position:fixed; z-index:2147483000; right:24px; bottom:22px; display:flex; align-items:center; gap:9px; padding:9px 14px 9px 9px; color:#fff; background:var(--orange); border:0; border-radius:28px; box-shadow:0 10px 28px rgba(115,53,19,.25); font-weight:700; }
.robot-face--launcher { width:30px; height:30px; border-width:2px; }.robot-face--launcher .robot-eyes { width:20px; height:13px; }
.preview-overlay { position:fixed; z-index:2147483200; inset:0; display:grid; place-items:center; padding:16px; background:rgba(22,33,47,.75); }
.preview-card { display:flex; flex-direction:column; width:min(800px, 100%); max-height:calc(100dvh - 32px); overflow:hidden; background:#fff; border-radius:12px; }
.preview-bar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 14px; border-bottom:1px solid var(--line); }
.preview-bar strong { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.preview-card img, .preview-card video { display:block; max-width:100%; max-height:calc(100dvh - 150px); margin:auto; object-fit:contain; }
.preview-card iframe { display:block; width:100%; height:min(70dvh, 650px); border:0; }
.preview-fallback { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; min-height:180px; padding:24px; color:var(--muted); text-align:center; }
.preview-fallback strong { color:var(--ink); font-size:15px; }
.preview-download { display:flex; align-items:center; justify-content:center; gap:6px; margin:10px auto 14px; padding:7px 13px; color:#fff; background:var(--orange); border:0; border-radius:7px; }
@keyframes typing { to { opacity:.25; transform:translateY(-3px); } }
@media (max-width:600px) {
  .kefu-panel,.kefu-panel--expanded { inset:0; width:100%; height:100dvh; max-height:none; border:0; border-radius:0; box-shadow:none; }
  .resize-handle { display:none; }
  .panel-header { min-height:58px; padding:7px 12px; }
  .panel-toolbar { flex-basis:44px; }
  .toolbar-button { min-width:88px; }
  .history-layer { top:101px; left:8px; width:calc(100% - 16px); max-height:calc(100% - 180px); }
  .history-scroll { max-height:calc(100dvh - 225px); }
  .messages { padding:15px 12px; }
  .composer { padding:8px 10px max(8px, env(safe-area-inset-bottom)); }
  .composer-tip { display:none; }
  .kefu-launcher { right:16px; bottom:max(16px, env(safe-area-inset-bottom)); }
}
@media (max-width:370px) { .panel-heading span { display:none; }.mode-switch button { padding:5px 8px; }.toolbar-button { min-width:82px; } }
@media (prefers-reduced-motion:reduce) { .typing-indicator i { animation:none; } }
</style>
