<script setup lang="ts">
import CustomerServiceWidget from './components/CustomerServiceWidget.vue'
import type { WidgetOptions } from './types'

const demoReply = '【模拟回复】设置边界条件前，请先确认适用对象、取值范围和单位，再核对保存后的预览。实际字段和结果请以接入的业务系统为准。'

const widgetOptions: WidgetOptions = {
  title: '超级人工智能小U',
  subtitle: '优解云端 · 交互演示',
  cloudFiles: [
    { id: 'demo-folder', name: '演示资料', isFolder: true },
    {
      id: 'demo-cloud-file', parentId: 'demo-folder', name: '模拟边界条件示例.csv',
      type: 'text/csv', size: 28,
      url: 'data:text/csv;charset=utf-8,%E5%AD%97%E6%AE%B5%2C%E7%A4%BA%E4%BE%8B%0A%E8%BE%B9%E7%95%8C%2C%E6%A8%A1%E6%8B%9F%E5%80%BC',
    },
  ],
  initialMessages: [
    {
      id: 'demo-question',
      role: 'user',
      content: '【模拟提问】边界条件应该怎么设置？',
      status: 'sent',
    },
    {
      id: 'demo-answer',
      role: 'assistant',
      content: demoReply,
      status: 'sent',
    },
  ],
  async onSend(message, context) {
    if (context.mode === 'ai') context.onChunk?.('【模拟回复】已收到问题，正在整理答复…')
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, 700)
      context.signal?.addEventListener('abort', () => {
        window.clearTimeout(timer)
        reject(new DOMException('已停止生成', 'AbortError'))
      }, { once: true })
    })
    if (context.mode === 'human') {
      return '【模拟回复】这是演示环境，人工客服接口尚未接入。您的消息已保留在本地会话中。'
    }
    return `【模拟回复】已收到“${message.content.slice(0, 32)}”。接入真实服务后，可在 onSend 回调中返回业务系统的答复。`
  },
}
</script>

<template>
  <div class="demo-app">
    <header class="topbar">
      <a class="brand" href="#overview" aria-label="优解云端演示页首页">
        <span class="brand-mark" aria-hidden="true">优</span>
        <span class="brand-text"><strong>优解云端</strong><small>服务组件演示</small></span>
      </a>
      <nav class="top-nav" aria-label="页面导航">
        <a href="#overview">概览</a>
        <a href="#guide">接入说明</a>
      </nav>
      <span class="demo-label" aria-label="当前页面为模拟演示">模拟演示环境</span>
    </header>

    <div class="workspace">
      <aside class="sidebar" aria-label="工作台导航">
        <span class="sidebar-caption">工作台</span>
        <a class="sidebar-link active" href="#overview"><span class="nav-dot" />产品概览</a>
        <a class="sidebar-link" href="#guide"><span class="nav-dot" />接入指引</a>
        <a class="sidebar-link" href="#experience"><span class="nav-dot" />体验说明</a>
        <div class="sidebar-note">
          <strong>组件演示</strong>
          <p>右下角的超级人工智能小U支持 AI 与人工会话模式、文件选择和历史会话操作。</p>
        </div>
      </aside>

      <main class="content" id="overview">
        <div class="breadcrumb">工作台 <span>/</span> 服务组件演示</div>

        <section class="intro" aria-labelledby="intro-title">
          <div class="intro-kicker"><span class="kicker-line" /> CLOUD SERVICE</div>
          <h1 id="intro-title">让每一次咨询，<br />都有清晰的下一步。</h1>
          <p>这是云端客服组件的嵌入演示。您可以在右下角体验会话切换、文件选择、预览和历史记录；页面中的问答内容均为模拟数据。</p>
          <a class="text-link" href="#guide">查看接入方式 <span aria-hidden="true">→</span></a>
        </section>

        <section class="guide" id="guide" aria-labelledby="guide-title">
          <div class="section-heading">
            <div>
              <p class="section-eyebrow">接入指引</p>
              <h2 id="guide-title">把服务入口放进您的网页</h2>
            </div>
            <span class="sample-tag">示例流程</span>
          </div>
          <div class="guide-rows">
            <div class="guide-row"><span class="row-number">01</span><div><strong>引入 SDK 文件</strong><p>在页面中加载打包后的样式和脚本。</p></div></div>
            <div class="guide-row"><span class="row-number">02</span><div><strong>挂载客服组件</strong><p>指定页面容器，并传入品牌文案和回调。</p></div></div>
            <div class="guide-row"><span class="row-number">03</span><div><strong>连接业务接口</strong><p>通过消息与上传回调对接自己的服务。</p></div></div>
          </div>
        </section>

        <section class="experience" id="experience" aria-labelledby="experience-title">
          <span class="experience-symbol" aria-hidden="true">✦</span>
          <div>
            <h2 id="experience-title">现在可以体验</h2>
            <p>右下角的会话窗口已经打开。发送消息会收到明确标注的模拟回复；部署时可接入真实接口。</p>
          </div>
        </section>
      </main>
    </div>

    <CustomerServiceWidget :options="widgetOptions" />
  </div>
</template>

