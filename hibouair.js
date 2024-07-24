const hap = require('hap-nodejs');
const { SerialPort } = require('serialport');

const Accessory = hap.Accessory;
const Characteristic = hap.Characteristic;
const CharacteristicEventTypes = hap.CharacteristicEventTypes;
const Service = hap.Service;

// Get the device ID from the command-line arguments
const deviceId = process.argv[2];

if (!deviceId) {
  console.error(
    'Device ID not present. Please provide the device ID as follows:'
  );
  console.error('node hibouair.js <device_id>');
  process.exit(1);
}

// Define the manufacturer name you're looking for
const targetManufacturer = 'Smart Sensor Devices';

// Buffers to hold the incoming data
let buffer = '';
let scanningDetected = false;
let responseFound = false;
let port; // Variable to hold the SerialPort instance

// Initialize HomeKit accessories globally
let temperature, co2, humidity, light;

async function connectAndSendCommands() {
  try {
    // Get a list of all serial ports
    const ports = await SerialPort.list();

    // Find the port with the specified manufacturer
    const targetPort = ports.find(
      (port) => port.manufacturer === targetManufacturer
    );

    if (!targetPort) {
      console.log(`No port found with manufacturer: ${targetManufacturer}`);
      return;
    }

    // Log the selected port
    console.log(`Connecting to port: ${targetPort.path}`);

    // Create a new SerialPort instance for the selected port
    port = new SerialPort({
      path: targetPort.path,
      baudRate: 9600, // Adjust the baud rate as needed
    });

    // Event handler for when the port opens
    port.on('open', () => {
      console.log(
        `Port ${targetPort.path} is open and ready for communication.`
      );

      // Write the initial command
      port.write('AT+CENTRAL\r\n', (err) => {
        if (err) {
          console.error('Error writing initial command:', err.message);
        } else {
          console.log('Initial command sent: AT+CENTRAL');
        }
      });

      // Start the periodic scanning for BLE data
      setInterval(() => {
        port.write(`AT+FINDSCANDATA=${deviceId}=5\r\n`, (err) => {
          if (err) {
            console.error('Error writing scan command:', err.message);
          } else {
            console.log(`Scan command sent: AT+FINDSCANDATA=${deviceId}=5`);
          }
        });
      }, 20000); // 20000 milliseconds = 20 seconds
    });

    // Event handler for when data is received on the port
    port.on('data', (data) => {
      buffer += data.toString();
      processBuffer();
    });

    // Event handler for when there is an error
    port.on('error', (err) => {
      console.error('Error:', err.message);
      if (port) {
        port.close(() => {
          console.log('Port closed due to error.');
        });
      }
    });
  } catch (err) {
    console.error('Error listing or connecting to serial ports:', err);
    if (port) {
      port.close(() => {
        console.log('Port closed due to error.');
      });
    }
  }

  function processBuffer() {
    // Split the buffer into lines
    const lines = buffer.split('\r\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line === 'SCANNING...') {
        scanningDetected = true;
      } else if (line === 'SCAN COMPLETE') {
        scanningDetected = false;
      } else if (scanningDetected && line.length > 0) {
        // Extract the data from the line
        const dataMatch = line.match(/^\[.*?\] Device Data \[ADV\]: (.+)$/);
        if (dataMatch && dataMatch[1]) {
          const extractedData = dataMatch[1].trim();
          console.log('Extracted data:', extractedData);

          // Decode the data
          const decodedData = advDataDecode(extractedData);
          console.log('Decoded data:', decodedData);

          responseFound = true;
          buffer = ''; // Clear the buffer after finding the response

          if (!temperature || !co2 || !humidity || !light) {
            setupAccessory(decodedData); // Setup accessory if not already done
          } else {
            updateAccessory(decodedData); // Update accessory with decoded data
          }

          return;
        }
      }
    }

    // Keep the remaining buffer if no relevant line was found
    buffer = lines[lines.length - 1]; // Retain the last part of the buffer
  }

  // Function to decode the advertisement data
  function advDataDecode(adv) {
    let pos = adv.indexOf('5B0705');
    let dt = new Date();
    let currentTs =
      dt.getFullYear() +
      '/' +
      (dt.getMonth() + 1).toString().padStart(2, '0') +
      '/' +
      dt.getDate().toString().padStart(2, '0') +
      ' ' +
      dt.getHours().toString().padStart(2, '0') +
      ':' +
      dt.getMinutes().toString().padStart(2, '0') +
      ':' +
      dt.getSeconds().toString().padStart(2, '0');
    let tempHex = parseInt(
      '0x' +
        adv
          .substr(pos + 22, 4)
          .match(/../g)
          .reverse()
          .join('')
    );
    if (adv) dataShowing = true;
    if (tempHex > 1000) tempHex = (tempHex - (65535 + 1)) / 10;
    else tempHex = tempHex / 10;
    return {
      boardID: adv.substr(pos + 8, 6),
      type: adv.substr(pos + 6, 2),
      light: parseInt(
        '0x' +
          adv
            .substr(pos + 14, 4)
            .match(/../g)
            .reverse()
            .join('')
      ),
      pressure:
        parseInt(
          '0x' +
            adv
              .substr(pos + 18, 4)
              .match(/../g)
              .reverse()
              .join('')
        ) / 10,
      temp: tempHex,
      hum:
        parseInt(
          '0x' +
            adv
              .substr(pos + 26, 4)
              .match(/../g)
              .reverse()
              .join('')
        ) / 10,
      voc: parseInt(
        '0x' +
          adv
            .substr(pos + 30, 4)
            .match(/../g)
            .reverse()
            .join('')
      ),
      pm1:
        parseInt(
          '0x' +
            adv
              .substr(pos + 34, 4)
              .match(/../g)
              .reverse()
              .join('')
        ) / 10,
      pm25:
        parseInt(
          '0x' +
            adv
              .substr(pos + 38, 4)
              .match(/../g)
              .reverse()
              .join('')
        ) / 10,
      pm10:
        parseInt(
          '0x' +
            adv
              .substr(pos + 42, 4)
              .match(/../g)
              .reverse()
              .join('')
        ) / 10,
      co2: parseInt('0x' + adv.substr(pos + 46, 4)),
      vocType: parseInt('0x' + adv.substr(pos + 50, 2)),
      ts: currentTs,
    };
  }
}

