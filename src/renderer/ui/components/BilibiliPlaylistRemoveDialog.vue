<template>
  <UiModal :show="Boolean(playlist)" title="从 LinkLine 移除歌单" subtitle="仅影响 LinkLine，不会删除 B 站收藏夹或取消视频收藏。" @close="close">
    <p class="ui-dialog-note">移除「{{ playlist?.name }}」？重新同步或登录同一账号时，此歌单也不会自动加入 LinkLine。</p>
    <p v-if="error" class="ui-dialog-error" role="alert">{{ error }}</p>
    <template #footer><button type="button" class="ui-dialog-button" :disabled="busy" @click="close">取消</button><button type="button" class="ui-dialog-button ui-dialog-button-danger" :disabled="busy" @click="submit">{{ busy ? '移除中…' : '仅从 LinkLine 移除' }}</button></template>
  </UiModal>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import type { PropType } from 'vue'
import type { PlatformPlaylist } from '@common/platformAccounts'
import { removeBilibiliLocal } from '../services/platformAccounts'
import UiModal from './UiModal.vue'
const props = defineProps({ playlist: { type: Object as PropType<PlatformPlaylist | null>, default: null } })
const emit = defineEmits<{ close: [], removed: [id: string] }>()
const busy = ref(false)
const error = ref('')
watch(() => props.playlist, () => { error.value = '' })
function close() { if (!busy.value) emit('close') }
async function submit() {
  const playlist = props.playlist
  if (busy.value || playlist?.platform !== 'bilibili') return
  busy.value = true
  error.value = ''
  try {
    await removeBilibiliLocal({ ownerId: playlist.ownerId, playlistId: playlist.id })
    emit('removed', playlist.id)
    emit('close')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '移除失败，请重试。' } finally { busy.value = false }
}
</script>
