const TadoPresencePlatform = require('./src/platform');

/**
 * Plugin entry point: registers the platform with homebridge.
 * @param homebridge The homebridge API.
 */
module.exports = function (homebridge) {
    homebridge.registerPlatform('homebridge-tado-presence', 'TadoPresence', TadoPresencePlatform, true);
};
