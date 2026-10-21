const fs = require('fs');
const path = require('path');
const { Tado } = require('node-tado-client');

const PLUGIN_NAME = 'homebridge-tado-presence';
const PLATFORM_NAME = 'TadoPresence';
const TOKEN_FILE_NAME = 'tado-presence-tokens.json';

// Security System state values. HomeKit has no way to rename a Switch's
// On/Off states, but the Home app labels a security system's states
// Home / Away / Night / Off, so the accessory uses that service purely
// as the presentation for Tado's presence:
//   STAY_ARM   displays as "Home" -> presence locked to HOME
//   AWAY_ARM   displays as "Away" -> presence locked to AWAY
//   NIGHT_ARM  displays as "Night" -> presence locked to AWAY
//   DISARMED   displays as "Off"   -> presence lock removed (Auto)
// The displayed state reads "Off" whenever the lock is off, and Home or
// Away whenever it is locked.
const STATE_HOME = 0;
const STATE_AWAY = 1;
const STATE_NIGHT = 2;
const STATE_OFF = 3;

/**
 * A minimal platform that exposes exactly one HomeKit accessory for the
 * Tado home's presence, with states that read Home and Away. It sets
 * Tado's presence lock via node-tado-client (PUT /homes/{id}/presenceLock),
 * the same Home/Away switch the Tado app uses. No zones, no sensors,
 * nothing else is added to HomeKit.
 *
 * Authentication uses Tado's OAuth device flow (username/password logins
 * no longer exist). The refresh token is stored in the homebridge storage
 * directory and re-saved every time Tado rotates it.
 */
class TadoPresencePlatform {
    constructor(log, config, api) {
        this.log = log;
        this.config = config || {};
        this.api = api;
        this.accessories = [];
        this.homeId = null;
        this.isHome = null;
        this.isLocked = null;
        this.currentStateCharacteristic = null;
        this.targetStateCharacteristic = null;

        this.name = this.config.name || 'Tado';
        this.homeName = this.config.homeName || null;
        this.pollSeconds = this.config.pollSeconds || 60;

        if (!api) {
            this.log('Homebridge API not available, please update your homebridge version!');
            return;
        }

        this.tokenFilePath = path.join(api.user.storagePath(), TOKEN_FILE_NAME);

        this.client = new Tado();
        this.client.setTokenCallback((token) => {
            this.saveRefreshToken(token.refresh_token);
        });

        api.on('didFinishLaunching', () => {
            this.start().catch((e) => {
                this.log('Tado presence plugin failed to start: ' + e.message);
                this.log.debug(e);
            });
        });
    }

    /**
     * Called by homebridge for accessories restored from the cache.
     */
    configureAccessory(accessory) {
        this.accessories.push(accessory);
    }

    /**
     * Signs in to Tado (device flow, reusing the stored refresh token when
     * possible), finds the home and sets up the accessory.
     */
    async start() {
        const [verify, futureToken] = await this.client.authenticate(this.loadRefreshToken());
        if (verify) {
            this.log('Tado sign-in required: open the following link in a browser and approve access:');
            this.log(verify.verification_uri_complete);
            this.log('Waiting for the Tado sign-in (code ' + verify.user_code + ')...');
        }
        await futureToken;

        const me = await this.client.getMe();
        const home = this.homeName
            ? me.homes.find((h) => h.name === this.homeName)
            : me.homes[0];
        if (!home) {
            this.log('Tado home not found' + (this.homeName ? ' (looked for "' + this.homeName + '")' : '') + '.');
            return;
        }
        this.homeId = home.id;
        this.log('Tado presence control ready for home "' + home.name + '" (ID ' + home.id + ').');

        this.setupAccessory(home);
        await this.refreshState();

        setInterval(() => {
            this.refreshState().catch((e) => {
                this.log.debug('Presence poll failed: ' + e.message);
            });
        }, this.pollSeconds * 1000);
    }

    /**
     * Maps the tracked presence and lock onto a Security System state
     * value: unlocked reads "Off" (Auto); locked reads "Home" or "Away".
     */
    displayState() {
        if (!this.isLocked) {
            return STATE_OFF;
        }
        return this.isHome ? STATE_HOME : STATE_AWAY;
    }

