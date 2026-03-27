#!/usr/bin/env python3
"""
Engineered Lighting — Jetson Orin Nano metrics publisher.
Reads tegrastats + /sys thermal/power nodes and publishes to MQTT
every 5 seconds as JSON on  engineered_lighting/jetson/metrics
"""

import json, os, re, subprocess, threading, time
import paho.mqtt.client as mqtt

# ── Config ──────────────────────────────────────────────────────────
MQTT_HOST     = "192.168.175.114"
MQTT_PORT     = 1883
MQTT_USER     = "worldmodel"
MQTT_PASS     = "frigatepass"
TOPIC         = "engineered_lighting/jetson/metrics"
INTERVAL      = 5          # seconds between publishes
CLIENT_ID     = "jetson-metrics"

# ── Helpers ─────────────────────────────────────────────────────────

def read_file(path, default=""):
    try:
        with open(path) as f:
            return f.read().strip()
    except Exception:
        return default


def cpu_usage():
    """Return list of per-core usage percentages via /proc/stat delta."""
    def read_stat():
        cores = {}
        with open("/proc/stat") as f:
            for line in f:
                if line.startswith("cpu") and line[3] != " ":
                    parts = line.split()
                    name = parts[0]
                    vals = list(map(int, parts[1:]))
                    idle = vals[3] + (vals[4] if len(vals) > 4 else 0)
                    total = sum(vals)
                    cores[name] = (idle, total)
        return cores

    s1 = read_stat()
    time.sleep(0.25)
    s2 = read_stat()
    usages = []
    for name in sorted(s1):
        d_idle  = s2[name][0] - s1[name][0]
        d_total = s2[name][1] - s1[name][1]
        if d_total > 0:
            usages.append(round(100.0 * (1.0 - d_idle / d_total), 1))
        else:
            usages.append(0.0)
    return usages


def memory_info():
    """Return (used_mb, total_mb) from /proc/meminfo."""
    info = {}
    with open("/proc/meminfo") as f:
        for line in f:
            k, v = line.split(":")
            info[k.strip()] = int(v.strip().split()[0])  # kB
    total = info.get("MemTotal", 0) / 1024
    avail = info.get("MemAvailable", info.get("MemFree", 0)) / 1024
    return round(total - avail, 1), round(total, 1)


def gpu_usage():
    """
    Read GPU load from /sys (Jetson-specific sysfs node).
    Returns percentage 0-100.
    """
    # Try several known paths for different JetPack versions
    paths = [
        "/sys/devices/gpu.0/load",
        "/sys/devices/platform/gpu.0/load",
        "/sys/devices/17000000.gpu/load",
        "/sys/devices/platform/17000000.gpu/load",
    ]
    for p in paths:
        val = read_file(p)
        if val:
            try:
                # Value is 0-1000, divide by 10 for percentage
                return round(int(val) / 10.0, 1)
            except ValueError:
                pass
    # Fallback: parse tegrastats one-shot
    return _gpu_from_tegrastats()


def _gpu_from_tegrastats():
    """Fallback: run tegrastats once and parse GR3D_FREQ."""
    try:
        proc = subprocess.run(
            ["tegrastats", "--interval", "200"],
            capture_output=True, text=True, timeout=2
        )
        m = re.search(r"GR3D_FREQ\s+(\d+)%", proc.stdout)
        if m:
            return float(m.group(1))
    except Exception:
        pass
    return 0.0


def temperatures():
    """Read all thermal zones and return dict of name→°C."""
    temps = {}
    base = "/sys/class/thermal"
    try:
        for tz in sorted(os.listdir(base)):
            if not tz.startswith("thermal_zone"):
                continue
            ttype = read_file(f"{base}/{tz}/type", tz)
            raw   = read_file(f"{base}/{tz}/temp", "0")
            try:
                temps[ttype] = round(int(raw) / 1000.0, 1)
            except ValueError:
                pass
    except Exception:
        pass
    return temps


