# Running the daemon all day

How to keep the daemon running on a Mac or a Windows PC, open its dashboard from your phone, and get a push when something breaks. When you're done:

- pm2 runs the daemon. It starts it again after a crash, after the dashboard's **Restart** button, and when you log in after a reboot.
- The PC doesn't go to sleep.
- The dashboard opens on your phone at `https://<pc>.<tailnet>.ts.net`, over Tailscale only.
- Alerts reach your phone through ntfy.
- healthchecks.io pushes to the same ntfy topic when the daemon or the PC stops.

Notes:

- **Sources checked 2026-10-25**, against pm2 7.1.1, Tailscale 1.104.2, ntfy 2.34 and Healthchecks 5.0.1. Where the docs were vague, behaviour was read from the project's source.
- **[UNVERIFIED]** marks a step I couldn't confirm in an official doc. Menu labels change often.
- The pm2 steps were tried on macOS (pm2 7.0.4): starting the daemon, Restart from the dashboard, and `keep-awake`. The Windows steps have not been run.
- Commands are the same on both systems unless a step says otherwise. On Windows, use PowerShell.

---

## Part A: pm2

The repo ships `ecosystem.config.cjs`. It runs `node --import tsx src/index.ts --daemon` in the repo folder, which is what `npm run daemon` does. On macOS it also runs `keep-awake` (Part C).

