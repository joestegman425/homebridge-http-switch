import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { HttpSwitchPlatform } from './httpswitchplatform.js';

// Import http stack
import * as http from 'http';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class HttpSwitchAccessory {
  private service: Service;

  // Switch defaults to "off"
  private _on: boolean=false;

  // Creates a new Http Switch
  constructor(
    private readonly platform: HttpSwitchPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'joestegman425')
      .setCharacteristic(this.platform.Characteristic.Model, 'http-switch')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, '1.0');

    // accessories will be Switches
    const serviceType = this.platform.Service.Switch;

    // create new accessory service
    this.service = this.accessory.getService(serviceType) || this.accessory.addService(serviceType);

    // Get config
    const config = this.accessory.context.config;

    // set the service name, this is what is displayed as the default name on the Home app
    // this is set in the accessory constructor
    this.service.setCharacteristic(this.platform.Characteristic.Name, this.accessory.displayName);

    // If an autoToggle switch, set the default state
    if (config.autoToggle && config.defaultState) {
      this._on = this.getDefaultState() ? true : false;
    }

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Switch

    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))  // SET - bind to the `setOn` method below
      .onGet(this.getOn.bind(this)); // GET - bind to the `getOn` method below

    // Get the default status (if statusUrl provided)
    this.updateWithDeviceStatus();
  }

  getAccessory() {
    return this.accessory;
  }

  // This is coming from a webhook so we need update the accessor state and notify homekit.
  // This does not need to call the on/off URLs (those set device state, the webhook is telling us that)
  setState(value: boolean) {
    // Set on state to value but don't do GET requests. This is coming from a webhook
    // which is telling us the state

    // Only set if changed
    if (value !== this._on) {
      this._on = value;

      // push the new value to HomeKit
      this.service.getCharacteristic(this.platform.Characteristic.On).setValue(this._on);
    }
  }

  // Wrapper that converts the strings 'on'/'off' to true/false
  getDefaultState() {
    const config = this.accessory.context!.config;

    // Get the default state
    return (config && config.defaultState && (config.defaultState === 'on')) ? true: false;
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  async setOn(value: CharacteristicValue) {

    // Don't set to the value if it is already that value
    if (this._on !== (value as boolean)) {
      // Get config
      const config = this.accessory.context.config;

      // Update the state
      this._on = value as boolean;

      // Fire GET requests (if configured)
      let url: string = this._on ? config.onUrl : config.offUrl;

      this.platform.log.debug('_on: ' + this._on + ' url: ' + url);

      if (url) {
        await this.doHttpGet(url);
      }

      // If autoToggle and this was set to the non-default state, then auto toggle back to the default state
      if (config.autoToggle && (this._on !== this.getDefaultState())) {
    
        // Need to auto-toggle after toggle delay
        const id = setInterval(() => {
          // Clear to prevent refiring
          clearInterval(id);
          
          // If auto toggle, then auto toggle after the "autoToggleDelay"
          this.platform.log.debug('Auto toggling switch:', this.accessory.displayName);

          const defaultState = this.getDefaultState();

          // Set the state (auto-switch)
          this.setState(defaultState);

          // Fire GET requests (if configured)
          url = defaultState ? config.onUrl : config.offUrl;
          
          if (url) {
            this.doHttpGet(url);
          }
        }, (config.autoToggleDelay * 1000));
      }
    }
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   *
   * GET requests should return as fast as possible. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   *
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.
   * In this case, you may decide not to implement `onGet` handlers, which may speed up
   * the responsiveness of your device in the Home app.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  async getOn(): Promise<CharacteristicValue> {
    // implement your own code to check if the device is on
    this.platform.log.debug('Get Characteristic On ->', this._on);

    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    return this._on;
  }

  // Get Status
  async updateWithDeviceStatus() {
    let status=-1;
    const config = this.accessory.context!.config;

    if (config && config.statusUrl && config.statusOnRegex) {
      // get path
      try {
        const response = await this.doHttpGet(config.statusUrl);
        const regex = new RegExp(config.statusOnRegex);
        this.platform.log.debug('statusOnRegex: ', config.statusOnRegex);
        this.platform.log.debug('response: ', response);
        // 1 === match, 0 === no match, -1 === no status (offline?)
        status = regex.test(response as string) ? 1 : 0;
        this.platform.log.debug(this.accessory.displayName + ' device status: ' + status);

        // Update state
        if (response !== -1) {
          // Got a response, now set the value
          this.platform.log.debug('device status response: ', response);

          // Set state (if response === 1, then it's a match)
          this.setState(response === 1);
        }
      } catch(error) {
        this.platform.log.info('Error getting accessory status: ', error);
      };
    }
    return status;
  }

  // HTTP GET the provided URL
  doHttpGet(url: string) {
    // Return a promise to make async
    return new Promise((resolve, reject) => {
      let data = '';
    
      // Log debug info
      this.platform.log.debug('url: ' + url);

      // Sending the request
      http.request(url, (res) => {

        res.on('data', (chunk) => {
          data += chunk;
        });

        // Ending the response
        res.on('end', () => {
          // Got a response
          this.platform.log.debug('response: ' + data);
          resolve(data);
        });

      }).on('error', (err: unknown) => {
        // Error
        this.platform.log.info('Error: ', err);
        reject(err);
      }).end();
    });
  }
}
