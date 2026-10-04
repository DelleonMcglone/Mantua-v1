"""Title, section and closing cards for the landing-page demo (1280x720)."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os
HERE=os.path.dirname(__file__); OUT=os.path.join(HERE,'out'); PUB=os.path.join(HERE,'..','..','public','assets')
W,H=1280,720
def font(size, idx=1):
    try: return ImageFont.truetype('/System/Library/Fonts/HelveticaNeue.ttc', size, index=idx)
    except Exception: return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', size)
def sky():
    bg=Image.open(os.path.join(PUB,'waitlist-bg.jpg')).convert('RGB')
    # cover-crop to 16:9 from the top of the art (the sky), then darken a touch
    s=W/bg.width; bg=bg.resize((W,int(bg.height*s)))
    bg=bg.crop((0,0,W,H))
    dark=Image.new('RGB',(W,H),(4,2,10)); return Image.blend(bg,dark,0.25)
def center_text(d, y, text, f, fill):
    w=d.textlength(text, font=f); d.text(((W-w)/2,y),text,font=f,fill=fill)
def wordmark(img, scale=0.62, y=None):
    wm=Image.open(os.path.join(PUB,'waitlist-hero.png')).convert('RGBA')
    w=int(W*scale); wm=wm.resize((w,int(wm.height*w/wm.width)))
    y=(H-wm.height)//2 if y is None else y
    img.paste(wm,((W-w)//2,y),wm)
# 1 — opener: the wordmark alone
img=sky(); wordmark(img); img.save(os.path.join(OUT,'card-open.png')); img.save(os.path.join(OUT,'poster.jpg'),quality=86)
# 2 — "three prompts" card
img=sky(); d=ImageDraw.Draw(img)
center_text(d, 300, 'THREE PROMPTS', font(26,10), (140,140,160))
center_text(d, 345, 'Nothing at risk.', font(64,1), (255,255,255))
img.save(os.path.join(OUT,'card-intro.png'))
# 3..5 — section cards
for n,(step,title) in enumerate([('PROMPT 1','Find the games that matter'),('PROMPT 2','Build a thesis'),('PROMPT 6','Find the probability gaps')]):
    img=sky(); d=ImageDraw.Draw(img)
    center_text(d, 300, step, font(26,10), (160,124,255))
    center_text(d, 345, title, font(58,1), (255,255,255))
    img.save(os.path.join(OUT,f'card-{n+1}.png'))
# 6 — closing card
img=sky(); wordmark(img, 0.5, 150); d=ImageDraw.Draw(img)
center_text(d, 430, 'Join the waitlist  ·  mantua.ai', font(34,10), (255,255,255))
disc=('Illustrative only. Not investment advice. Prediction markets carry risk; markets can move against any view.')
center_text(d, 640, disc, font(17,0), (120,120,135))
img.save(os.path.join(OUT,'card-close.png'))
print('cards ok')
