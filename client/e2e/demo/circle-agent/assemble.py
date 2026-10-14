"""Assemble the Circle Sports Agent demo: cards and the take's segments with crossfades."""
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
FF = os.environ.get("FFMPEG", "ffmpeg")
FINAL = os.path.join(OUT, "mantua-circle-agent-demo.mp4")
X = 0.6  # crossfade seconds

marks = {k: v / 1000 for k, v in json.load(open(os.path.join(OUT, "take.json"))).items()}
take = os.path.join(OUT, "take.webm")

# (source, start s, duration s): a card held still, or a window of the take.
seq = [
    ("card-open.png", 0, 4.2),
    (take, marks["home"] - 0.4, marks["brief"] - marks["home"] + 0.4),
    ("card-1.png", 0, 2.4),
    (take, marks["brief"] - 0.6, marks["plan"] - marks["brief"] + 0.6),
    ("card-2.png", 0, 2.4),
    (take, marks["plan"] - 0.6, marks["confirm"] - marks["plan"] + 0.6),
    ("card-3.png", 0, 2.4),
    (take, marks["confirm"] - 0.8, marks["end"] - marks["confirm"] + 0.8),
    ("card-edge.png", 0, 3.2),
    ("card-close.png", 0, 5.5),
]

args = [FF, "-y", "-v", "error"]
durs = []
for src, start, dur in seq:
    if src.endswith(".png"):
        args += ["-loop", "1", "-t", f"{dur:.3f}", "-framerate", "30", "-i", os.path.join(OUT, src)]
    else:
        args += ["-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", src]
    durs.append(dur)

n = len(seq)
f = [f"[{i}:v]scale=1280:720:flags=lanczos,fps=30,format=yuv420p,setpts=PTS-STARTPTS[v{i}]" for i in range(n)]
prev, off = "v0", 0.0
for i in range(1, n):
    off += durs[i - 1] - X
    out = f"x{i}" if i < n - 1 else "vout"
    f.append(f"[{prev}][v{i}]xfade=transition=fade:duration={X}:offset={off:.3f}[{out}]")
    prev = out
total = sum(durs) - X * (n - 1)
f.append(f"[vout]fade=t=in:st=0:d=0.8,fade=t=out:st={total - 0.8:.2f}:d=0.8[final]")
args += ["-filter_complex", ";".join(f), "-map", "[final]", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", FINAL]
subprocess.check_call(args)
print("total %.1fs" % total, "bytes", os.path.getsize(FINAL))
