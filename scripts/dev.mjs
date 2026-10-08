// Arranca electron-vite en modo desarrollo (recarga en caliente). Quita ELECTRON_RUN_AS_NODE: algunos editores la
// definen en sus terminales y hace que Electron arranque como un Node normal y falle.
import { spawn } from 'node:child_process'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn('npx', ['electron-vite', 'dev', ...process.argv.slice(2)], { stdio: 'inherit', env, shell: true })
child.on('exit', (code) => process.exit(code ?? 0))
