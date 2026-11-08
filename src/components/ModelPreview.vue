<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, type WatchStopHandle } from 'vue'
import {
  AmbientLight,
  Box3,
  Color,
  DoubleSide,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
  type Texture,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js'

const props = defineProps<{ source: File | string; filename: string }>()

const MAX_PREVIEW_BYTES = 50 * 1024 * 1024
const viewport = ref<HTMLElement | null>(null)
const state = ref<'loading' | 'ready' | 'error'>('loading')
const message = ref('正在读取模型…')

let scene: Scene | undefined
let camera: PerspectiveCamera | undefined
let renderer: WebGLRenderer | undefined
let controls: OrbitControls | undefined
let modelRoot: Object3D | undefined
let resizeObserver: ResizeObserver | undefined
let sourceWatcher: WatchStopHandle | undefined
let frameId = 0
let generation = 0
let fetchController: AbortController | undefined
let usesWindowResize = false

function extension(name: string): string {
  return name.split(/[?#]/, 1)[0].split('.').pop()?.toLowerCase() ?? ''
}

function disposeObject(root: Object3D) {
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  root.traverse((node) => {
    const mesh = node as Mesh
    mesh.geometry?.dispose()
    const entries = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const material of entries) materials.add(material)
  })
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value && typeof value === 'object' && 'isTexture' in value) textures.add(value as Texture)
    }
    material.dispose()
  }
  for (const texture of textures) texture.dispose()
}

function clearModel() {
  if (!modelRoot) return
  scene?.remove(modelRoot)
  disposeObject(modelRoot)
  modelRoot = undefined
}

function resize() {
  if (!viewport.value || !camera || !renderer) return
  const width = Math.max(1, viewport.value.clientWidth)
  const height = Math.max(1, viewport.value.clientHeight)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height, false)
}

function animate() {
  if (!renderer || !scene || !camera) return
  controls?.update()
  renderer.render(scene, camera)
  frameId = requestAnimationFrame(animate)
}

async function readSource(source: File | string, signal: AbortSignal): Promise<ArrayBuffer> {
  if (source instanceof File) {
    if (source.size > MAX_PREVIEW_BYTES) throw new Error('模型超过 50 MB，请下载后使用专业软件查看。')
    return source.arrayBuffer()
  }

  const response = await fetch(source, { signal, credentials: 'same-origin' })
  if (!response.ok) throw new Error(`模型读取失败（HTTP ${response.status}）。`)
  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > MAX_PREVIEW_BYTES) {
    await response.body?.cancel()
    throw new Error('模型超过 50 MB，请下载后使用专业软件查看。')
  }
  if (!response.body) throw new Error('浏览器无法安全读取此模型，请下载后查看。')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_PREVIEW_BYTES) {
        await reader.cancel()
        throw new Error('模型超过 50 MB，请下载后使用专业软件查看。')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes.buffer
}

async function parseModel(data: ArrayBuffer, format: string): Promise<Object3D> {
  if (format === 'stl') {
    const geometry = new STLLoader().parse(data)
    return new Mesh(geometry, new MeshStandardMaterial({
      color: 0x6f89a9,
      roughness: 0.72,
      metalness: 0.08,
      side: DoubleSide,
      vertexColors: geometry.hasAttribute('color'),
    }))
  }
  if (format === 'ply') {
    const geometry = new PLYLoader().parse(data)
    const header = new TextDecoder().decode(new Uint8Array(data, 0, Math.min(data.byteLength, 2048)))
    const faceCount = Number(header.match(/element\s+face\s+(\d+)/i)?.[1] ?? 0)
    if (faceCount === 0) {
      return new Points(geometry, new PointsMaterial({
        color: 0x6f89a9,
        size: 3,
        sizeAttenuation: false,
        vertexColors: geometry.hasAttribute('color'),
      }))
    }
    if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals()
    return new Mesh(geometry, new MeshStandardMaterial({
      color: 0x6f89a9,
      roughness: 0.72,
      side: DoubleSide,
      vertexColors: geometry.hasAttribute('color'),
    }))
  }
  if (format === 'obj') return new OBJLoader().parse(new TextDecoder().decode(data))
  if (format === 'glb') return (await new GLTFLoader().parseAsync(data, '')).scene
  if (format === '3mf') return new ThreeMFLoader().parse(data)
  throw new Error('此模型格式需要服务端转换后才能在页面内预览。')
}

function placeModel(model: Object3D) {
  if (!scene || !controls) return
  const bounds = new Box3().setFromObject(model)
  const size = bounds.getSize(new Vector3())
  const largest = Math.max(size.x, size.y, size.z)
  if (bounds.isEmpty() || !Number.isFinite(largest) || largest <= 0) {
    throw new Error('模型没有可显示的几何内容。')
  }
  const center = bounds.getCenter(new Vector3())
  model.position.sub(center)
  const holder = new Group()
  holder.add(model)
  holder.scale.setScalar(2.5 / largest)
  scene.add(holder)
  modelRoot = holder
  controls.target.set(0, 0, 0)
  controls.update()
}

