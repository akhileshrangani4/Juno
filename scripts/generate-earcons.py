#!/usr/bin/env python3
"""Synthesizes the earcons in assets/sounds: short sine tones, so there is no licensing question.

Each sound is under 300 ms and differs from the others by pitch and pattern:
  image   one high bell note
  video   two rising notes
  repost  two identical low blips
  reply   one falling glide
  shutter two quick falling clicks, played when the camera takes a picture
  like    three quick notes going up (the hold to like fired)
  unlike  the same three notes going down (the hold to remove a like fired)
Run: python3 scripts/generate-earcons.py
"""
import math
import struct
import wave
from pathlib import Path

RATE = 22050
PEAK = 0.28
OUT = Path(__file__).resolve().parent.parent / "assets" / "sounds"


def tone(freq_start, freq_end, ms, decay):
    count = int(RATE * ms / 1000)
    attack = int(RATE * 0.005)
    phase = 0.0
    samples = []
    for i in range(count):
        t = i / count
        freq = freq_start + (freq_end - freq_start) * t
        phase += 2 * math.pi * freq / RATE
        envelope = min(1.0, i / attack) * math.exp(-decay * t) * min(1.0, (count - i) / attack)
        samples.append(envelope * (math.sin(phase) + 0.25 * math.sin(2 * phase)) / 1.25)
    return samples


def silence(ms):
    return [0.0] * int(RATE * ms / 1000)


def write(name, samples):
    OUT.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUT / f"earcon-{name}.wav"), "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(RATE)
        file.writeframes(b"".join(struct.pack("<h", int(PEAK * s * 32767)) for s in samples))
    print(f"{name}: {len(samples) * 1000 // RATE} ms")


write("image", tone(1568, 1568, 160, 4.0))
write("video", tone(784, 784, 90, 2.0) + silence(20) + tone(1175, 1175, 110, 3.0))
write("repost", tone(523, 523, 70, 1.5) + silence(45) + tone(523, 523, 70, 1.5))
write("reply", tone(1046, 698, 220, 2.5))
write("shutter", tone(2400, 1400, 35, 6.0) + silence(35) + tone(2000, 1000, 45, 6.0))
write("like", tone(1046, 1046, 50, 2.0) + tone(1319, 1319, 50, 2.0) + tone(1568, 1568, 70, 3.0))
write("unlike", tone(1568, 1568, 50, 2.0) + tone(1319, 1319, 50, 2.0) + tone(1046, 1046, 70, 3.0))
