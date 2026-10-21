# homebridge-tado-presence

One switch in HomeKit for your Tado home's presence. Nothing else.

- **On** = Tado **Home** mode (schedule runs)
- **Off** = Tado **Away** mode (zones follow their away settings)

The switch sets Tado's *presence lock* (`PUT /homes/{id}/presenceLock`), the exact same Home/Away switch the Tado app uses, via [`node-tado-client`](https://github.com/mattdavis90/node-tado-client). No room thermostats, no occupancy sensors, no hot water switches are added to HomeKit.

Built for the simple case: flip presence from the Home app, a scene, or a "when I leave / arrive" automation, without a Tado Auto-Assist subscription.

## Installation

```bash
npm install -g git+https://github.com/0liverBirch/homebridge-tado-presence.git
```

(or use the Homebridge UI's install-by-GitHub-URL), then restart Homebridge.

## Configuration

```json
{
    "platforms": [
        {
            "platform": "TadoPresence",
            "name": "Tado",
            "homeName": "Bluebell Hollow"
        }
    ]
}
```

- `name`: the switch's name in HomeKit.
- `homeName`: optional; the Tado home to control, exactly as named in the Tado app. If omitted, the account's first home is used.
- `pollSeconds`: optional, default 60. How often the switch state is refreshed from Tado (so changes made in the Tado app appear in HomeKit).

## Sign-in

Tado no longer accepts username/password logins. On the first start, the plugin prints a sign-in link to the Homebridge log:

```
Tado sign-in required: open the following link in a browser and approve access:
https://login.tado.com/oauth2/device?user_code=XXXXXX
```

Open it, sign in, approve. The plugin continues on its own. The session's refresh token is stored in `tado-presence-tokens.json` in the Homebridge storage directory (mode 0600) and renewed automatically; Tado rotates it on every use and the new one is saved each time. To sign in as a different account, delete that file and restart Homebridge.

## Good to know

- The presence lock holds until something changes it, exactly like tapping Home/Away in the Tado app's Geofencing screen.
- Pair it with HomeKit automations: "When I leave home" → switch off; "When I arrive home" → switch on.