async function loadModel() {
  const current = ++generation
  fetchController?.abort()
  fetchController = new AbortController()
  clearModel()
  state.value = 'loading'
  message.value = '正在读取模型…'
  const format = extension(props.filename)
  const source = props.source
  let parsed: Object3D | undefined
  try {
    if (!['stl', 'ply', 'obj', 'glb', '3mf'].includes(format)) {
      throw new Error('此模型格式需要服务端转换后才能在页面内预览。')
    }
    const data = await readSource(source, fetchController.signal)
    if (current !== generation) return
    message.value = '正在解析模型…'
    parsed = await parseModel(data, format)
    if (current !== generation) {
      disposeObject(parsed)
      return
    }
    placeModel(parsed)
    parsed = undefined
    state.value = 'ready'
    message.value = ''
  } catch (error) {
    if (parsed) disposeObject(parsed)
    if (current !== generation) return
    state.value = 'error'
    message.value = error instanceof TypeError
      ? '无法读取模型，请检查链接权限或跨域设置。'
      : error instanceof Error ? error.message : '模型预览失败，请下载后查看。'
  }
}

onMounted(() => {
  if (!viewport.value) return
  try {
    scene = new Scene()
    scene.background = new Color(0xf7f9fc)
    camera = new PerspectiveCamera(45, 1, 0.01, 100)
    camera.position.set(3.8, 2.8, 4.6)
    renderer = new WebGLRenderer({ antialias: true, powerPreference: 'low-power' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    viewport.value.appendChild(renderer.domElement)
    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.minDistance = 1
    controls.maxDistance = 20
    scene.add(new AmbientLight(0xffffff, 2.4))
    const key = new DirectionalLight(0xffffff, 2.5)
    key.position.set(4, 7, 5)
    scene.add(key)
    const fill = new DirectionalLight(0xb7d5ff, 1.5)
    fill.position.set(-5, -2, -4)
    scene.add(fill)
    resize()
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(viewport.value)
    } else {
      window.addEventListener('resize', resize)
      usesWindowResize = true
    }
    animate()
    sourceWatcher = watch(() => [props.source, props.filename] as const, () => { void loadModel() }, { immediate: true })
  } catch {
    state.value = 'error'
    message.value = '此设备无法启动 3D 预览，请下载后查看。'
  }
})

onBeforeUnmount(() => {
  generation += 1
  fetchController?.abort()
  sourceWatcher?.()
  resizeObserver?.disconnect()
  if (usesWindowResize) window.removeEventListener('resize', resize)
  cancelAnimationFrame(frameId)
  clearModel()
  controls?.dispose()
  renderer?.dispose()
  renderer?.forceContextLoss()
  renderer?.domElement.remove()
  renderer = undefined
})
</script>

<template>
  <div class="model-preview" :aria-label="`3D 预览：${filename}`">
    <div ref="viewport" class="model-preview__viewport" />
    <div v-if="state !== 'ready'" class="model-preview__notice" :class="{ 'is-error': state === 'error' }" role="status">
      <span v-if="state === 'loading'" class="model-preview__spinner" aria-hidden="true" />
      <span>{{ message }}</span>
    </div>
    <p v-else class="model-preview__hint">拖动旋转 · 滚轮或双指缩放</p>
  </div>
</template>

<style scoped>
.model-preview { position: relative; width: 100%; height: min(68dvh, 590px); min-height: 250px; overflow: hidden; background: #f7f9fc; }
.model-preview__viewport { width: 100%; height: 100%; touch-action: none; }
.model-preview__viewport :deep(canvas) { display: block; width: 100%; height: 100%; }
.model-preview__notice { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 24px; color: #5d6d81; background: rgba(247, 249, 252, .82); text-align: center; line-height: 1.5; }
.model-preview__notice.is-error { color: #ad3e20; }
.model-preview__spinner { flex: none; width: 18px; height: 18px; border: 2px solid #cbd7e7; border-top-color: #bd4c12; border-radius: 50%; animation: model-spin .8s linear infinite; }
.model-preview__hint { position: absolute; right: 12px; bottom: 10px; margin: 0; padding: 5px 9px; color: #52647a; background: rgba(255, 255, 255, .9); border-radius: 6px; font-size: 12px; pointer-events: none; }
@keyframes model-spin { to { transform: rotate(360deg); } }
@media (max-width: 600px) { .model-preview { height: min(60dvh, 520px); min-height: 220px; } }
@media (prefers-reduced-motion: reduce) { .model-preview__spinner { animation: none; } }
</style>
