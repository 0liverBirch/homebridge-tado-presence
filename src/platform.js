const fs = require('fs');
const path = require('path');
const { Tado } = require('node-tado-client');

const PLUGIN_NAME = 'homebridge-tado-presence';
const PLATFORM_NAME = 'TadoPresence';
const TOKEN_FILE_NAME = 'tado-presence-tokens.json';

/**
 * A minimal platform that exposes exactly one HomeKit accessory for the
 * Tado home's presence: a plain switch. On means Home (presence locked
 * to HOME); Off means Away (presence locked to AWAY). It sets Tado's
 * presence lock via node-tado-client (PUT /homes/{id}/presenceLock),
 * the same Home/Away switch the Tado app uses. No zones, no sensors,
 * nothing else is added to HomeKit.
 *
 * Why a switch and not a security system (which the Home app labels
 * Home / Away)? Because HomeKit treats a security system as a security
 * device: any automation that sets it demands confirmation before it
 * runs, which makes geofencing automations ("when the last person
 * leaves") useless. A switch runs in automations unattended. The price
 * is that the switch's states are labelled On and Off, and there is no
 * third state for Auto: if the presence lock is removed in the Tado
 * app, the switch simply shows the current presence (On if Home).
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
        this.onCharacteristic = null;

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
     * The switch value for the tracked presence: On when Home, Off when
     * Away, whether or not the presence lock is set.
     */
    switchValue() {
        return this.isHome === true;
    }

    /**
     * Creates (or restores) the single accessory and wires up its switch.
     * The accessory keeps the same UUID it has always had, so it keeps
     * its identity (room, favourites) across versions. Accessories from
     * v1.1-1.2 carried a Security System service; it is removed and the
     * Switch put back, because HomeKit will not run an automation that
     * sets a security system without confirmation.
     *
     * State mapping: switch On -> lock presence to HOME; switch Off ->
     * lock presence to AWAY.
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

        const staleSecuritySystem = accessory.getService(Service.SecuritySystem);
        if (staleSecuritySystem) {
            accessory.removeService(staleSecuritySystem);
            this.log('Replaced the security system control with a plain switch, so automations run without confirmation.');
        }

        const service = accessory.getService(Service.Switch) || accessory.addService(Service.Switch, this.name);
        this.onCharacteristic = service.getCharacteristic(Characteristic.On);

        this.onCharacteristic.onGet(() => {
            return this.switchValue();
        });

        this.onCharacteristic.onSet(async (value) => {
            const presence = value ? 'HOME' : 'AWAY';
            try {
                await this.client.setPresence(this.homeId, presence);
                this.isLocked = true;
                this.isHome = presence === 'HOME';
                this.log('Tado presence set to ' + presence + '.');
                this.onCharacteristic.updateValue(this.switchValue());
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
            if (this.onCharacteristic) {
                this.onCharacteristic.updateValue(this.switchValue());
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
