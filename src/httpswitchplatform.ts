import { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

// Node library dependencies
import * as http from 'http';
import * as os from 'os';

// HAP dependencies
import { HttpSwitchAccessory } from './httpswitchaccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

// Defaults
const DEFAULT_DEFAULT_STATE: string='off';
const DEFAULT_AUTO_TOGGLE: boolean=false;
const DEFAULT_AUTO_TOGGLE_DELAY: number=2;
const DEFAULT_WEBHOOKS_PORT: number = 51440;

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class HttpSwitchPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];
  
  // Homebridge server IP and specific port (for webhooks)
  private _localIp:string = '';
  private _localPort:number = -1;
  private _listenerCreated:boolean = false;

  // Maps a received webook to an accessory function
  private _pathMap = new Map<string, HttpSwitchAccessory[]>();

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    // Debug info
    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');

      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    // Debug
    this.log.debug('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {

    // Loop over configured http switches. For each http switch, if not already added, add as a switch accessory.
    // If already added, create a handler for that accessory
    const switchConfig = this.config?.switches;

    // Accessory created from this config
    let platformAccessory;

    // loop over the discovered devices and register each one if it has not already been registered
    for (const sw of switchConfig) {

      // Get accessory config: name, autoToggle, autoToggleDelay, onUrl, offUrl
      if (!sw.defaultState) {
        sw.defaultState = DEFAULT_DEFAULT_STATE;
      }

      if (!sw.autoToggle) {
        sw.autoToggle = DEFAULT_AUTO_TOGGLE;
      }

      if (!sw.autoToggleDelay) {
        sw.autoToggleDelay = DEFAULT_AUTO_TOGGLE_DELAY;
      }

      // generate a unique id from the PLATFORM_NAME plus the required switch name
      const uuid = this.api.hap.uuid.generate(PLATFORM_NAME + '.' + sw.name);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingSwitch = this.accessories.get(uuid);

      if (existingSwitch) {
        // the accessory already exists
        this.log.debug('Restoring existing accessory from cache:', existingSwitch.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. e.g.:
        // existingAccessory.context.device = device;
        // this.api.updatePlatformAccessories([existingAccessory]);
        // If the existing accessory changed, then update
        if (JSON.stringify(existingSwitch.context.config) !== JSON.stringify(sw)) {
          this.log.debug('Accessory changed', existingSwitch.displayName);
          this.log.debug(JSON.stringify(existingSwitch.context.config));
          this.log.debug(JSON.stringify(sw));
          existingSwitch.context.config = sw;

          // Update context
          this.api.updatePlatformAccessories([existingSwitch]);
        }

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        platformAccessory = new HttpSwitchAccessory(this, existingSwitch);

        // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, e.g.:
        // remove platform accessories when no longer present
        // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
        // this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.debug('Adding new accessory:', sw.name);

        // create a new accessory
        const accessory = new this.api.platformAccessory(sw.name, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.config = sw;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        platformAccessory = new HttpSwitchAccessory(this, accessory);

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
      
      // Setup webhooks (if set)
      if (sw.onWebhookPath) {
        // There may be more than one accessory responding to the same webhook. As such, keep an array of accessories
        // per webhook path.
        const accessoryArray = this._pathMap.get(sw.onWebhookPath);

        // If the key exists, add to the array, else, make a new array
        if (accessoryArray) {
          accessoryArray.push(platformAccessory);
        } else {
          this._pathMap.set(sw.onWebhookPath, [platformAccessory]);
        }

        // Create listener (if not already running)
        if (!this._listenerCreated) {
          this.createListener(); 
        }
      }

      if (sw.offWebhookPath) {
        // There may be more than one accessory responding to the same webhook. As such, keep an array of accessories
        // per webhook path.
        const accessoryArray = this._pathMap.get(sw.offWebhookPath);

        // If the key exists, add to the array, else, make a new array
        if (accessoryArray) {
          accessoryArray.push(platformAccessory);
        } else {
          this._pathMap.set(sw.offWebhookPath, [platformAccessory]);
        }
        
        // Create listener (if not already running)
        if (!this._listenerCreated) {
          this.createListener(); 
        }    
      }

      // push into discoveredCacheUUIDs
      this.discoveredCacheUUIDs.push(uuid);
    }

    // If an accessory was removed from config, then unregister the accessory
    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(uuid)) {
        this.log.debug('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }

  // HTTP switches can be triggered by webhooks sent to the homebridge server. If an accessory
  // is configured to be triggered via webhook, then setup a listener on the homebridge server
  // (this server) on the specified port (DEFAULT_WEBHOOKS_PORT)
  getHomebridgeIp():string {
    if (!this._localIp) {
      const interfaces = os.networkInterfaces();

      for (const ikey in interfaces) {
        // Get all addresses for the adapter
        const adapter = interfaces[ikey];
        if (adapter) {
          for (const akey in adapter as os.NetworkInterfaceInfo[]) {
            const addr = adapter[akey];
            if (addr.family === 'IPv4' && !addr.internal) {
              this._localIp = addr.address;
            }
          }
        }
      }
    }
    return this._localIp;
  }

  getWebhookPort(): number {
    if (this._localPort < 0) {
      this._localPort = this.config?.webhookPort || DEFAULT_WEBHOOKS_PORT;
    }

    return this._localPort;
  }

  createListener() {
    // Only create if not already created
    if (!this._listenerCreated) {

      // Create listener
      this._listenerCreated = true;

      // Create a listener on this server using the provided port
      const ip = this.getHomebridgeIp();
      const port = this.getWebhookPort();

      const server = http.createServer((request: http.IncomingMessage, response: http.ServerResponse) => {
        if (request.method === 'GET') {

          // Debug
          this.log.debug('Webhook received: ' + request.url);

          // Not sure which relay this is coming from, will check both
          const accessoryArray = this._pathMap.get(request.url as string);

          // Do the action (set the accessory on/off)
          if (accessoryArray) {
            // Set accessory state
            accessoryArray.forEach(platformAccessory => {
              platformAccessory.setState(platformAccessory.getAccessory().context.config.onWebhookPath === request.url);
            });
          } else {
            this.log.info('unknown command ignored: ' + request.url);
          }

          response.end();
        } else {
          response.statusCode = 404;
          response.end();
        }
      });

      // Listen on specified port
      server.listen(port, () =>{
        this.log.debug('Listening for webhooks on http://' + ip + ':' + port);
      });
    }
  }
}