<style>
*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; min-width: 320px; background: #f5f7fa; }
button, a { -webkit-tap-highlight-color: transparent; }
button:focus-visible, a:focus-visible { outline: 2px solid #bd4c12; outline-offset: 3px; }
.demo-app { min-height: 100dvh; color: #203046; font-family: Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif; }
.topbar { display: flex; align-items: center; gap: 34px; height: 68px; padding: 0 clamp(20px, 3vw, 48px); background: #fff; border-bottom: 1px solid #e1e7ed; }
.brand { display: flex; align-items: center; gap: 11px; color: inherit; text-decoration: none; }
.brand-mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; color: #fff; background: #bd4c12; font-size: 17px; font-weight: 800; }
.brand-text { display: flex; flex-direction: column; gap: 1px; white-space: nowrap; }
.brand-text strong { font-size: 15px; letter-spacing: .02em; line-height: 20px; }
.brand-text small { color: #5d6d81; font-size: 10px; letter-spacing: .09em; line-height: 13px; }
.top-nav { display: flex; align-items: stretch; gap: 24px; height: 100%; margin-left: 18px; }
.top-nav a { display: flex; align-items: center; color: #63748a; text-decoration: none; font-size: 13px; font-weight: 600; }
.top-nav a:hover { color: #bd4c12; }
.demo-label { margin-left: auto; padding: 6px 10px; border: 1px solid #ebd3c3; border-radius: 6px; color: #a54b1e; background: #fff8f3; font-size: 11px; font-weight: 700; white-space: nowrap; }
.workspace { display: grid; grid-template-columns: 224px minmax(0, 1fr); min-height: calc(100dvh - 68px); }
.sidebar { display: flex; flex-direction: column; padding: 32px 14px 24px; background: #fbfcfd; border-right: 1px solid #e1e7ed; }
.sidebar-caption { padding: 0 16px 13px; color: #5d6d81; font-size: 11px; letter-spacing: .12em; }
.sidebar-link { display: flex; align-items: center; gap: 12px; min-height: 43px; padding: 0 15px; border-radius: 7px; color: #5d6d81; text-decoration: none; font-size: 13px; font-weight: 600; }
.sidebar-link:hover, .sidebar-link.active { color: #a64719; background: #fff2ea; }
.nav-dot { width: 7px; height: 7px; border: 1.5px solid currentColor; border-radius: 50%; }
.sidebar-link.active .nav-dot { background: currentColor; }
.sidebar-note { margin: auto 9px 0; padding: 16px 14px; border: 1px solid #e5eaf0; border-radius: 9px; background: #fff; }
.sidebar-note strong { font-size: 12px; }
.sidebar-note p { margin: 8px 0 0; color: #6c7a8b; font-size: 11px; line-height: 1.7; }
.content { width: 100%; max-width: 1020px; padding: 34px clamp(26px, 4.8vw, 76px) 80px; }
.breadcrumb { color: #5d6d81; font-size: 12px; }
.breadcrumb span { margin: 0 8px; color: #b3bdc8; }
.intro { max-width: 690px; padding: 79px 0 78px; border-bottom: 1px solid #dde4eb; }
.intro-kicker { display: flex; align-items: center; gap: 9px; color: #a34a1b; font-size: 10px; font-weight: 700; letter-spacing: .17em; }
.kicker-line { width: 22px; height: 2px; background: #bd4c12; }
.intro h1 { margin: 20px 0 19px; font-size: clamp(30px, 3.6vw, 46px); line-height: 1.22; letter-spacing: -.035em; }
.intro p { max-width: 590px; margin: 0; color: #647589; font-size: 14px; line-height: 1.85; }
.text-link { display: inline-flex; align-items: center; gap: 9px; margin-top: 26px; color: #a94719; text-decoration: none; font-size: 13px; font-weight: 700; }
.text-link:hover { text-decoration: underline; }
.guide { max-width: 690px; padding-top: 49px; scroll-margin-top: 90px; }
.section-heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
.section-eyebrow { margin: 0 0 6px; color: #a64b1c; font-size: 11px; font-weight: 700; }
.section-heading h2 { margin: 0; font-size: 21px; line-height: 1.4; }
.sample-tag { padding: 5px 8px; color: #68798c; background: #e9eef3; border-radius: 5px; font-size: 10px; white-space: nowrap; }
.guide-rows { margin-top: 24px; border-top: 1px solid #dfe6ed; }
.guide-row { display: flex; gap: 20px; padding: 20px 0; border-bottom: 1px solid #dfe6ed; }
.row-number { color: #b7501e; font-size: 13px; font-weight: 800; font-variant-numeric: tabular-nums; }
.guide-row strong { display: block; margin-bottom: 5px; font-size: 13px; }
.guide-row p { margin: 0; color: #5d6d81; font-size: 12px; line-height: 1.6; }
.experience { display: flex; align-items: flex-start; gap: 16px; max-width: 690px; margin-top: 40px; padding: 20px; border: 1px solid #e3e9ef; border-radius: 9px; background: #fff; scroll-margin-top: 90px; }
.experience-symbol { display: grid; place-items: center; flex: 0 0 30px; width: 30px; height: 30px; color: #a64b1c; background: #fff2e9; border-radius: 50%; }
.experience h2 { margin: 0 0 5px; font-size: 13px; }
.experience p { margin: 0; color: #718093; font-size: 12px; line-height: 1.7; }
@media (max-width: 1000px) {
  .workspace { grid-template-columns: 182px minmax(0, 1fr); }
  .sidebar { padding-inline: 10px; }
  .content { padding-inline: 34px; }
}
@media (max-width: 760px) {
  .topbar { gap: 14px; height: 60px; padding-inline: 18px; }
  .top-nav { display: none; }
  .workspace { display: block; min-height: calc(100dvh - 60px); }
  .sidebar { display: none; }
  .content { padding: 26px 20px 60px; }
  .intro { padding: 64px 0 55px; }
  .intro h1 { font-size: clamp(32px, 7vw, 42px); }
}
@media (max-width: 480px) {
  .brand-text small { font-size: 9px; }
  .demo-label { padding: 5px 7px; font-size: 10px; }
  .content { padding-inline: 17px; }
  .intro { padding-top: 56px; }
  .intro h1 { font-size: 31px; }
  .intro p { font-size: 13px; }
  .section-heading h2 { font-size: 18px; }
  .experience { padding: 16px; }
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
</style>
