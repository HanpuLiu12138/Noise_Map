import sys
import time
sys.path.append("")

from micropython import const

from machine import ADC, Pin

import uasyncio as asyncio
import aioble
import bluetooth

import random
import struct


_ENV_SENSE_UUID = bluetooth.UUID("90D3D000-C950-4DD6-9410-2B7AEB1DD7D8")  # custom service definition
_NOISE_SENSE_UUID = bluetooth.UUID("d3683933-d930-4a99-9fed-4b3d44d9e4f0")

# org.bluetooth.characteristic.gap.appearance.xml
_ADV_APPEARANCE_GENERIC_THERMOMETER = const(768)

# How frequently to send advertising beacons.
_ADV_INTERVAL_US = 250_000


# Register GATT server.
device_service = aioble.Service(_ENV_SENSE_UUID)
noise_characteristic = aioble.Characteristic(device_service, _NOISE_SENSE_UUID, read=True, notify=True)

aioble.register_services(device_service)

_timer_start = time.ticks_ms()
_connected_timer_start = time.ticks_ms()

# Define the sound sensor pin and conversion factor
SoundSensorPin = 34
VREF = 3.3
CONVERSION_FACTOR = 50.0

# Configure the ADC for the sound sensor pin
adc = ADC(Pin(SoundSensorPin))
adc.atten(ADC.ATTN_11DB)  # Set attenuation for full range (3.3V)

async def noise_sensor():
    while True:
        # Read the analog value
        analog_value = adc.read()

        # Convert the analog value to voltage
        voltage_value = analog_value / 4096.0 * VREF

        # Convert the voltage to decibel value
        db_value = voltage_value * CONVERSION_FACTOR

        # Encode the decibel value and write to the characteristic
        encoded_noise = struct.pack(">h", int(db_value * 100))
        noise_characteristic.write(encoded_noise, send_update=True)

        await asyncio.sleep_ms(125)

# Serially wait for connections. Don't advertise while a central is
# connected.
async def peripheral_task():
    while True:
        async with await aioble.advertise(
            _ADV_INTERVAL_US,
            name="MicroPython_BLE_Test",
            services=[_ENV_SENSE_UUID],
            appearance=_ADV_APPEARANCE_GENERIC_THERMOMETER,
        ) as connection:
            print("Connection from:", connection.device)
            global _connected_timer_start
            _connected_timer_start = time.ticks_ms()
            #await connection.disconnected() # Don't use this as it crashes everything after 60 seconds when timeout happens.
            while connection.is_connected() == True:
                #print(f'Connection status: {connection.is_connected()}')
                await asyncio.sleep_ms(1000)
            print('Connection lost. switching back to advertising mode')


# Run tasks
async def main():
    print('Starting Bluetooth noise sensor example.')
    sensors = [asyncio.create_task(noise_sensor()),
               ]

    t2 = asyncio.create_task(peripheral_task())
    await asyncio.gather(*sensors, t2)

    print('Example finished.')

asyncio.run(main())