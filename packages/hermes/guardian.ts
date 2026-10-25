import { spawn } from 'node:child_process';

// The host keeps stdin open. Its unexpected death closes the pipe, so this dedicated
// process group can stop Hermes and its MCP children without trusting stale PIDs.
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error('Guardian requires a command');
const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'] });
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  try { process.kill(-process.pid, 'SIGTERM'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  setTimeout(() => { try { process.kill(-process.pid, 'SIGKILL'); } catch { process.exit(1); } }, 1500);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.stdin.resume();
process.stdin.once('end', stop);
process.stdin.once('error', stop);
child.once('exit', stop);
child.once('error', error => { console.error(`Hermes launch failed: ${error.message}`); stop(); });
