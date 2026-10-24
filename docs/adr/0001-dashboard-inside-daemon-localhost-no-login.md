# The dashboard runs inside the daemon, on localhost, with no login

The dashboard is served by the same process that runs the schedule (`pnpm daemon`), so its controls (Run now, Pause, Publish, Restart) are direct calls rather than messages passed through a queue. Run progress and outcomes are still written to SQLite, so Runs started from the command line show up too. It listens on localhost only and has no login, even though it can publish Posts and spend money: other devices reach it through a private network such as Tailscale. pm2 keeps the process alive and restarts it after a crash or a config change.

## Considered Options

- **Separate dashboard process** talking to the daemon through a command table: keeps working when the daemon crashes, but adds a second process, a polling loop and a heartbeat.
- **Built-in login**: only needed if the dashboard is exposed beyond a private network.

## Consequences

- When the daemon is down, so is the dashboard; pm2 is what makes that rare.
- Binding the port to anything other than localhost without adding a login would let anyone on that network publish and spend.
