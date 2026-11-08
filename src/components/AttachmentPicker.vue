<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElButton, ElDialog, ElIcon, ElProgress } from 'element-plus'
import {
  ArrowLeft,
  ArrowRight,
  Close,
  Document,
  FolderOpened,
  RefreshRight,
  UploadFilled,
  WarningFilled,
} from '@element-plus/icons-vue'
import type { CloudFile, WidgetAttachment, WidgetOptions } from '../types'
import {
  ATTACHMENT_ACCEPT,
  DEFAULT_MAX_FILES,
  formatFileSize,
  getExtension,
  isImageAttachment,
  validateAttachment,
} from '../utils/attachmentRules'

const props = withDefaults(
  defineProps<{
    modelValue: WidgetAttachment[]
    cloudFiles?: CloudFile[]
    maxFiles?: number
    onUpload?: WidgetOptions['onUpload']
  }>(),
  { cloudFiles: () => [], maxFiles: DEFAULT_MAX_FILES },
)

const emit = defineEmits<{
  'update:modelValue': [attachments: WidgetAttachment[]]
  preview: [attachment: WidgetAttachment]
  notify: [message: string]
}>()

const items = ref<WidgetAttachment[]>([])
const dialogVisible = ref(false)
const activeTab = ref<'local' | 'cloud'>('local')
const draftFiles = ref<File[]>([])
const selectedCloudIds = ref<string[]>([])
const cloudPath = ref<CloudFile[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const stripRef = ref<HTMLElement | null>(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)
const hasOverflow = ref(false)
const previewUrls = ref<Record<string, string>>({})
const controllers = new Map<string, AbortController>()
let resizeObserver: ResizeObserver | undefined
let localId = 0

const maxCount = computed(() => Math.min(DEFAULT_MAX_FILES, Math.max(1, Math.floor(props.maxFiles))))
const selectedCount = computed(() => draftFiles.value.length + selectedCloudIds.value.length)
const totalAfterSelection = computed(() => items.value.length + selectedCount.value)
const hasHierarchy = computed(() => props.cloudFiles.some((file) => file.parentId != null))
const currentFolderId = computed(() => cloudPath.value.at(-1)?.id ?? null)
const cloudRows = computed(() => {
  if (!hasHierarchy.value && currentFolderId.value === null) return props.cloudFiles
  return props.cloudFiles.filter((file) => (file.parentId ?? null) === currentFolderId.value)
})

watch(
  () => props.modelValue,
  (value) => {
    const next = [...value]
    const nextIds = new Set(next.map((item) => item.id))
    for (const [id, controller] of controllers) {
      if (!nextIds.has(id)) {
        controller.abort()
        controllers.delete(id)
      }
    }
    items.value = next
    updatePreviewUrls()
    void nextTick(updateScrollControls)
  },
  { immediate: true },
)

watch(items, () => {
  updatePreviewUrls()
  void nextTick(updateScrollControls)
})

watch(stripRef, (element, oldElement) => {
  if (oldElement) resizeObserver?.unobserve(oldElement)
  if (element) resizeObserver?.observe(element)
  void nextTick(updateScrollControls)
})

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(updateScrollControls)
    if (stripRef.value) resizeObserver.observe(stripRef.value)
  }
  window.addEventListener('resize', updateScrollControls)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', updateScrollControls)
  for (const controller of controllers.values()) controller.abort()
  controllers.clear()
  for (const url of Object.values(previewUrls.value)) URL.revokeObjectURL(url)
})

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  localId += 1
  return `attachment-${Date.now()}-${localId}`
}

function setItems(next: WidgetAttachment[]) {
  items.value = next
  emit('update:modelValue', next)
}

function updateItem(id: string, patch: Partial<WidgetAttachment>) {
  if (!items.value.some((item) => item.id === id)) return
  setItems(items.value.map((item) => (item.id === id ? { ...item, ...patch } : item)))
}

function updatePreviewUrls() {
  const activeIds = new Set(items.value.filter((item) => item.file && isImageAttachment(item.name)).map((item) => item.id))
  for (const [id, url] of Object.entries(previewUrls.value)) {
    if (!activeIds.has(id)) {
      URL.revokeObjectURL(url)
      delete previewUrls.value[id]
    }
  }
  for (const item of items.value) {
    if (item.file && isImageAttachment(item.name) && !previewUrls.value[item.id]) {
      previewUrls.value[item.id] = URL.createObjectURL(item.file)
    }
  }
}