def disk_usage_pct():
    """Return root partition usage percentage."""
    try:
        st = os.statvfs("/")
        used  = (st.f_blocks - st.f_bfree) * st.f_frsize
        total = st.f_blocks * st.f_frsize
        return round(100.0 * used / total, 1) if total else 0
    except Exception:
        return 0


def power_watts():
    """Read INA3221 power rails (Jetson-specific)."""
    powers = {}
    base = "/sys/bus/i2c/drivers/ina3221"
    try:
        for dev in os.listdir(base):
            devpath = os.path.join(base, dev)
            if not os.path.isdir(devpath):
                continue
            hwmon_dir = os.path.join(devpath, "hwmon")
            if not os.path.isdir(hwmon_dir):
                continue
            for hw in os.listdir(hwmon_dir):
                hp = os.path.join(hwmon_dir, hw)
                # Read channel labels and power
                for ch in range(1, 4):
                    label = read_file(f"{hp}/in{ch}_label")
                    curr  = read_file(f"{hp}/curr{ch}_input", "0")
                    volt  = read_file(f"{hp}/in{ch}_input", "0")
                    if label:
                        try:
                            w = int(curr) * int(volt) / 1_000_000.0
                            powers[label] = round(w, 2)
                        except ValueError:
                            pass
    except Exception:
        pass

    # Simpler fallback: /sys/bus/i2c power nodes on newer JetPack
    if not powers:
        try:
            for d in os.listdir("/sys/class/hwmon"):
                hp = f"/sys/class/hwmon/{d}"
                name = read_file(f"{hp}/name")
                if "ina" in name.lower():
                    for ch in range(1, 4):
                        label = read_file(f"{hp}/in{ch}_label")
                        power = read_file(f"{hp}/power{ch}_input", "0")
                        if label and power != "0":
                            powers[label] = round(int(power) / 1_000_000.0, 2)
        except Exception:
            pass

    return powers


def uptime_seconds():
    raw = read_file("/proc/uptime", "0 0")
    return round(float(raw.split()[0]))


# ── Main loop ───────────────────────────────────────────────────────

def collect():
    cores = cpu_usage()
    ram_used, ram_total = memory_info()
    temps = temperatures()
    gpu = gpu_usage()
    pwr = power_watts()

    # Pick the hottest sensor as "main" temp
    cpu_temp = temps.get("CPU-therm",
               temps.get("cpu-therm",
               max(temps.values()) if temps else 0))
    gpu_temp = temps.get("GPU-therm",
               temps.get("gpu-therm", cpu_temp))

    payload = {
        "cpu_usage":    round(sum(cores) / len(cores), 1) if cores else 0,
        "cpu_cores":    cores,
        "gpu_usage":    gpu,
        "ram_used_mb":  ram_used,
        "ram_total_mb": ram_total,
        "ram_pct":      round(100.0 * ram_used / ram_total, 1) if ram_total else 0,
        "cpu_temp":     cpu_temp,
        "gpu_temp":     gpu_temp,
        "temps":        temps,
        "power":        pwr,
        "disk_pct":     disk_usage_pct(),
        "uptime":       uptime_seconds(),
    }
    return payload


def main():
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, CLIENT_ID)
    client.username_pw_set(MQTT_USER, MQTT_PASS)
    client.will_set(TOPIC, json.dumps({"status": "offline"}), retain=True)
    client.connect(MQTT_HOST, MQTT_PORT, 60)
    client.loop_start()

    print(f"[jetson-metrics] Publishing to {TOPIC} every {INTERVAL}s")
    try:
        while True:
            data = collect()
            data["status"] = "online"
            client.publish(TOPIC, json.dumps(data), retain=True)
            time.sleep(INTERVAL)
    except KeyboardInterrupt:
        print("[jetson-metrics] Shutting down")
    finally:
        client.publish(TOPIC, json.dumps({"status": "offline"}), retain=True)
        client.disconnect()


if __name__ == "__main__":
    main()