    /**
     * Creates (or restores) the single accessory and wires up its state
     * characteristics. Accessories created by v1.0.0 carried a Switch
     * service; it is removed so the accessory keeps its identity (room,
     * favourites) while its states become Home and Away.
     *
     * State mapping: Home -> lock to HOME; Away -> lock to AWAY;
     * Night -> lock to AWAY; Off -> remove the lock (Auto), handing
     * presence back to Tado.
     */
    setupAccessory(home) {
        const { Service, Characteristic } = this.api.hap;
        const uuid = this.api.hap.uuid.generate(PLUGIN_NAME + '-' + home.id);

        let accessory = this.accessories.find((a) => a.UUID === uuid);
        if (!accessory) {
            accessory = new this.api.platformAccessory(this.name, uuid);
            accessory.context.homeId = home.id;
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            this.accessories.push(accessory);
        }

        const info = accessory.getService(Service.AccessoryInformation) || accessory.addService(Service.AccessoryInformation);
        info.setCharacteristic(Characteristic.Manufacturer, 'tado°');
        info.setCharacteristic(Characteristic.Model, 'Home/Away Presence');

        const staleSwitch = accessory.getService(Service.Switch);
        if (staleSwitch) {
            accessory.removeService(staleSwitch);
            this.log('Replaced the old On/Off switch with the Home/Away control.');
        }

        const service = accessory.getService(Service.SecuritySystem) || accessory.addService(Service.SecuritySystem, this.name);
        this.currentStateCharacteristic = service.getCharacteristic(Characteristic.SecuritySystemCurrentState);
        this.targetStateCharacteristic = service.getCharacteristic(Characteristic.SecuritySystemTargetState);

        this.currentStateCharacteristic.onGet(() => {
            return this.displayState();
        });

        this.targetStateCharacteristic.onGet(() => {
            return this.displayState();
        });

        this.targetStateCharacteristic.onSet(async (value) => {
            const presence = value === STATE_HOME ? 'HOME' : (value === STATE_OFF ? 'AUTO' : 'AWAY');
            try {
                await this.client.setPresence(this.homeId, presence);
                if (presence === 'AUTO') {
                    this.isLocked = false;
                    this.log('Tado presence lock removed (Auto). Tado decides now.');
                } else {
                    this.isLocked = true;
                    this.isHome = presence === 'HOME';
                    this.log('Tado presence set to ' + presence + '.');
                }
                const display = this.displayState();
                this.currentStateCharacteristic.updateValue(display);
                this.targetStateCharacteristic.updateValue(display);
            } catch (e) {
                this.log('Failed to set Tado presence to ' + presence + ': ' + e.message);
                throw e;
            }
        });
    }

    /**
     * Reads the current presence and lock from Tado and updates the
     * accessory when either has changed.
     */
    async refreshState() {
        if (!this.homeId) {
            return;
        }
        const state = await this.client.getState(this.homeId);
        const isHome = state.presence === 'HOME';
        const isLocked = state.presenceLocked === true;
        if (isHome !== this.isHome || isLocked !== this.isLocked) {
            this.isHome = isHome;
            this.isLocked = isLocked;
            const value = this.displayState();
            if (this.currentStateCharacteristic) {
                this.currentStateCharacteristic.updateValue(value);
            }
            if (this.targetStateCharacteristic) {
                this.targetStateCharacteristic.updateValue(value);
            }
        }
    }

    /**
     * Loads the stored refresh token, or undefined for a fresh sign-in.
     */
    loadRefreshToken() {
        try {
            const data = JSON.parse(fs.readFileSync(this.tokenFilePath, 'utf8'));
            if (data && data.refresh_token) {
                return data.refresh_token;
            }
        } catch (e) {
            // No (readable) token file yet: normal before the first sign-in
        }
        return undefined;
    }

    /**
     * Saves the refresh token (called on every rotation), mode 0600.
     */
    saveRefreshToken(refreshToken) {
        if (!refreshToken) {
            return;
        }
        try {
            fs.writeFileSync(this.tokenFilePath, JSON.stringify({ refresh_token: refreshToken }), { mode: 0o600 });
            fs.chmodSync(this.tokenFilePath, 0o600);
        } catch (e) {
            this.log('Could not save the Tado refresh token. You may have to sign in again after a restart.');
            this.log.debug(e);
        }
    }
}

module.exports = TadoPresencePlatform;
