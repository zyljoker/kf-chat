# 超级小U 助手

基于 Vue 3、Element Plus 和 Element Plus X 的可嵌入客服组件。界面按需求文档中的浮动聊天窗、历史会话、附件输入区和导入弹窗制作；输入区参考文档提供的 [TDesign ChatSender 样式](https://tdesign.tencent.com/vue-next-chat/components/chat-sender)，实际使用 Element Plus X 的 `XSender`。

## 运行与打包

```bash
npm install
npm run dev
npm run build
```

`npm run build` 会生成演示页 `dist/` 和 SDK `dist-sdk/`。普通网页与 Vue 项目的接入代码见 [EMBED.md](./EMBED.md)。`sdk-smoke.html` 与 `sdk-es-smoke.html` 是 IIFE 和 ES 模块嵌入示例；请从本地静态服务器打开，避免浏览器对 `file://` 模块的限制。

## 已实现

- AI/人工会话切换、新会话、历史分组、重命名、删除与未读提示；切换会话时保留当前输入和附件，刷新后清空。
- 发送、流式片段、停止生成、重试、复制、反馈与附件下载；SDK 通过 `onSend`、`onUpload`、`addMessage` 连接真实服务。
- 本地拖拽/选择、云端文件夹选择、进度、取消、失败重试、横向附件列表和同页图片/视频、CSV、轻量 3D 模型预览。
- 桌面浮窗与左边缘拖宽、展开；600px 以下手机全屏布局。演示页中的问答和云端文件均明确为模拟内容。

本地附件每次最多 10 个。`stp/step/igs/iges/yjwl/ply/obj/glb/3mf` 单文件小于 500 MB，`stl` 小于 400 MB，`csv/xls/xlsx` 小于 20 MB。文档未给图片和视频单独限额，当前 `png/jpg/jpeg/gif/mp4` 按小于 20 MB 处理。

后端接口地址、鉴权、会话持久化与公司切换事件未在需求文档中定义；接入方通过 SDK 回调和卸载/重挂载来连接这些业务能力。

本地 3D 预览支持小于 50 MB 的 STL、PLY、OBJ、GLB、3MF。大文件及 STEP、IGES、YJWL、XLS、XLSX 需业务系统转换并在附件中返回 `previewUrl`（可嵌入的预览页面地址）；组件会在当前页面弹层中显示该页面。未提供预览地址时会显示明确提示和下载操作。
