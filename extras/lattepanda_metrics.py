#!/usr/bin/env python3
"""
Engineered Lighting — LattePanda Sigma metrics publisher.
Runs inside the HA SSH addon container (has /proc, /sys access).
Publishes to MQTT every 5 seconds on engineered_lighting/lattepanda/metrics
"""

import json, os, time
import paho.mqtt.client as mqtt

# ── Config ──────────────────────────────────────────────────────────
MQTT_HOST     = "127.0.0.1"       # localhost since we're on the HA machine
MQTT_PORT     = 1883
MQTT_USER     = "worldmodel"
MQTT_PASS     = "frigatepass"
TOPIC         = "engineered_lighting/lattepanda/metrics"
INTERVAL      = 5
CLIENT_ID     = "lattepanda-metrics"

# ── Helpers ─────────────────────────────────────────────────────────

def read_file(path, default=""):
    try:
        with open(path) as f:
            return f.read().strip()
    except Exception:
        return default


def cpu_usage():
    """Per-core usage from /proc/stat delta."""
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
    """Return (used_mb, total_mb)."""
    info = {}
    with open("/proc/meminfo") as f:
        for line in f:
            k, v = line.split(":")
            info[k.strip()] = int(v.strip().split()[0])
    total = info.get("MemTotal", 0) / 1024
    avail = info.get("MemAvailable", info.get("MemFree", 0)) / 1024
    return round(total - avail, 1), round(total, 1)


def temperatures():
    """Read thermal zones."""
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


def disk_usage_pct(path="/"):
    try:
        st = os.statvfs(path)
        used  = (st.f_blocks - st.f_bfree) * st.f_frsize
        total = st.f_blocks * st.f_frsize
        return round(100.0 * used / total, 1) if total else 0
    except Exception:
        return 0


def load_avg():
    raw = read_file("/proc/loadavg", "0 0 0")
    parts = raw.split()
    return [float(parts[0]), float(parts[1]), float(parts[2])]


def uptime_seconds():
    raw = read_file("/proc/uptime", "0 0")
    return round(float(raw.split()[0]))


# ── Main ────────────────────────────────────────────────────────────

def collect():
    cores = cpu_usage()
    ram_used, ram_total = memory_info()
    temps = temperatures()
    loads = load_avg()

    cpu_temp = 0
    for name, val in temps.items():
        if "cpu" in name.lower() or "core" in name.lower() or "package" in name.lower():
            cpu_temp = max(cpu_temp, val)
    if cpu_temp == 0 and temps:
        cpu_temp = max(temps.values())

    return {
        "cpu_usage":    round(sum(cores) / len(cores), 1) if cores else 0,
        "cpu_cores":    cores,
        "ram_used_mb":  ram_used,
        "ram_total_mb": ram_total,
        "ram_pct":      round(100.0 * ram_used / ram_total, 1) if ram_total else 0,
        "cpu_temp":     cpu_temp,
        "temps":        temps,
        "disk_pct":     disk_usage_pct(),
        "load_avg":     loads,
        "uptime":       uptime_seconds(),
    }


def main():
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, CLIENT_ID)
    client.username_pw_set(MQTT_USER, MQTT_PASS)
    client.will_set(TOPIC, json.dumps({"status": "offline"}), retain=True)
    client.connect(MQTT_HOST, MQTT_PORT, 60)
    client.loop_start()

    print(f"[lattepanda-metrics] Publishing to {TOPIC} every {INTERVAL}s")
    try:
        while True:
            data = collect()
            data["status"] = "online"
            client.publish(TOPIC, json.dumps(data), retain=True)
            time.sleep(INTERVAL)
    except KeyboardInterrupt:
        print("[lattepanda-metrics] Shutting down")
    finally:
        client.publish(TOPIC, json.dumps({"status": "offline"}), retain=True)
        client.disconnect()


if __name__ == "__main__":
    main()
