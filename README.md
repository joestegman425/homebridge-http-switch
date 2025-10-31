<p align="center">

<img src="https://raw.githubusercontent.com/joestegman425/homebridge-http-switch/latest/src/images/http-switch.png" width="150">

</p>

<span align="center">

# homebridge-http-switch

Homebridge plugin to create virtual switch accessories that control and can be controlled by HTTP get requests.

</span>

---

This is a template Homebridge dynamic platform plugin and can be used as a base to help you get started developing your own plugin.

### Description

This Homebridge 2.0 (ready) plugin enables mapping an http based device to a switch in the Home app. This is most useful when you have devices that can be controlled by http requests (REST calls) but don't have a Homekit/Matter integration.

An example target device is the [Shelly Uni Plus](https://us.shelly.com/products/shelly-plus-uni). You may have a device like this setup as a relay that controls a home accessory, such as a house gate. With this plug-in, you can model the control of that accessory via a switch. Turning the switch "on" will open the gate (by sending an HTTP request to the Shelly Uni Plus) and turning the switch "off" will close the gate (by sending an HTTP request to the Shelly Uni Plus).

There are other scenarios where you may want to do an HTTP request in response to some other action that happens in the Home app. You can use an automation in the Home app to trigger the HTTP switch. 

Note: in the future, the goal is to extend the plug-in to support accessory types beyond a swith (e.g., door, sensor).

## Configuration

The following will create 3 example virtual switches in the Home app.

```json
{
    "name": "Homebridge Http Switch",
    "webhookPort": 51444,
    "switches": [
        {
            "name": "Gate log",
            "autoToggle": true,
            "onUrl": "http://localhost:5099/gate/log"
        },
        {
            "name": "Sensor",
            "onWebhookPath": "/sensor?on=1",
            "offWebhookPath": "/sensor?on=0"
        },
        {
            "name": "Open Gate",
            "autoToggle": true,
            "onUrl": "http://<device-ip>/relay/0?turn=on",
            "offUrl": "http://<device-ip>/relay/0?turn=off",
            "onWebhookPath": "/open?on=1",
            "offWebhookPath": "/open?on=0",
            "statusUrl": "http://<device-ip>/relay/0",
            "statusOnRegex": "\"ison\"\\s*:\\s*true"
        }
    ],
    "platform": "HomebridgeHttpSwitch"
}
```

For the exaple above, when "Gate log" is triggered, it will send a web request to a web service running on the Homebridge server.

"Sensor" will automatically turn on/off when webhook (web request) is received on the localhost. The web request is of the form "http://\<homebridgeserverip\>:\<config.webhokPort\>/sensor?on=1" (or on=0). A path of "/sensor?on=1" will turn the virtual switch on and "/sensor?on=0" will turn the vitual switch off.

"Open Gate", when turned on/off in the Home app will send an HTTP get command to "http://\<device-ip\>/relay/0?turn=on" (or off). It will also set it's state automatically if either of the webhook commands are seen. It will also set it's initial state automatically by looking at the response from the HTTP get request "http://\<device-ip\>/relay/0". If the "statusOnRegex" regular expression matches against the response, then the status will automatically be set to "on" (if not, the switch will be turned "off").

### Property Descriptions

> Note: If using "onUrl" or "offUrl", you should configure the device to have a static IP address. In addition, if using "webhooks", you should ensure your Homebridge Server has a static IP address.

- `webhookPort (string)` - If set, this will enable Http Switch Accessories to update their state via external webhooks (web requests sent directly from accessories). See below for more details.
- `name (string)` - The display name for the accessory in HomeKit (string, required)
- `defaultState ('on'|'off')` - The default state of the switch. This defaults to 'off'.
- `autoToggle (boolean)` - If set to 'true', if the switch is set to the non-default state, this will automatically toggle it back to the default state.
- `autoToggleDelay (integer)` - When using "autoToggle", this is the time in seconds before autoToggling the switch.
- `onUrl (string)` - The request URL sent to the device when the switch is turned 'on'.
- `offUrl (string)` - The request URL sent to the device when the switch is turned 'off'.
- `onWebhookPath (string)` - The webhook request path that will turn the swith 'on'. See below for more details.
- `offWebhookPath (string)` - The webhook request path that will turn the swith 'off'.
- `statusUrl (string)` - The device state URL. The response of this request must include device state. See below for more details.
- `statusOnRegex (string)` - A regular expression used to match the 'on' state in the "statusUrl" response. 

### Webhooks

> Note: To use webhooks, you will need to give your Homebridge server a static IP address.

Some devices, such as the [Shelly Uni Plus](https://us.shelly.com/products/shelly-plus-uni) can send "webhooks" when the device status changes. For example, if a device is measuring temperature, it could send a "webhook" when the temerature goes above or below a specific threshold. The "webhook" is a "web request" - meaning, it's an HTTP request.

When a "webhooksPort" and "onWebhookPath"/"offWebhooPath" are set, the "HomebridgeHttpSwitch" platform will automatically configure a "listener" on the local server to look for "webhooks". The device sending the webhook must send the webhook to "http://\<homebridge-server-ip>\:\<webhooksPort\>\<onWebhookPath\> or \<homebridge-server-ip\>:\<webhooksPort\>\<offWebhookPath\>. For example:

Local system/environment settings:

- `homebridge static IP`: "192.168.001.011". This value is typically set on your home router.

Homebridge Http Switch settings:

- `webHooksPort`: "51444"
- `onWebhookPath`: "/open?on=1"
- `offWebhookPath`: "/open?on=0"

Device setting:

- `webhook setting for when the device state is 'on'`: "http\:\/\/192\.168\.001\.011:41444/open?on=1".
- `webhook setting for when the device state is 'off'`: "http\:\/\/192\.168\.001\.011:41444/open?on=0".

### Getting State from the Device

> Note: To get device state, you should configure your device to have a static IP address.

Webhooks enable the virtual switch to automatically track changes to device state. The virtual stitch also needs a way to determine the initial device state (when the switch is first created).

When the Homebridge Http Switch Platform first sets up an Http Switch accessory, if "statusUrl" and "statusOnRegex" are both set, the platform will make an HTTP request to the "statusURL" and use the "statusOnRegex" to determine the initial virtual switch state. For example:

Local device:

            "statusUrl": "http://<device-ip>/relay/0",
            "statusOnRegex": "\"ison\"\\s*:\\s*true"

- `device IP`: "192.168.001.012". This value is typically set on your home router.
- `device status/state URL`: "http\:\/\/192\.168\.001\.012/relay/0". You should be able to type this in the browser and get the device state.

Homebridge Http Switch settings:

- `statusUrl`: "http\:\/\/192\.168\.001\.012/relay/0"
- `statusOnRegex`: "\"ison\"\\s*:\\s*true"

For the example, assume an HTTP get to "http\:\/\/192\.168\.001\.012/relay/0" returns a JSON payload like the following:

```json
{
  "ison": false,
  "has_timer": false,
  "timer_started": 0,
  "timer_duration": 0,
  "timer_remaining": 0,
  "source": "http"
}
```
In this example, `"ison": true` indicates the device state is on and `"ison": false` indicates the device state is off. A regular expression of: `"ison"\s*:\s*true"` when applied to the returned JSON response, will match (be true) when "ison" is setup to true and otherwise, not-match (be false).

> Note: the regular expression must be escaped in the config file and the above example will like this in the config file "\\"ison\\"\\\\s*:\\\\s*true".

## Disclaimer

Use at your own risk. Any issues or damage resulting from use of this plugin are not the fault of the developer.

# Contributing

Pull requests are welcome. For major changes, please open an issue first
to discuss what you would like to change.

# License

[MIT](https://choosealicense.com/licenses/mit/)