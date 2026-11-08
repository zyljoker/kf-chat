import { createApp } from 'vue'
import { ElIcon } from 'element-plus'
import 'element-plus/dist/index.css'
import 'vue-element-plus-x/styles/index.css'
import App from './App.vue'

createApp(App).component('ElIcon', ElIcon).mount('#app')
