# Engineered Lighting Card

A custom Home Assistant Lovelace card for the Engineered Lighting vision system. Displays camera feeds with V-JEPA 2 world model activity overlays, Jetson Orin Nano and LattePanda Sigma hardware metrics, in an Apple liquid glass design.

## Features

- **5-camera grid** with live feeds (Living Room, Dining Room, Kitchen, Back Door, Driveway)
- **V-JEPA 2 activity labels** overlaid on each camera feed
- **Jetson Orin Nano metrics** — CPU/GPU gauges, RAM bar, temperatures, online status
- **LattePanda Sigma metrics** — CPU gauge, RAM bar, disk bar, temperature, online status
- **Apple liquid glass UI** — frosted glass panels, gradient gauges, smooth animations

## Installation via HACS

1. Open HACS in your Home Assistant instance
2. Go to **Frontend** > three-dot menu > **Custom repositories**
3. Add this repository URL and select **Lovelace** as the category
4. Click **Add**, then find "Engineered Lighting Card" and install it
5. Restart Home Assistant

## Manual Installation

1. Copy `dist/engineered-lighting-card.js` to your `/config/www/` directory
2. Add the resource in **Settings > Dashboards > Resources**:
   - URL: `/local/engineered-lighting-card.js`
   - Type: JavaScript Module

## MQTT Sensor Configuration

Add the contents of `extras/mqtt_sensors.yaml` to your `configuration.yaml` under the `mqtt:` > `sensor:` section. These define sensors for Jetson and LattePanda hardware metrics.

## Metrics Scripts

- `extras/jetson_metrics.py` — Run on the Jetson Orin Nano to publish hardware metrics to MQTT
- `extras/lattepanda_metrics.py` — Run on the LattePanda (or via HA SSH addon) to publish metrics to MQTT

## Dashboard Setup

Create a new dashboard with URL path `engineered-lighting` and add the card configuration from `extras/dashboard_config.yaml`.

## Required Entities

### Cameras
- `camera.living_room`, `camera.dining_room`, `camera.kitchen`, `camera.back_door`, `camera.driveway`

### Activity Sensors (V-JEPA 2)
- `sensor.living_room_activity`, `sensor.dining_room_activity`, `sensor.kitchen_activity`, `sensor.back_door_activity`, `sensor.driveway_activity`

### Jetson Metrics
- `sensor.jetson_cpu_usage`, `sensor.jetson_gpu_usage`, `sensor.jetson_ram_pct`, `sensor.jetson_cpu_temp`, `sensor.jetson_gpu_temp`, `sensor.jetson_disk_usage`, `sensor.jetson_status`, `sensor.jetson_ram_used`, `sensor.jetson_ram_total`, `sensor.jetson_uptime`

### LattePanda Metrics
- `sensor.lattepanda_cpu_usage`, `sensor.lattepanda_ram_pct`, `sensor.lattepanda_cpu_temp`, `sensor.lattepanda_disk_usage`, `sensor.lattepanda_status`, `sensor.lattepanda_ram_used`, `sensor.lattepanda_ram_total`, `sensor.lattepanda_uptime`
