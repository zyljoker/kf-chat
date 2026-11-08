# 嵌入云端客服组件

运行 `npm run build:sdk` 后，`dist-sdk/` 会生成可直接嵌入网页的 JavaScript、CSS 和 TypeScript 类型声明。

## 普通网页

将 `customer-service-sdk.iife.js` 和 `customer-service-sdk.css` 放到网站可访问的目录，再加入：

```html
<link rel="stylesheet" href="/sdk/customer-service-sdk.css" />
<div id="customer-service"></div>
<script src="/sdk/customer-service-sdk.iife.js"></script>
<script>
  const widget = CustomerServiceSDK.mount('#customer-service', {
    title: '云端客服',
    onSend: async (message, context) => {
      // 对接自己的会话接口；返回客服回复文本或 WidgetMessage。
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, mode: context.mode, conversationId: context.conversationId }),
        signal: context.signal,
      })
      if (!response.ok) throw new Error('消息发送失败')
      return (await response.json()).reply
    },
    onUpload: async (file, onProgress, signal) => {
      // 替换为实际上传接口；上传过程中调用 onProgress(0 至 100)。
      const form = new FormData()
      form.append('file', file)
      const response = await fetch('/api/upload', { method: 'POST', body: form, signal })
      if (!response.ok) throw new Error('上传失败')
      onProgress(100)
      return await response.json()
    },
  })

  // 后端主动推送人工消息时，可按会话 ID 投递。
  // widget.addMessage({ id: 'reply-1', role: 'assistant', content: '您好，已收到问题。' }, conversationId)
  // 同一页面需要清理时调用 widget.unmount()。
</script>
```

`mount` 会在目标元素内部添加组件容器，保留目标元素原有的其他子节点。重复调用同一目标的 `mount` 会更新配置；也可使用返回对象的 `update(options)`、`addMessage(message, conversationId?)` 或 `CustomerServiceSDK.unmount(target)`。`onSend` 的 `context.onChunk?.(text)` 可逐段追加 AI 流式回复；`context.signal` 会在用户点击停止时中止请求。

浏览器原生 `fetch` 不提供上传进度事件。如果上传界面需要实时进度，请在 `onUpload` 中使用支持上传进度的 HTTP 客户端，并调用 `onProgress(percent)`。

`onUpload` 或 `addMessage` 提供的附件可携带 `previewUrl` 与 `previewKind: 'image' | 'video' | 'iframe'`。对 STEP、IGES、XLS/XLSX 等需要转换的格式，传入业务系统生成的可嵌入预览页面 URL，并使用 `previewKind: 'iframe'`，组件会在当前页面预览。大于 50 MB 的 3D 文件也建议由服务端生成预览。普通文件下载由浏览器处理；小文件可显示组件内下载进度。

## Vue 3 项目

发布包后，可以直接导入组件：

```vue
<script setup lang="ts">
import { CustomerServiceWidget, type WidgetOptions } from 'yun-kefu-widget'
import 'yun-kefu-widget/style.css'

const options: WidgetOptions = { title: '云端客服' }
</script>

<template>
  <CustomerServiceWidget :options="options" />
</template>
```

演示页使用 `npm run dev` 启动，`npm run build` 同时构建演示页和 SDK。