function previewUrl(item: WidgetAttachment): string | undefined {
  return item.url || previewUrls.value[item.id]
}

function sizeLabel(item: WidgetAttachment): string {
  if (item.id.startsWith('cloud:') && item.size === 0) return '大小未知'
  return formatFileSize(item.size)
}

function updateScrollControls() {
  const strip = stripRef.value
  if (!strip) {
    hasOverflow.value = false
    canScrollLeft.value = false
    canScrollRight.value = false
    return
  }
  hasOverflow.value = strip.scrollWidth > strip.clientWidth + 2
  canScrollLeft.value = strip.scrollLeft > 2
  canScrollRight.value = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2
}

function scrollStrip(direction: -1 | 1) {
  const strip = stripRef.value
  if (!strip) return
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  strip.scrollBy({ left: direction * Math.max(180, strip.clientWidth * 0.7), behavior: reducedMotion ? 'instant' : 'smooth' })
}

function open() {
  activeTab.value = 'local'
  draftFiles.value = []
  selectedCloudIds.value = []
  cloudPath.value = []
  dialogVisible.value = true
}

function close() {
  dialogVisible.value = false
}

function triggerFilePicker() {
  fileInput.value?.click()
}

function stageFiles(files: FileList | File[]) {
  for (const file of Array.from(files)) {
    const error = validateAttachment(file.name, file.size)
    if (error) {
      emit('notify', error)
      continue
    }
    if (items.value.length + draftFiles.value.length + selectedCloudIds.value.length >= maxCount.value) {
      emit('notify', `每次最多添加 ${maxCount.value} 个文件，请先移除部分附件。`)
      break
    }
    if (draftFiles.value.some((draft) => draft.name === file.name && draft.size === file.size && draft.lastModified === file.lastModified)) {
      emit('notify', `“${file.name}”已在待添加列表中。`)
      continue
    }
    draftFiles.value = [...draftFiles.value, file]
  }
}

function onFileInput(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files) stageFiles(input.files)
  input.value = ''
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer?.files) stageFiles(event.dataTransfer.files)
}

function removeDraft(index: number) {
  draftFiles.value = draftFiles.value.filter((_, current) => current !== index)
}

function isFolder(file: CloudFile): boolean {
  return file.isFolder === true || file.type === 'folder'
}

function enterFolder(folder: CloudFile) {
  cloudPath.value = [...cloudPath.value, folder]
}

function goToFolder(index: number) {
  cloudPath.value = index < 0 ? [] : cloudPath.value.slice(0, index + 1)
}

function toggleCloud(file: CloudFile) {
  if (isFolder(file)) return
  if (selectedCloudIds.value.includes(file.id)) {
    selectedCloudIds.value = selectedCloudIds.value.filter((id) => id !== file.id)
    return
  }
  const error = validateAttachment(file.name, file.size)
  if (error) {
    emit('notify', error)
    return
  }
  if (totalAfterSelection.value >= maxCount.value) {
    emit('notify', `每次最多添加 ${maxCount.value} 个文件，请先移除部分附件。`)
    return
  }
  if (items.value.some((item) => item.id === `cloud:${file.id}`)) {
    emit('notify', `“${file.name}”已添加。`)
    return
  }
  selectedCloudIds.value = [...selectedCloudIds.value, file.id]
}

