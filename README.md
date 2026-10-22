# homebridge-tado-presence

A Homebridge plugin that adds a single switch to HomeKit for your Tado home's presence.

| Switch | What it does |
| --- | --- |
| **On** | Locks Tado to **Home** mode. Your heating follows its schedule. |
| **Off** | Locks Tado to **Away** mode. Your zones follow their away settings. |

That is all it does. It does not add room thermostats, occupancy sensors, or hot water switches to HomeKit.

Tip: name the switch **At Home** in the Home app, so On and Off read naturally ("At Home: On").

Why a plain switch? Earlier versions presented the control as a security system, because that is the one accessory type whose states the Home app labels Home, Away, Night and Off. It turned out to be a bad trade: HomeKit treats a security system as a security device, so every automation that sets it demands confirmation before it runs ("this automation requires confirmation to run because it may allow entry into your home"). A geofencing automation that needs a tap to confirm is not an automation. A switch runs unattended, so the switch is back. The price is the On/Off labels, and no third state for Auto: if the presence lock is removed in the Tado app, the switch simply shows the current presence (On if Home), and the next tap or automation locks it again.

## Why

Tado's automatic geofencing (Auto-Assist) needs a paid subscription. Without one, the Home/Away switch in the Tado app is manual only. This plugin puts that same switch in HomeKit, so you can set it from the Home app, include it in a scene, ask Siri, or drive it with HomeKit automations such as "when the last person leaves home" and "when the first person arrives home".

## How it works

The plugin works through Tado's presence lock, the mechanism behind the Home/Away switch in the Tado app, using the [`node-tado-client`](https://github.com/mattdavis90/node-tado-client) library. On and Off set the lock (`PUT /homes/{homeId}/presenceLock`). Because it uses the presence lock rather than per-room overrides, switching back to Home simply resumes your schedule, with no leftover manual overrides to clear.

It also reads the current state back from Tado regularly (every 60 seconds by default). If presence is changed in the Tado app, the switch in HomeKit follows at the next refresh.

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

- Build two HomeKit automations: "When the last person leaves home" turns the switch Off, "When the first person arrives home" turns it On. That gives you geofenced heating without an Auto-Assist subscription, and because it is a switch the automations run without asking for confirmation.
- Add the switch to a "Leaving" scene.
- Ask Siri to turn the switch on or off.

## Troubleshooting

- **No sign-in link in the log.** Make sure the plugin is installed and the platform block is in your config, then restart Homebridge. The link is only printed when there is no valid stored token.
- **The sign-in code has expired.** Device codes are only valid for a few minutes. Restart Homebridge to get a new link.
- **"Tado home not found" in the log.** The `homeName` in your config does not match a home on the account. Check the spelling against the Tado app, or remove `homeName` to use the account's first home.
- **The control controls the wrong home.** Your account has more than one home. Set `homeName` to the one you want, exactly as it appears in the Tado app.
- **The switch shows the wrong state.** It refreshes from Tado every `pollSeconds`. Changes made in HomeKit apply straight away; changes made in the Tado app appear at the next refresh. The switch shows presence itself, so if the presence lock was removed in the Tado app (Auto), the switch still shows On for Home or Off for Away as Tado reports it.
- **You are asked to sign in again after every restart.** The token file could not be written. Check that the Homebridge storage folder is writable by the user Homebridge runs as.

## Notes and limitations

- The presence lock holds until something changes it, exactly like tapping Home or Away in the Tado app. If someone changes presence in the app, the HomeKit switch follows at the next refresh.
- **There is no Auto state.** A switch has two states, so Auto (no presence lock) is not offered. If you remove the lock in the Tado app, the switch keeps showing the current presence, and the next time the switch is flipped it locks presence again.
- One switch per installation, controlling one Tado home. Most households have a single home; `homeName` exists for accounts that have several.

## Credits

Built on [`node-tado-client`](https://github.com/mattdavis90/node-tado-client) by Matt Davis.

## Licence

MIT. See [LICENSE](LICENSE).
