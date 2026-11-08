<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getExtension } from '../utils/attachmentRules'

const props = withDefaults(
  defineProps<{
    source: File | string
    filename?: string
    maxRows?: number
    maxColumns?: number
  }>(),
  { maxRows: 100, maxColumns: 30 },
)

type PreviewState = 'loading' | 'ready' | 'empty' | 'error' | 'unsupported'

const state = ref<PreviewState>('loading')
const rows = ref<string[][]>([])
const errorMessage = ref('')
const rowsTrimmed = ref(false)
const columnsTrimmed = ref(false)
const cellsTrimmed = ref(false)
const columnCount = computed(() => Math.max(0, ...rows.value.map((row) => row.length)))
const columns = computed(() => Array.from({ length: columnCount.value }, (_, index) => columnLabel(index)))
const rowLimit = computed(() => Number.isFinite(props.maxRows) ? Math.min(500, Math.max(1, Math.floor(props.maxRows))) : 100)
const columnLimit = computed(() => Number.isFinite(props.maxColumns) ? Math.min(100, Math.max(1, Math.floor(props.maxColumns))) : 30)
let requestId = 0
let fetchController: AbortController | undefined

const displayName = computed(() => {
  if (props.filename) return props.filename
  if (typeof File !== 'undefined' && props.source instanceof File) return props.source.name
  try {
    return decodeURIComponent(new URL(props.source as string, window.location.href).pathname.split('/').pop() || '表格文件')
  } catch {
    return '表格文件'
  }
})

watch(
  () => [props.source, props.filename, props.maxRows, props.maxColumns] as const,
  () => { void loadPreview() },
  { immediate: true },
)

onBeforeUnmount(() => {
  requestId += 1
  fetchController?.abort()
})

function columnLabel(index: number): string {
  let value = index + 1
  let label = ''
  while (value > 0) {
    value -= 1
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26)
  }
  return label
}

function parseCsv(text: string, maxRows: number, maxColumns: number) {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const parsed: string[][] = []
  let row: string[] = []
  let cell = ''
  let cellWasTrimmed = false
  let inQuotes = false
  let columnIndex = 0
  let truncatedRows = false
  let truncatedColumns = false
  let truncatedCells = false
  const maxCellChars = 500

  function append(char: string) {
    if (cell.length < maxCellChars) cell += char
    else {
      cellWasTrimmed = true
      truncatedCells = true
    }
  }

  function finishCell() {
    if (columnIndex < maxColumns) row.push(cellWasTrimmed ? `${cell}…` : cell)
    else truncatedColumns = true
    columnIndex += 1
    cell = ''
    cellWasTrimmed = false
  }

  function finishRow() {
    if (parsed.length < maxRows) parsed.push(row)
    else truncatedRows = true
    row = []
    columnIndex = 0
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          append('"')
          index += 1
        } else inQuotes = false
      } else append(char)
      continue
    }

    if (char === '"' && cell === '') {
      inQuotes = true
    } else if (char === ',') {
      finishCell()
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      finishCell()
      finishRow()
      if (truncatedRows) break
    } else {
      append(char)
    }
  }

  if (inQuotes) throw new Error('CSV 引号未闭合，无法预览。')
  if (source.length && !source.endsWith('\n') && !source.endsWith('\r') && !truncatedRows) {
    finishCell()
    finishRow()
  }

  return { rows: parsed, truncatedRows, truncatedColumns, truncatedCells }
}

async function loadPreview() {
  requestId += 1
  const currentRequest = requestId
  fetchController?.abort()
  fetchController = undefined
  rows.value = []
  rowsTrimmed.value = false
  columnsTrimmed.value = false
  cellsTrimmed.value = false
  errorMessage.value = ''

  const extension = getExtension(displayName.value)
  if (extension === 'xls' || extension === 'xlsx') {
    state.value = 'unsupported'
    return
  }
  if (extension !== 'csv') {
    state.value = 'error'
    errorMessage.value = '此文件不是 CSV 格式，无法在页面内预览。'
    return
  }

  state.value = 'loading'
  try {
    let text: string
    if (typeof File !== 'undefined' && props.source instanceof File) {
      if (props.source.size >= 20 * 1024 * 1024) throw new Error('CSV 文件需小于 20 MB。')
      text = await props.source.text()
    } else {
      const controller = new AbortController()
      fetchController = controller
      const response = await fetch(props.source as string, { signal: controller.signal })
      if (!response.ok) throw new Error(`文件读取失败（HTTP ${response.status}）。`)
      const declaredSize = Number(response.headers.get('content-length'))
      if (declaredSize >= 20 * 1024 * 1024) throw new Error('CSV 文件需小于 20 MB。')
      const data = await response.arrayBuffer()
      if (data.byteLength >= 20 * 1024 * 1024) throw new Error('CSV 文件需小于 20 MB。')
      text = new TextDecoder('utf-8').decode(data)
    }

    if (currentRequest !== requestId) return
    const parsed = parseCsv(text, rowLimit.value, columnLimit.value)
    rows.value = parsed.rows
    rowsTrimmed.value = parsed.truncatedRows
    columnsTrimmed.value = parsed.truncatedColumns
    cellsTrimmed.value = parsed.truncatedCells
    state.value = parsed.rows.length ? 'ready' : 'empty'
  } catch (error) {
    if (currentRequest !== requestId || (error instanceof DOMException && error.name === 'AbortError')) return
    state.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : '文件读取失败，请下载后查看。'
  }
}
</script>