1. **Install pm2** (it needs Node 18 or later) ([README](https://github.com/Unitech/pm2/blob/v7.1.1/README.md)):
   ```bash
   npm install -g pm2
   ```
2. **Start the daemon** from the repo folder:
   ```bash
   pm2 start ecosystem.config.cjs
   ```
3. **Check it:**
   - `pm2 status` lists `faceless-video-pipeline` as `online`.
   - `pm2 logs faceless-video-pipeline` shows `[Daemon] Schedules running; dashboard at http://localhost:4747`.
   - On the dashboard, **Restart** is enabled. Started any other way (`npm run daemon`), it is disabled, because nothing would start the daemon again.
4. **Save the list**, so pm2 can bring it back after a reboot (Part B):
   ```bash
   pm2 save
   ```
   pm2 restores whatever was running at the last `pm2 save` ([paths.js](https://github.com/Unitech/pm2/blob/v7.1.1/paths.js)).
5. **Keep the logs from filling the disk.** pm2 keeps everything the daemon prints in `~/.pm2/logs` (`%USERPROFILE%\.pm2\logs` on Windows) and never trims it. Run `pm2 install pm2-logrotate` to rotate them **[UNVERIFIED: its default limits]**.

**Restarts.** pm2 starts the daemon again whenever it exits, whatever the exit code ([God.js](https://github.com/Unitech/pm2/blob/v7.1.1/lib/God.js#L417-L446)).

- It waits 1 second first.
- If the daemon keeps failing as it starts (a broken `.env`, say), each wait is 1.5 times longer, up to 15 seconds. The wait goes back to 1 second once the daemon has stayed up for 30 seconds ([God.js](https://github.com/Unitech/pm2/blob/v7.1.1/lib/God.js#L520-L541)).
- `pm2 logs faceless-video-pipeline --err` shows why it failed.

**After a change:**

- Edited `.env`, or pulled new code: press **Restart** on the dashboard, or run `pm2 restart faceless-video-pipeline`.
- Edited `ecosystem.config.cjs`: run `pm2 delete ecosystem.config.cjs`, then `pm2 start ecosystem.config.cjs`, then `pm2 save`.

---

## Part B: Start pm2 when you log in

### macOS

1. Run `pm2 startup`. It prints a command that starts with `sudo env PATH=…`. Paste it and run it ([Startup.js](https://github.com/Unitech/pm2/blob/v7.1.1/lib/API/Startup.js#L22-L38)).
2. Run `pm2 save` again if you changed the list since Part A.
3. To undo: `pm2 unstartup`. It also prints a `sudo` command to paste.
4. **After upgrading Node**, run `pm2 unstartup`, then `pm2 startup` again ([startup docs](https://pm2.keymetrics.io/docs/usage/startup/)).

> **pm2 starts at login, not at boot.**
> - `pm2 startup` installs a LaunchAgent (`~/Library/LaunchAgents/pm2.<user>.plist`), which runs `pm2 resurrect` when you log in ([launchd.tpl](https://github.com/Unitech/pm2/blob/v7.1.1/lib/templates/init-scripts/launchd.tpl)).
> - After a power cut or an update restart, nothing runs until someone logs in.
> - To log in without you: **System Settings → Users & Groups → Automatically log in as**. This option isn't available while FileVault is on ([Apple](https://support.apple.com/en-us/102316)).
> - Otherwise healthchecks.io (Part F) tells you the daemon is down, and you log in.

### Windows

`pm2 startup` doesn't work on Windows: it prints `Init system not found` ([Startup.js](https://github.com/Unitech/pm2/blob/v7.1.1/lib/API/Startup.js#L43-L68)). Instead, have Task Scheduler run `pm2 resurrect` when you sign in. It runs as you, so pm2 sees the same PATH, ffmpeg, files and GPU as your own terminal.

1. Find pm2: `where.exe pm2`. Note the path ending in `pm2.cmd`, usually `C:\Users\<you>\AppData\Roaming\npm\pm2.cmd`.
2. Open **Task Scheduler → Create Task…** **[UNVERIFIED labels throughout this list]**:
   - **General:** name it `pm2 resurrect`; choose **Run only when user is logged on**.
   - **Triggers → New:** **At log on**, **Specific user**: your account.
   - **Actions → New:** **Start a program**. Program: the `pm2.cmd` path from step 1. Arguments: `resurrect`.
   - **Conditions:** on a laptop, untick **Start the task only if the computer is on AC power**. New tasks have it ticked ([Microsoft](https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-disallowstartifonbatteries)).
3. Test it: `pm2 kill`, then right-click the task → **Run**. `pm2 status` should list the daemon again.

> **Windows gotchas**
> - **Nothing runs until you sign in.** That includes after a power cut. Windows can sign you back in after an update restart; this is on by default under some conditions ([ARSO](https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/manage/component-updates/winlogon-automatic-restart-sign-on--arso-)) **[UNVERIFIED: the Settings toggle's label]**.
> - **To start before anyone signs in**, [pm2-installer](https://github.com/jessety/pm2-installer) runs pm2 as a Windows service.
>   - The service runs as the Local Service account, not as you. It moves `PM2_HOME` to `C:\ProgramData\pm2`.
>   - Every `pm2` command then needs an administrator terminal.
>   - The service can't see your PATH, environment or user folders unless you grant access (inferred from how Local Service works). That covers the repo, `.env`, ffmpeg and the output folder.
>   - Its last release was December 2022.
>   - **[UNVERIFIED]** whether GPU work (ComfyUI, NVENC) works from a service.
> - Avoid the old `pm2-windows-startup` package. It was last published in 2015 and relies on VBScript, which Microsoft has deprecated ([Microsoft](https://learn.microsoft.com/en-us/windows/whats-new/deprecated-features)).

---

## Part C: Keep the PC awake

A sleeping PC misses its Slots, and healthchecks.io reports it as down.

### macOS

- **`keep-awake`** is the second app in `ecosystem.config.cjs`. It runs `caffeinate -is` for as long as pm2 runs it (`man caffeinate`):
  - `-i` stops idle sleep.
  - `-s` stops system sleep while the Mac is on power.
  - The display can still sleep.
- `pmset -g assertions` shows it holding `PreventUserIdleSystemSleep` and `PreventSystemSleep`.
- It is in the list `pm2 save` keeps, so it comes back with the daemon. To stop it: `pm2 stop keep-awake`.
- **On a MacBook, keep it plugged in.** `-i` works on battery too, so an unplugged MacBook stays awake until the battery runs out.
- **Without caffeinate**, the System Settings setting is ([Apple](https://support.apple.com/guide/mac-help/prevent-your-mac-from-sleeping-mchle41a6ccd/mac)):
  - On a desktop Mac: **Energy → Prevent automatic sleeping when the display is off**.
  - On a laptop: **Battery → Options → Prevent automatic sleeping on power adapter when the display is off**.
- **A MacBook sleeps when you close the lid.** Apple only documents one exception, closed-display mode: power, an external display and an external keyboard or mouse ([Apple](https://support.apple.com/en-us/102282)). Keep the lid open.

### Windows

- **Settings → System → Power & battery → Screen, sleep, & hibernate timeouts:** set **When plugged in, make my device sleep after** to **Never** ([Microsoft](https://support.microsoft.com/en-us/windows/power-settings-in-windows-11-0d6a2b6b-2e87-4611-9980-ac9ea2175734)).
- Or from PowerShell ([powercfg](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/powercfg-command-line-options)):
  - `powercfg /change standby-timeout-ac 0`: never sleep on power.
  - `powercfg /hibernate off`, from an administrator terminal. `hibernate-timeout-ac 0` doesn't mean "never".
  - `powercfg /requests` shows what is keeping the PC awake, or not.
- **Laptop lid:** to do nothing when the lid closes on power ([Microsoft](https://learn.microsoft.com/en-us/windows-hardware/customize/power-settings/power-button-and-lid-settings-lid-switch-close-action)):
  1. `powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0`
  2. `powercfg /setactive SCHEME_CURRENT`
- **Settings → Windows Update → Advanced options → Active hours:** Windows avoids update restarts during active hours "whenever possible" ([Microsoft](https://learn.microsoft.com/en-us/windows/deployment/update/waas-restart)).
  - The longest window is 18 hours.
  - Cover your generate Slots, for example 08:00 to 02:00 with the default 18:00 Slot.

---

## Part D: Open the dashboard over Tailscale

The dashboard listens on this PC only (127.0.0.1) and has no login. Tailscale makes it reachable from your own devices and no one else's.

1. **Install Tailscale** on the PC and on your phone, and sign in to both with the same account.
2. **In the admin console, under DNS:** check that **MagicDNS** is on, then enable **HTTPS Certificates** ([Tailscale](https://tailscale.com/kb/1153/enabling-https)).
   - If you skip this, step 3 offers to turn it on.
   - The PC's name appears in public certificate logs.
3. **On the PC**, run:
   ```bash
   tailscale serve --bg 4747
   ```
   ([Tailscale](https://tailscale.com/kb/1242/tailscale-serve))
   - It prints the dashboard's address, `https://<pc>.<tailnet>.ts.net`, and passes requests on to `127.0.0.1:4747`.
   - 4747 is the default `DASHBOARD_PORT`. If you set another port in `.env`, use that here instead.
   - `--bg` keeps it running across reboots until you turn it off.
4. **Allow the name.** Tailscale passes the address's name through to the dashboard as the Host ([source](https://github.com/tailscale/tailscale/blob/v1.104.2/ipn/ipnlocal/serve.go#L976-L1001)), and the dashboard refuses names it doesn't know. In `.env`, add the name, without `https://`, to `DASHBOARD_ALLOWED_HOSTS`:
   ```
   DASHBOARD_ALLOWED_HOSTS=localhost,127.0.0.1,<pc>.<tailnet>.ts.net
   ```
   Then press **Restart**.
5. **Open the address on your phone.** Add it to your home screen if you like.
6. **To check or stop it:** `tailscale serve status` shows what is served; `tailscale serve --https=443 off` stops it.

> **Tailscale gotchas**
> - **Windows signs Tailscale out with you.** Turn on **Run unattended** (tray icon → Preferences, or `tailscale set --unattended=true`), or the dashboard drops off your tailnet whenever you sign out or restart ([Tailscale](https://tailscale.com/kb/1088/run-unattended)).
> - **Keys expire.** A device's key expires after 180 days by default. In the admin console, disable key expiry for the PC so it doesn't drop off.
> - **Never use `tailscale funnel` for the dashboard.** Funnel puts the address on the public internet, where anyone could publish and spend (ADR 0001).

---

## Part E: Push Alerts to your phone with ntfy

1. **Pick a topic name that's hard to guess.** On ntfy.sh, anyone who knows a topic's name can read it and post to it: "the topic is essentially a password" ([ntfy](https://docs.ntfy.sh/publish/#picking-a-topic)).
   - Names may use letters, digits, `-` and `_`, up to 64 characters.
   - Make one with random characters:
     - macOS: `echo "fvp-alerts-$(openssl rand -hex 12)"`
     - Windows: `"fvp-alerts-" + [guid]::NewGuid().ToString("N")`
2. **Subscribe on your phone** ([ntfy](https://docs.ntfy.sh/subscribe/phone/)): install the ntfy app (Android or iOS), tap **+**, enter the topic and subscribe.
   - **Android, Google Play build:** turn on **Instant delivery** for the topic. Otherwise pushes "may arrive with a significant delay".
   - **iOS:** if pushes stop arriving, remove the subscription and add it again ([known issues](https://docs.ntfy.sh/known-issues/)).
3. **Send a test push:**
   - macOS: `curl -d "Test from the pipeline PC" https://ntfy.sh/<topic>`
   - Windows: `Invoke-RestMethod -Method Post -Uri https://ntfy.sh/<topic> -Body "Test from the pipeline PC"`. In Windows PowerShell 5.1, `curl` means something else, so use this or `curl.exe`.
4. **Point the daemon at it:** set `NTFY_TOPIC=<topic>` in `.env` and press **Restart**.
   - Alerts now push when they start and when they clear, and are held during Quiet hours.
   - Keep the topic secret.

---

## Part F: Hear when the daemon or the PC stops, with healthchecks.io

The daemon can't report its own death. Instead it pings healthchecks.io as it starts and every 5 minutes after, and healthchecks.io pushes when the pings stop.

1. **Sign up** at healthchecks.io. The free Hobbyist plan has 20 checks ([pricing](https://healthchecks.io/pricing/)).
2. **Add a check** with a Simple schedule ([docs](https://healthchecks.io/docs/configuring_checks/)):
   - **Period:** 5 minutes.
   - **Grace time:** 10 minutes. That allows for a missed ping or a restart, and you hear 10–15 minutes after the last ping. This value is a suggestion; the docs don't give one.
3. **Add the ntfy integration** in the project's integrations (fields from [source](https://github.com/healthchecks/healthchecks/blob/master/hc/integrations/ntfy/forms.py)):
   - **Topic:** the one from Part E.
   - **Server URL:** `https://ntfy.sh`.
   - **Priority for "down" events:** 4 (High), so it stands out.
   - **Priority for "up" events:** leave as is, or set **Disabled** if you don't want recovery pushes.
   - Make sure the integration is on for your check **[UNVERIFIED: where the toggle is]**.
4. **Point the daemon at it:** copy the check's ping URL (`https://hc-ping.com/<uuid>`) into `HEALTHCHECK_URL` in `.env`, and press **Restart**.
   - Within a minute the check shows as up.
   - Keep the URL secret: anyone who has it can mark the check as up ([docs](https://healthchecks.io/docs/http_api/)).
5. **Test it:**
   1. Run `pm2 stop faceless-video-pipeline`. Within 15 minutes your phone gets a "down" push.
   2. Run `pm2 start faceless-video-pipeline`. The next ping brings an "up" push.
