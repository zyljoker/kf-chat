import { createApp, h, reactive, shallowRef, type App } from 'vue'
import { ElIcon } from 'element-plus'
import 'element-plus/dist/index.css'
import 'vue-element-plus-x/styles/index.css'
import CustomerServiceWidget from './components/CustomerServiceWidget.vue'
import type { ChatMode, CloudFile, SendContext, WidgetAttachment, WidgetIncomingMessage, WidgetMessage, WidgetOptions } from './types'

export { CustomerServiceWidget }
export type { ChatMode, CloudFile, SendContext, WidgetAttachment, WidgetMessage, WidgetOptions }

export interface WidgetInstance {
  readonly element: HTMLElement
  update(options: WidgetOptions): void
  /** Deliver a message from an external service to an existing conversation. */
  addMessage(message: WidgetMessage, conversationId?: string): void
  unmount(): void
}

const instances = new WeakMap<HTMLElement, WidgetInstance>()

function resolveTarget(target: string | HTMLElement): HTMLElement {
  const element = typeof target === 'string' ? document.querySelector(target) : target
  if (!(element instanceof HTMLElement)) {
    throw new Error(`CustomerServiceSDK: mount target not found: ${String(target)}`)
  }
  return element
}

/** Mount a widget inside an existing DOM element without replacing its other children. */
export function mount(target: string | HTMLElement, options: WidgetOptions = {}): WidgetInstance {
  const container = resolveTarget(target)
  const mounted = instances.get(container)
  if (mounted) {
    mounted.update(options)
    return mounted
  }

  const element = document.createElement('div')
  element.className = 'yun-kefu-sdk-root'
  container.appendChild(element)

  const state = reactive({ ...options }) as WidgetOptions
  const incoming = shallowRef<WidgetIncomingMessage[]>([])
  let incomingSequence = 0
  const acknowledgeIncoming = (sequence: number) => {
    incoming.value = incoming.value.filter((entry) => entry.sequence > sequence)
  }
  let app: App<Element> | undefined = createApp({
    name: 'CustomerServiceSDKRoot',
    render: () => h(CustomerServiceWidget, {
      options: state,
      incoming: incoming.value,
      onIncomingProcessed: acknowledgeIncoming,
    }),
  })
  app.component('ElIcon', ElIcon)
  app.mount(element)

  const instance: WidgetInstance = {
    element,
    update(nextOptions) {
      for (const key of Object.keys(state) as (keyof WidgetOptions)[]) {
        delete state[key]
      }
      Object.assign(state, nextOptions)
    },
    addMessage(message, conversationId) {
      if (!app) return
      incoming.value = [
        ...incoming.value,
        { sequence: ++incomingSequence, message, conversationId },
      ]
    },
    unmount() {
      if (!app) return
      app.unmount()
      app = undefined
      element.remove()
      instances.delete(container)
    },
  }
  instances.set(container, instance)
  return instance
}

/** Remove a widget previously mounted in the target element. */
export function unmount(target: string | HTMLElement): void {
  instances.get(resolveTarget(target))?.unmount()
}