<template>
  <section class="kefu-sheet-preview" :aria-label="`预览 ${displayName}`">
    <div v-if="state === 'loading'" class="kefu-sheet-preview__state" role="status">正在读取表格…</div>
    <div v-else-if="state === 'unsupported'" class="kefu-sheet-preview__state" role="status">
      当前环境暂不支持在页面内预览 XLS/XLSX，请下载文件查看。
    </div>
    <div v-else-if="state === 'error'" class="kefu-sheet-preview__state is-error" role="alert">
      {{ errorMessage }}
    </div>
    <div v-else-if="state === 'empty'" class="kefu-sheet-preview__state" role="status">文件没有可显示的数据。</div>
    <template v-else>
      <p v-if="rowsTrimmed || columnsTrimmed || cellsTrimmed" class="kefu-sheet-preview__notice">
        预览内容已截断：最多显示 {{ rowLimit }} 行、{{ columnLimit }} 列{{ cellsTrimmed ? '，过长的单元格已缩短' : '' }}。请下载文件查看完整内容。
      </p>
      <div class="kefu-sheet-preview__scroll" tabindex="0" aria-label="可滚动的表格预览">
        <table>
          <thead>
            <tr>
              <th scope="col" aria-label="行号">#</th>
              <th v-for="column in columns" :key="column" scope="col">{{ column }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in rows" :key="rowIndex">
              <th scope="row">{{ rowIndex + 1 }}</th>
              <td v-for="(_, columnIndex) in columns" :key="columnIndex">{{ row[columnIndex] ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.kefu-sheet-preview { display: flex; flex-direction: column; min-width: 0; width: 100%; max-height: min(68dvh, 590px); color: #303640; }
.kefu-sheet-preview__state { display: grid; place-items: center; min-height: 180px; padding: 24px; color: #5d6d81; text-align: center; font-size: 13px; }
.kefu-sheet-preview__state.is-error { color: #c24634; }
.kefu-sheet-preview__notice { flex: none; margin: 0 0 8px; color: #5d6d81; font-size: 11px; line-height: 1.5; }
.kefu-sheet-preview__scroll { flex: 0 1 auto; min-height: 0; width: 100%; max-height: min(58dvh, 500px); overflow: auto; border: 1px solid #eceef0; border-radius: 6px; background: #fff; overscroll-behavior: contain; }
.kefu-sheet-preview__scroll:focus-visible { outline: 2px solid #bd4c12; outline-offset: 2px; }
.kefu-sheet-preview table { width: max-content; min-width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; }
.kefu-sheet-preview th, .kefu-sheet-preview td { min-width: 82px; max-width: 260px; padding: 7px 9px; border-right: 1px solid #f0f1f3; border-bottom: 1px solid #f0f1f3; overflow-wrap: anywhere; text-align: left; vertical-align: top; }
.kefu-sheet-preview thead th { position: sticky; top: 0; z-index: 1; background: #f8f9fa; color: #626974; font-weight: 600; }
.kefu-sheet-preview th:first-child { position: sticky; left: 0; z-index: 2; min-width: 42px; width: 42px; max-width: 42px; background: #f8f9fa; color: #5d6d81; text-align: center; }
.kefu-sheet-preview thead th:first-child { z-index: 3; }
.kefu-sheet-preview tr:last-child th, .kefu-sheet-preview tr:last-child td { border-bottom: 0; }
.kefu-sheet-preview tr th:last-child, .kefu-sheet-preview tr td:last-child { border-right: 0; }
@media (max-width: 480px) {
  .kefu-sheet-preview { max-height: min(60dvh, 520px); }
  .kefu-sheet-preview th, .kefu-sheet-preview td { min-width: 72px; max-width: 200px; padding: 6px 8px; }
}
</style>
