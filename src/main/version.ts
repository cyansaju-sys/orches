/** ¿`candidate` es una versión más nueva que `current`? Versiones tipo 1.2.3 (ignora lo que venga tras un «-» y una «v» inicial). */
export function isNewer(candidate: string, current: string): boolean {
  const nums = (v: string): number[] => v.replace(/^v/, '').split('-')[0].split('.').map((n) => Number(n) || 0)
  const [a, b] = [nums(candidate), nums(current)]
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0) }
  return false
}