// Function to setup HomeKit accessory
function setupAccessory(data) {
  const accessoryUuid = hap.uuid.generate('hap.hibouair.sensor');
  const accessory = new Accessory('HibouAir', accessoryUuid);

  // Create a function to initialize services
  function initializeService(
    serviceType,
    serviceName,
    initialValue,
    characteristicType
  ) {
    const service = new serviceType(serviceName);

    const characteristic = service.getCharacteristic(characteristicType);

    characteristic.on(CharacteristicEventTypes.GET, (callback) => {
      console.log(`Queried current ${serviceName}: ${initialValue}`);
      callback(undefined, initialValue);
    });

    accessory.addService(service);

    return {
      service,
      characteristic,
      initialValue,
    };
  }

  // Initialize temperature, CO2, humidity, and light services
  temperature = initializeService(
    Service.TemperatureSensor,
    'Temperature Sensor',
    data.temp,
    Characteristic.CurrentTemperature
  );

  co2 = initializeService(
    Service.CarbonDioxideSensor,
    'CO2 Sensor',
    data.co2,
    Characteristic.CarbonDioxideLevel
  );

  humidity = initializeService(
    Service.HumiditySensor,
    'Humidity Sensor',
    data.hum,
    Characteristic.CurrentRelativeHumidity
  );

  light = initializeService(
    Service.LightSensor,
    'Light Sensor',
    data.light,
    Characteristic.CurrentAmbientLightLevel
  );

  // Set accessory information
  accessory
    .getService(Service.AccessoryInformation)
    .setCharacteristic(Characteristic.Manufacturer, 'Smart Sensor Devices')
    .setCharacteristic(Characteristic.SerialNumber, deviceId);

  // Publish the accessory
  accessory.publish({
    username: '17:51:07:F4:BC:8B',
    pincode: '123-45-678',
    port: 47129,
    category: hap.Categories.SENSOR, // value here defines the symbol shown in the pairing screen
  });

  console.log('Accessory setup finished!');
}

// Function to update HomeKit accessory with new data
function updateAccessory(data) {
  temperature.initialValue = data.temp;
  co2.initialValue = data.co2;
  humidity.initialValue = data.hum;
  light.initialValue = data.light;

  console.log(`Updated current temperature: ${temperature.initialValue}`);
  console.log(`Updated current CO2 level: ${co2.initialValue}`);
  console.log(`Updated current Humidity level: ${humidity.initialValue}`);
  console.log(`Updated current light level: ${light.initialValue}`);

  // Update the characteristic values
  temperature.service.setCharacteristic(
    Characteristic.CurrentTemperature,
    temperature.initialValue
  );
  co2.service.setCharacteristic(
    Characteristic.CarbonDioxideLevel,
    co2.initialValue
  );
  humidity.service.setCharacteristic(
    Characteristic.CurrentRelativeHumidity,
    humidity.initialValue
  );
  light.service.setCharacteristic(
    Characteristic.CurrentAmbientLightLevel,
    light.initialValue
  );
}

// Call the function to connect and send commands
connectAndSendCommands();
