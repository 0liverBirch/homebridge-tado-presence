# homebridge-tado-presence

A Homebridge plugin that adds a single control to HomeKit for your Tado home's presence, with states that read **Home** and **Away**.

| State in the Home app | What it does |
| --- | --- |
| **Home** | Locks Tado to **Home** mode. Your heating follows its schedule. |
| **Away** | Locks Tado to **Away** mode. Your zones follow their away settings. |
| **Night** | The same as Away. |
| **Off** | Removes the lock (**Auto**). Tado decides presence itself. |

That is all it does. It does not add room thermostats, occupancy sensors, or hot water switches to HomeKit.

Why does it look like a security system? HomeKit does not let a switch rename its On/Off states. A security system is the one accessory type whose states the Home app labels Home, Away, Night and Off, so the control is presented that way purely for the labels. It is not an alarm and it cannot trigger. Choosing **Night** also sets Away. Choosing **Off** removes the presence lock entirely (Auto) and hands presence back to Tado; the control reads Off for as long as the house stays unlocked.

## Why

Tado's automatic geofencing (Auto-Assist) needs a paid subscription. Without one, the Home/Away switch in the Tado app is manual only. This plugin puts that same switch in HomeKit, so you can set it from the Home app, include it in a scene, ask Siri, or drive it with HomeKit automations such as "when the last person leaves home" and "when the first person arrives home".

## How it works

The plugin works through Tado's presence lock, the mechanism behind the Home/Away switch in the Tado app, using the [`node-tado-client`](https://github.com/mattdavis90/node-tado-client) library. Home, Away and Night set the lock (`PUT /homes/{homeId}/presenceLock`); Off deletes it (`DELETE /homes/{homeId}/presenceLock`), which is Tado's Auto. Because it uses the presence lock rather than per-room overrides, switching back to Home simply resumes your schedule, with no leftover manual overrides to clear.

It also reads the current state back from Tado regularly (every 60 seconds by default), including whether the lock is set. If presence or the lock is changed in the Tado app, the control in HomeKit follows at the next refresh.

## Requirements

- Homebridge 1.6 or later
- Node.js 18 or later
- A Tado account with at least one Tado home

## Installation

From a terminal on the machine running Homebridge:

```bash
npm install -g git+https://github.com/0liverBirch/homebridge-tado-presence.git
```

Then add the configuration below and restart Homebridge.

## Configuration

Add a platform block to the `platforms` section of your Homebridge config:

```json
{
    "platform": "TadoPresence",
    "name": "Tado",
    "homeName": "My Home"
}
```

The settings are also available in the Homebridge UI, under the plugin's settings.

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `platform` | Yes | | Must be `TadoPresence`. |
| `name` | Yes | `Tado` | The name of the control in HomeKit. |
| `homeName` | No | First home on the account | The Tado home to control, exactly as named in the Tado app. Only needed if your account has more than one home. |
| `pollSeconds` | No | `60` | How often the state is refreshed from Tado. |

## Signing in to Tado

Tado no longer accepts username and password sign-ins from third-party apps. Sign-in uses a device code instead, much like signing in to a streaming service on a TV.

1. Install and configure the plugin, then restart Homebridge.
2. Open the Homebridge log. On the first start you will see a message like:

   ```
   Tado sign-in required: open the following link in a browser and approve access:
   https://login.tado.com/oauth2/device?user_code=XXXXXX
   ```

3. Open the link, sign in to Tado, and approve access.
4. The plugin continues on its own, and the control appears in HomeKit a few seconds later.

The plugin stores a refresh token in a file named `tado-presence-tokens.json` in your Homebridge storage folder (for a standard install that is `/var/lib/homebridge`). The file is created with permissions so only its owner can read it. Tado issues a new refresh token on every use, and the plugin saves the new one each time, so you should not need to sign in again.

To sign in with a different Tado account, delete the token file and restart Homebridge. You will get a fresh sign-in link.

## Usage ideas

- Build two HomeKit automations: "When the last person leaves home" sets the control to Away, "When the first person arrives home" sets it to Home. That gives you geofenced heating without an Auto-Assist subscription.
- Add the control to a "Leaving" scene.
- Ask Siri to set "Tado" to Home or Away.

## Troubleshooting

- **No sign-in link in the log.** Make sure the plugin is installed and the platform block is in your config, then restart Homebridge. The link is only printed when there is no valid stored token.
- **The sign-in code has expired.** Device codes are only valid for a few minutes. Restart Homebridge to get a new link.
- **"Tado home not found" in the log.** The `homeName` in your config does not match a home on the account. Check the spelling against the Tado app, or remove `homeName` to use the account's first home.
- **The control controls the wrong home.** Your account has more than one home. Set `homeName` to the one you want, exactly as it appears in the Tado app.
- **The control shows Off.** That is not an error. It means no presence lock is set, so Tado is deciding presence itself (Auto). Set Home or Away to lock it again.
- **The control shows the wrong state.** It refreshes from Tado every `pollSeconds`. Changes made in HomeKit apply straight away; changes made in the Tado app appear at the next refresh.
- **You are asked to sign in again after every restart.** The token file could not be written. Check that the Homebridge storage folder is writable by the user Homebridge runs as.

## Notes and limitations

- The presence lock holds until something changes it, exactly like tapping Home or Away in the Tado app. If someone changes presence in the app, the HomeKit control follows at the next refresh.
- **Off means Auto.** With the lock removed, Tado decides presence. On the free plan that means Tado's own detection and its reminders, rather than automatic switching. If anything locks the presence again, including a tap in the Tado app, the control goes back to showing Home or Away at the next refresh.
- One control per installation, controlling one Tado home. It appears with the security accessories in the Home app, because that is the only accessory type with Home and Away state labels. Most households have a single home; `homeName` exists for accounts that have several.

## Credits

Built on [`node-tado-client`](https://github.com/mattdavis90/node-tado-client) by Matt Davis.

## Licence

MIT. See [LICENSE](LICENSE).
