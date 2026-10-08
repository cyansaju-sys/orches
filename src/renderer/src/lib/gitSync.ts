import { useStore } from '@/store'

/** Vuelve a leer el estado de git del proyecto y lo deja en el store. */
export async function refreshGit(): Promise<void> {
  const project = useStore.getState().project
  if (!project) return
  const git = await window.api.git.status(project)
  const prev = useStore.getState().git
  if (JSON.stringify(prev) !== JSON.stringify(git)) useStore.setState({ git })
}

export const GIT_COLOR: Record<string, string> = { M: '#e2c08d', A: '#73c991', U: '#73c991', R: '#73c991', D: '#c74e39', C: '#e4676b' }
