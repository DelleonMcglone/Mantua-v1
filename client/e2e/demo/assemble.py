"""Assemble the demo: cards and clips with crossfades → public/assets/demo.mp4."""
import os, subprocess, json
HERE=os.path.dirname(os.path.abspath(__file__)); OUT=os.path.join(HERE,'out'); PUB=os.path.join(HERE,'..','..','public','assets')
FF=os.environ.get('FFMPEG','ffmpeg'); FP=os.environ.get('FFPROBE','ffprobe')  # or the @ffmpeg-installer binaries
def dur(p): return float(subprocess.check_output([FP,'-v','error','-show_entries','format=duration','-of','csv=p=0',p]).decode().strip())
# (path, seconds or None for a clip, trim-head seconds for clips)
seq=[('card-open.png',4.0),('card-intro.png',2.6),('board.webm',None),('card-1.png',2.4),('turn-1.webm',None),('card-2.png',2.4),('turn-2.webm',None),('card-3.png',2.4),('turn-6.webm',None),('card-close.png',6.0)]
X=0.6  # crossfade seconds
args=[FF,'-y','-v','error']
durs=[]
for p,d in seq:
    full=os.path.join(OUT,p)
    if d is None:
        meta=json.load(open(full[:-5]+'.json'))
        head=max(0.0, meta['typingAtMs']/1000-0.9)
        args+=['-ss',f'{head:.3f}','-i',full]; durs.append(dur(full)-head)
    else:
        args+=['-loop','1','-t',str(d),'-framerate','30','-i',full]; durs.append(d)
n=len(seq); f=[]
for i in range(n):
    f.append(f'[{i}:v]scale=1280:720:flags=lanczos,fps=30,format=yuv420p,setpts=PTS-STARTPTS[v{i}]')
prev='v0'; off=0.0
for i in range(1,n):
    off+=durs[i-1]-X
    out=f'x{i}' if i<n-1 else 'vout'
    f.append(f'[{prev}][v{i}]xfade=transition=fade:duration={X}:offset={off:.3f}[{out}]'); prev=out
total=sum(durs)-X*(n-1)
f.append(f'[vout]fade=t=in:st=0:d=0.8,fade=t=out:st={total-0.8:.2f}:d=0.8[final]')
args+=['-filter_complex',';'.join(f),'-map','[final]','-an','-c:v','libx264','-preset','slow','-crf','27','-pix_fmt','yuv420p','-movflags','+faststart',os.path.join(PUB,'demo.mp4')]
subprocess.check_call(args)
import shutil; shutil.copy(os.path.join(OUT,'poster.jpg'), os.path.join(PUB,'demo-poster.jpg'))
print('total %.1fs'%total, 'bytes', os.path.getsize(os.path.join(PUB,'demo.mp4')))