function commitFiles(localFiles: File[], cloudFiles: CloudFile[]) {
  const next = [...items.value]
  const localItems: WidgetAttachment[] = []
  let skipped = 0

  for (const file of localFiles) {
    const error = validateAttachment(file.name, file.size)
    if (error) {
      emit('notify', error)
      continue
    }
    if (next.length >= maxCount.value) {
      skipped += 1
      continue
    }
    const attachment: WidgetAttachment = {
      id: makeId(),
      name: file.name,
      size: file.size,
      type: file.type || getExtension(file.name),
      file,
      status: 'ready',
      progress: 0,
    }
    next.push(attachment)
    localItems.push(attachment)
  }

  for (const file of cloudFiles) {
    const error = validateAttachment(file.name, file.size)
    if (error) {
      emit('notify', error)
      continue
    }
    if (next.length >= maxCount.value) {
      skipped += 1
      continue
    }
    if (next.some((item) => item.id === `cloud:${file.id}`)) continue
    next.push({
      id: `cloud:${file.id}`,
      name: file.name,
      size: file.size ?? 0,
      type: file.type || getExtension(file.name),
      url: file.url,
      previewUrl: file.previewUrl,
      previewKind: file.previewKind,
      status: 'done',
      progress: 100,
    })
  }

  if (skipped) emit('notify', `最多添加 ${maxCount.value} 个文件，${skipped} 个文件未添加。`)
  if (next.length === items.value.length) return
  setItems(next)
  for (const item of localItems) void startUpload(item)
}

function addFiles(files: FileList | File[]) {
  commitFiles(Array.from(files), [])
}

function confirmSelection() {
  const selected = props.cloudFiles.filter((file) => selectedCloudIds.value.includes(file.id) && !isFolder(file))
  commitFiles(draftFiles.value, selected)
  close()
}

async function startUpload(item: WidgetAttachment) {
  if (!item.file || !props.onUpload) return
  controllers.get(item.id)?.abort()
  const controller = new AbortController()
  controllers.set(item.id, controller)
  updateItem(item.id, { status: 'uploading', progress: 0, error: undefined })

  try {
    const result = await props.onUpload(item.file, (percent) => {
      if (!controller.signal.aborted) {
        updateItem(item.id, { progress: Math.max(0, Math.min(100, Math.round(percent))) })
      }
    }, controller.signal)
    if (controller.signal.aborted || !items.value.some((current) => current.id === item.id)) return
    updateItem(item.id, {
      ...(result || {}),
      id: item.id,
      file: item.file,
      status: 'done',
      progress: 100,
      error: undefined,
    })
  } catch (error) {
    if (controller.signal.aborted || !items.value.some((current) => current.id === item.id)) return
    updateItem(item.id, {
      status: 'error',
      error: error instanceof Error ? error.message : '上传失败',
    })
    emit('notify', `“${item.name}”上传失败，可点击重试。`)
  } finally {
    if (controllers.get(item.id) === controller) controllers.delete(item.id)
  }
}

function cancelUpload(item: WidgetAttachment) {
  removeItem(item)
}

function removeItem(item: WidgetAttachment) {
  controllers.get(item.id)?.abort()
  controllers.delete(item.id)
  setItems(items.value.filter((current) => current.id !== item.id))
}

function retryUpload(item: WidgetAttachment) {
  void startUpload(item)
}

defineExpose({ open, addFiles })
</script>

