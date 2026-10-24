// pm2 runs the daemon from this file and starts it again whenever it exits: after a crash, and
// after the dashboard's Restart button. Setup, including starting it when you log in: docs/DAEMON_SETUP.md.
//
//   pm2 start ecosystem.config.cjs
const apps = [
  {
    name: 'faceless-video-pipeline',
    cwd: __dirname,
    script: 'src/index.ts',
    // Plain Node with tsx loaded, as `npm run daemon` runs it.
    interpreter: 'node',
    node_args: '--import tsx',
    args: '--daemon',
    // Restart exits with code 0; pm2 starts the daemon again after any exit.
    autorestart: true,
    // pm2 waits a second before starting it again, then half as long again after each quick failure
    // (a broken .env, say), up to 15 s, so a crashing daemon isn't restarted in a tight loop.
    exp_backoff_restart_delay: 1000,
    // Timestamps on every log line.
    time: true,
  },
];

// macOS: keeps the Mac from sleeping for as long as pm2 runs (-i: idle sleep; -s: any sleep while
// on power). The display can still sleep.
if (process.platform === 'darwin') {
  apps.push({ name: 'keep-awake', script: '/usr/bin/caffeinate', args: '-is', interpreter: 'none' });
}

module.exports = { apps };
