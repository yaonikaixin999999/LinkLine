<template>
  <Teleport to="body"><div v-if="show" ref="panel" class="ui-playlist-context-menu" :style="position" role="menu" aria-label="歌单操作" @keydown="onKey" @contextmenu.prevent>
    <button type="button" role="menuitem" :disabled="!canPlay" @click="select('play')"><UiIcon name="play" /><span>播放</span></button>
    <button type="button" role="menuitem" :disabled="!(editable || removable)" @click="select('delete')"><UiIcon name="trash" /><span>{{ removable && !editable ? '从 LinkLine 移除' : '删除' }}</span></button>
    <button type="button" role="menuitem" :disabled="!editable" @click="select('rename')"><span class="ui-playlist-context-spacer" aria-hidden="true" /><span>重命名</span></button>
  </div></Teleport>
</template>
<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import UiIcon from './UiIcon.vue'
interface MenuProps { show: boolean, x: number, y: number, editable: boolean, removable?: boolean, canPlay: boolean, trigger: HTMLElement | null }
const props: MenuProps = defineProps<MenuProps>()
const emit = defineEmits<{ close: [], select: [action: 'play' | 'rename' | 'delete'] }>()
const panel = ref<HTMLElement | null>(null)
const position = ref<Record<string, string>>({})
function select(action: 'play' | 'rename' | 'delete') { emit('select', action) }
function outside(event: PointerEvent) { if (!panel.value?.contains(event.target as Node)) emit('close') }
function close() { emit('close') }
function detach() {
  document.removeEventListener('pointerdown', outside, true)
  document.removeEventListener('scroll', close, true)
  window.removeEventListener('resize', close)
  window.removeEventListener('blur', close)
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); emit('close'); props.trigger?.focus(); return }
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const buttons = Array.from(panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus()
}
watch(() => [props.show, props.x, props.y], async() => {
  detach()
  if (!props.show) return
  await nextTick()
  if (!props.show || !panel.value) return
  const bounds = panel.value.getBoundingClientRect()
  position.value = { left: `${Math.max(8, Math.min(props.x, innerWidth - bounds.width - 8))}px`, top: `${Math.max(8, Math.min(props.y, innerHeight - bounds.height - 8))}px` }
  await nextTick()
  if (!props.show) return
  panel.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('scroll', close, true)
  window.addEventListener('resize', close)
  window.addEventListener('blur', close)
}, { flush: 'post' })
onBeforeUnmount(detach)
</script>
<style lang="less">
.ui-playlist-context-menu { position: fixed; z-index: 1100; width: 176px; padding: 6px; border: 1px solid var(--modern-border); border-radius: 10px; background: var(--modern-panel); color: var(--modern-text); box-shadow: 0 8px 28px #0003; button { display: flex; align-items: center; width: 100%; min-height: 38px; padding: 8px 10px; gap: 12px; border: 0; border-radius: 6px; background: transparent; color: inherit; text-align: left; font: inherit; font-size: 13px; cursor: pointer; &:hover, &:focus-visible { outline: none; background: var(--modern-hover); } &:disabled { color: var(--modern-muted); opacity: .45; cursor: default; } svg, .ui-playlist-context-spacer { flex: none; width: 17px; height: 17px; } } }
</style>