<template>
  <div class="kefu-attachments">
    <div v-if="items.length" class="kefu-attachment-strip" aria-label="已添加附件">
      <button
        v-if="hasOverflow"
        class="kefu-attachment-strip__arrow"
        type="button"
        aria-label="向左查看附件"
        :disabled="!canScrollLeft"
        @click="scrollStrip(-1)"
      >
        <ElIcon><ArrowLeft /></ElIcon>
      </button>

      <div ref="stripRef" class="kefu-attachment-strip__viewport" @scroll="updateScrollControls">
        <div class="kefu-attachment-strip__track">
          <div
            v-for="item in items"
            :key="item.id"
            class="kefu-attachment-card"
            :class="{ 'is-error': item.status === 'error', 'is-uploading': item.status === 'uploading' }"
          >
            <button
              v-if="isImageAttachment(item.name) && previewUrl(item) && item.status !== 'error'"
              class="kefu-attachment-card__preview"
              type="button"
              :aria-label="`预览 ${item.name}`"
              @click="emit('preview', item)"
            >
              <img :src="previewUrl(item)" alt="" />
            </button>
            <button v-else-if="item.status !== 'error'" class="kefu-attachment-card__preview" type="button" :aria-label="`预览 ${item.name}`" @click="emit('preview', item)">
              <ElIcon><Document /></ElIcon>
            </button>
            <span v-else class="kefu-attachment-card__icon" aria-hidden="true"><ElIcon><WarningFilled /></ElIcon></span>

            <span class="kefu-attachment-card__details">
              <span class="kefu-attachment-card__name" :title="item.name">{{ item.name }}</span>
              <span class="kefu-attachment-card__status">
                <template v-if="item.status === 'uploading'">上传中 {{ item.progress ?? 0 }}%</template>
                <template v-else-if="item.status === 'error'">上传失败</template>
                <template v-else-if="item.status === 'ready'">待发送 · {{ sizeLabel(item) }}</template>
                <template v-else>{{ sizeLabel(item) }}</template>
              </span>
              <ElProgress
                v-if="item.status === 'uploading'"
                :percentage="item.progress ?? 0"
                :show-text="false"
                :stroke-width="3"
                color="#ff6b19"
                class="kefu-attachment-card__progress"
              />
            </span>

            <button
              v-if="item.status === 'error' && item.file && onUpload"
              class="kefu-attachment-card__action"
              type="button"
              :aria-label="`重新上传 ${item.name}`"
              title="重新上传"
              @click="retryUpload(item)"
            >
              <ElIcon><RefreshRight /></ElIcon>
            </button>
            <button
              class="kefu-attachment-card__action"
              type="button"
              :aria-label="`${item.status === 'uploading' ? '取消上传' : '移除'} ${item.name}`"
              :title="item.status === 'uploading' ? '取消上传' : '移除附件'"
              @click="item.status === 'uploading' ? cancelUpload(item) : removeItem(item)"
            >
              <ElIcon><Close /></ElIcon>
            </button>
          </div>
        </div>
      </div>

      <button
        v-if="hasOverflow"
        class="kefu-attachment-strip__arrow"
        type="button"
        aria-label="向右查看附件"
        :disabled="!canScrollRight"
        @click="scrollStrip(1)"
      >
        <ElIcon><ArrowRight /></ElIcon>
      </button>
    </div>

    <ElDialog
      v-model="dialogVisible"
      class="kefu-attachment-dialog"
      :show-close="false"
      :close-on-click-modal="false"
      :append-to-body="true"
      :z-index="2147483100"
      width="440px"
      align-center
    >
      <template #header>
        <div class="kefu-attachment-dialog__header">
          <div class="kefu-attachment-dialog__tabs" role="tablist" aria-label="文件来源">
            <button
              type="button"
              role="tab"
              :aria-selected="activeTab === 'local'"
              class="kefu-attachment-dialog__tab"
              :class="{ 'is-active': activeTab === 'local' }"
              @click="activeTab = 'local'"
            >本地导入</button>
            <button
              type="button"
              role="tab"
              :aria-selected="activeTab === 'cloud'"
              class="kefu-attachment-dialog__tab"
              :class="{ 'is-active': activeTab === 'cloud' }"
              @click="activeTab = 'cloud'"
            >云端导入</button>
          </div>
          <button type="button" class="kefu-attachment-dialog__close" aria-label="关闭附件窗口" @click="close">
            <ElIcon><Close /></ElIcon>
          </button>
        </div>
      </template>

      <section v-if="activeTab === 'local'" class="kefu-attachment-dialog__local" aria-label="本地导入">
        <div
          class="kefu-attachment-dialog__dropzone"
          role="button"
          tabindex="0"
          aria-label="选择本地文件，也可以拖拽文件到此处"
          @click="triggerFilePicker"
          @keydown.enter.prevent="triggerFilePicker"
          @keydown.space.prevent="triggerFilePicker"
          @dragover.prevent
          @drop="onDrop"
        >
          <input ref="fileInput" class="kefu-attachment-dialog__file-input" type="file" multiple :accept="ATTACHMENT_ACCEPT" @change="onFileInput" />
          <ElIcon class="kefu-attachment-dialog__upload-icon"><UploadFilled /></ElIcon>
          <span>拖拽文件至此处 或 <strong>点击上传</strong></span>
          <small>每次最多上传 {{ maxCount }} 个文件</small>
        </div>

        <div class="kefu-attachment-dialog__rules">
          <p>支持 stp、step、igs、iges、yjwl、ply、obj、glb、3mf（小于 500 MB）</p>
          <p>stl 小于 400 MB；csv、xls、xlsx 小于 20 MB</p>
          <p>png、jpg、jpeg、gif、mp4 小于 20 MB</p>
        </div>

        <ul v-if="draftFiles.length" class="kefu-attachment-dialog__drafts" aria-label="待添加文件">
          <li v-for="(file, index) in draftFiles" :key="`${file.name}-${file.lastModified}-${index}`">
            <ElIcon><Document /></ElIcon>
            <span :title="file.name">{{ file.name }}</span>
            <small>{{ formatFileSize(file.size) }}</small>
            <button type="button" :aria-label="`移除 ${file.name}`" @click="removeDraft(index)"><ElIcon><Close /></ElIcon></button>
          </li>
        </ul>
      </section>

      <section v-else class="kefu-attachment-dialog__cloud" aria-label="云端导入">
        <div class="kefu-attachment-dialog__breadcrumb">
          <span>选择文件：</span>
          <button type="button" @click="goToFolder(-1)">我的文件</button>
          <template v-for="(folder, index) in cloudPath" :key="folder.id">
            <span aria-hidden="true">/</span>
            <button type="button" @click="goToFolder(index)">{{ folder.name }}</button>
          </template>
        </div>
        <div class="kefu-attachment-dialog__cloud-list">
          <template v-if="cloudRows.length">
            <template v-for="file in cloudRows" :key="file.id">
              <button v-if="isFolder(file)" type="button" class="kefu-attachment-dialog__folder-row" @click="enterFolder(file)">
                <ElIcon><FolderOpened /></ElIcon>
                <span>{{ file.name }}</span>
                <ElIcon><ArrowRight /></ElIcon>
              </button>
              <div
                v-else
                class="kefu-attachment-dialog__file-row"
                role="checkbox"
                tabindex="0"
                :aria-checked="selectedCloudIds.includes(file.id)"
                :aria-label="`选择 ${file.name}`"
                @click="toggleCloud(file)"
                @keydown.enter.prevent="toggleCloud(file)"
                @keydown.space.prevent="toggleCloud(file)"
              >
                <span class="kefu-attachment-dialog__checkbox" :class="{ 'is-checked': selectedCloudIds.includes(file.id) }" aria-hidden="true">✓</span>
                <ElIcon><Document /></ElIcon>
                <span class="kefu-attachment-dialog__cloud-name">{{ file.name }}</span>
                <small>{{ formatFileSize(file.size) }}</small>
              </div>
            </template>
          </template>
          <p v-else class="kefu-attachment-dialog__empty">此文件夹暂无文件</p>
        </div>
      </section>

      <template #footer>
        <div class="kefu-attachment-dialog__footer">
          <span>{{ selectedCount ? `已选择 ${selectedCount} 个` : `已添加 ${items.length}/${maxCount} 个` }}</span>
          <div>
            <ElButton class="kefu-attachment-dialog__cancel" @click="close">取消</ElButton>
            <ElButton class="kefu-attachment-dialog__confirm" :disabled="!selectedCount" @click="confirmSelection">确定</ElButton>
          </div>
        </div>
      </template>
    </ElDialog>
  </div>
