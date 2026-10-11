"""Cut the walkthrough: open card, board, analyze, agent, close card → out/demo.mp4 (≤ 60 s)."""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, 'out')
FF = os.environ.get('FFMPEG', 'ffmpeg'); FP = os.environ.get('FFPROBE', 'ffprobe')
MAX_SECONDS = 60.0

def dur(p):
    return float(subprocess.check_output(
        [FP, '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).decode().strip())

# (file, seconds for a card or None for a clip). A clip's head is cut at its
# recorded cut-in point minus 0.9 s; its tail is kept whole.
seq = [('card-open.png', 2.0), ('board.webm', None), ('analyze.webm', None),
       ('agent.webm', None), ('card-close.png', 3.0)]
X = 0.6  # crossfade seconds

args = [FF, '-y', '-v', 'error']; durs = []
for p, d in seq:
    full = os.path.join(OUT, p)
    if d is None:
        head = max(0.0, json.load(open(full[:-5] + '.json'))['typingAtMs'] / 1000 - 0.9)
        args += ['-ss', f'{head:.3f}', '-i', full]; durs.append(dur(full) - head)
    else:
        args += ['-loop', '1', '-t', str(d), '-framerate', '30', '-i', full]; durs.append(d)

n = len(seq); f = []
for i in range(n):
    f.append(f'[{i}:v]scale=1280:720:flags=lanczos,fps=30,format=yuv420p,setpts=PTS-STARTPTS[v{i}]')
prev = 'v0'; off = 0.0
for i in range(1, n):
    off += durs[i - 1] - X
    out = f'x{i}' if i < n - 1 else 'vout'
    f.append(f'[{prev}][v{i}]xfade=transition=fade:duration={X}:offset={off:.3f}[{out}]'); prev = out
total = sum(durs) - X * (n - 1)
if total > MAX_SECONDS:
    sys.exit(f'cut is {total:.1f}s — over the {MAX_SECONDS:.0f}s cap; shorten a shot')
f.append(f'[vout]fade=t=in:st=0:d=0.8,fade=t=out:st={total - 0.8:.2f}:d=0.8[final]')
target = os.path.join(OUT, 'demo.mp4')
args += ['-filter_complex', ';'.join(f), '-map', '[final]', '-an', '-c:v', 'libx264',
         '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target]
subprocess.check_call(args)
print('shots', ' '.join(f'{p}={d:.1f}s' for (p, _), d in zip(seq, durs)))
print('total %.1fs' % total, 'bytes', os.path.getsize(target), '→', target)
