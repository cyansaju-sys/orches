import { useStore } from '@/store'

/** Vuelve a leer el estado de git del proyecto y lo deja en el store. */
export async function refreshGit(): Promise<void> {
  const project = useStore.getState().project
  if (!project) return
  const git = await window.api.git.status(project)
  const prev = useStore.getState().git
  if (JSON.stringify(prev) !== JSON.stringify(git)) useStore.setState({ git })
}

export const GIT_COLOR: Record<string, string> = { M: 'var(--color-git-m)', A: 'var(--color-git-a)', U: 'var(--color-git-a)', R: 'var(--color-git-a)', D: 'var(--color-git-d)', C: 'var(--color-git-c)' }