</template>

<style>
.kefu-attachments { min-width: 0; width: 100%; }
.kefu-attachment-strip { display: flex; align-items: center; gap: 4px; min-width: 0; width: 100%; }
.kefu-attachment-strip__viewport { flex: 1; min-width: 0; overflow-x: auto; overscroll-behavior-inline: contain; scrollbar-width: none; }
.kefu-attachment-strip__viewport::-webkit-scrollbar { display: none; }
.kefu-attachment-strip__track { display: flex; align-items: stretch; gap: 8px; width: max-content; padding: 2px 0; }
.kefu-attachment-strip__arrow { display: inline-grid; flex: none; place-items: center; width: 26px; height: 28px; border: 1px solid #e7e8eb; border-radius: 8px; color: #5e6672; background: #fff; cursor: pointer; }
.kefu-attachment-strip__arrow:disabled { opacity: .4; cursor: default; }
.kefu-attachment-card { display: flex; align-items: center; gap: 7px; width: 190px; min-width: 0; height: 58px; padding: 6px 5px 6px 7px; border: 1px solid #e5e7eb; border-radius: 10px; background: #fafafa; color: #313640; }
.kefu-attachment-card.is-error { border-color: #f6d6cc; background: #fff9f6; }
.kefu-attachment-card__preview, .kefu-attachment-card__icon { display: grid; flex: none; place-items: center; width: 42px; height: 42px; overflow: hidden; border: 0; border-radius: 7px; background: #e9eaec; color: #7d848d; padding: 0; }
.kefu-attachment-card__preview { cursor: zoom-in; }
.kefu-attachment-card__preview img { width: 100%; height: 100%; object-fit: cover; }
.kefu-attachment-card__icon .el-icon { font-size: 22px; }
.kefu-attachment-card.is-error .kefu-attachment-card__icon { color: #ea6a3d; background: #fff0e9; }
.kefu-attachment-card__details { display: flex; flex: 1; flex-direction: column; justify-content: center; min-width: 0; gap: 3px; }
.kefu-attachment-card__name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 16px; font-weight: 600; }
.kefu-attachment-card__status { color: #5d6d81; font-size: 11px; line-height: 14px; }
.kefu-attachment-card.is-error .kefu-attachment-card__status { color: #ad3e20; }
.kefu-attachment-card__progress { width: 100%; line-height: 0; }
.kefu-attachment-card__progress .el-progress-bar__outer { background: #f2dfd6; }
.kefu-attachment-card__action { display: grid; flex: none; place-items: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: #858b95; cursor: pointer; }
.kefu-attachment-card__action:hover { color: #f36b1c; background: #fff0e5; }
.kefu-attachment-card__action .el-icon { font-size: 14px; }
.kefu-attachment-dialog { --el-color-primary: #ff6b19; --el-color-primary-light-9: #fff1e7; width: min(440px, calc(100vw - 24px)) !important; height: fit-content !important; max-height: calc(100dvh - 24px); display: flex; flex-direction: column; margin: auto !important; padding: 0 !important; border: 1px solid #efefef; border-radius: 4px; overflow: hidden; }
.kefu-attachment-dialog .el-dialog__header { flex: none; margin: 0; padding: 0; }
.kefu-attachment-dialog .el-dialog__body { flex: 0 1 auto; min-height: 0; overflow-y: auto; padding: 14px 14px 8px; }
.kefu-attachment-dialog .el-dialog__footer { flex: none; padding: 6px 14px 14px; }
.kefu-attachment-dialog__header { display: flex; align-items: center; justify-content: space-between; height: 46px; background: #f7f7f7; }
.kefu-attachment-dialog__tabs { display: flex; align-self: stretch; }
.kefu-attachment-dialog__tab { min-width: 100px; padding: 0 17px; border: 0; border-right: 1px solid #f0f0f0; background: transparent; color: #526377; font-size: 13px; cursor: pointer; }
.kefu-attachment-dialog__tab.is-active { background: #fff; color: #bd4c12; font-weight: 600; }
.kefu-attachment-dialog__close { display: grid; place-items: center; width: 38px; height: 38px; margin-right: 4px; border: 0; background: transparent; color: #777; cursor: pointer; }
.kefu-attachment-dialog__dropzone { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; min-height: 122px; padding: 15px 9px; border: 1px dashed #b5bdc7; border-radius: 2px; background: #fafafa; color: #5d6d81; text-align: center; font-size: 13px; cursor: pointer; }
.kefu-attachment-dialog__dropzone:hover, .kefu-attachment-dialog__dropzone:focus-visible { border-color: #ff8a43; background: #fffaf6; }
.kefu-attachment-dialog__upload-icon { font-size: 23px; }
.kefu-attachment-dialog__dropzone strong { color: #bd4c12; font-weight: 600; }
.kefu-attachment-dialog__dropzone small { font-size: 11px; }
.kefu-attachment-dialog__file-input { display: none; }
.kefu-attachment-dialog__rules { padding: 8px 2px 0; color: #5d6d81; font-size: 10px; line-height: 1.5; }
.kefu-attachment-dialog__rules p { margin: 1px 0; }
.kefu-attachment-dialog__drafts { max-height: 115px; overflow-y: auto; list-style: none; margin: 9px 0 0; padding: 0; }
.kefu-attachment-dialog__drafts li { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 5px 3px; border-bottom: 1px solid #f2f2f2; color: #525965; font-size: 11px; }
.kefu-attachment-dialog__drafts li > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kefu-attachment-dialog__drafts li > small { flex: none; color: #5d6d81; }
.kefu-attachment-dialog__drafts button { display: grid; flex: none; place-items: center; width: 18px; height: 18px; padding: 0; border: 0; background: transparent; color: #8a8a8a; cursor: pointer; }
.kefu-attachment-dialog__cloud { min-height: 150px; }
.kefu-attachment-dialog__breadcrumb { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; margin-bottom: 9px; color: #5d6d81; font-size: 11px; }
.kefu-attachment-dialog__breadcrumb button { border: 0; padding: 0; background: transparent; color: #555c66; font: inherit; cursor: pointer; }
.kefu-attachment-dialog__breadcrumb button:hover { color: #f26717; }
.kefu-attachment-dialog__cloud-list { display: flex; flex-direction: column; gap: 5px; max-height: 230px; min-height: 90px; overflow-y: auto; }
.kefu-attachment-dialog__folder-row, .kefu-attachment-dialog__file-row { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 33px; min-width: 0; padding: 5px 9px; border: 1px solid transparent; border-radius: 3px; background: #f8f8f8; color: #545961; text-align: left; font-size: 12px; cursor: pointer; }
.kefu-attachment-dialog__folder-row:hover, .kefu-attachment-dialog__file-row:hover { border-color: #ffd1b6; background: #fffaf7; }
.kefu-attachment-dialog__folder-row .el-icon:first-child { color: #efb220; font-size: 16px; }
.kefu-attachment-dialog__folder-row span, .kefu-attachment-dialog__cloud-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kefu-attachment-dialog__folder-row .el-icon:last-child { color: #b6b9bd; }
.kefu-attachment-dialog__file-row > .el-icon { color: #8c929a; font-size: 15px; }
.kefu-attachment-dialog__file-row small { color: #5d6d81; }
.kefu-attachment-dialog__checkbox { display: grid; flex: none; place-items: center; width: 15px; height: 15px; border: 1px solid #8a97a6; border-radius: 3px; color: transparent; background: #fff; font-size: 12px; font-weight: 700; }
.kefu-attachment-dialog__checkbox.is-checked { border-color: #bd4c12; background: #bd4c12; color: #fff; }
.kefu-attachment-dialog__empty { display: grid; place-items: center; min-height: 90px; margin: 0; color: #5d6d81; font-size: 12px; }
.kefu-attachment-dialog__footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.kefu-attachment-dialog__footer > span { color: #5d6d81; font-size: 11px; }
.kefu-attachment-dialog__footer > div { display: flex; gap: 8px; }
.kefu-attachment-dialog__footer .el-button { min-width: 50px; height: 28px; padding: 0 12px; border-radius: 4px; font-size: 12px; }
.kefu-attachment-dialog__cancel.el-button { border-color: #fff3e9; background: #fff3e9; color: #bd4c12; }
.kefu-attachment-dialog__confirm.el-button { border-color: #bd4c12; background: #bd4c12; color: #fff; }
.kefu-attachment-dialog__confirm.el-button.is-disabled { border-color: #ffd4ba; background: #ffd4ba; color: #fff; }
.kefu-attachment-dialog button:focus-visible, .kefu-attachment-strip button:focus-visible { outline: 2px solid #bd4c12; outline-offset: 2px; }
@media (max-width: 480px) {
  .kefu-attachment-dialog .el-dialog__body { padding: 12px 12px 7px; }
  .kefu-attachment-dialog .el-dialog__footer { padding: 6px 12px 12px; }
  .kefu-attachment-dialog__tab { min-width: 86px; padding-inline: 12px; }
  .kefu-attachment-dialog__rules { font-size: 10px; }
  .kefu-attachment-card { width: 172px; }
}
@media (prefers-reduced-motion: reduce) {
  .kefu-attachment-strip__viewport { scroll-behavior: auto; }
}
</style>
