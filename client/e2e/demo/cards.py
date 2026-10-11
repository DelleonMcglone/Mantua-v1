"""Open and close cards for the walkthrough demo (1280x720), from the waitlist art."""
import os
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, 'out')
PUB = os.path.join(HERE, '..', '..', 'public', 'assets')
W, H = 1280, 720
FONTS = ['/usr/share/fonts/opentype/inter/Inter-{}.otf', '/System/Library/Fonts/Supplemental/Arial.ttf']

def font(size, weight='Medium'):
    for path in FONTS:
        try: return ImageFont.truetype(path.format(weight), size)
        except OSError: continue
    return ImageFont.load_default(size)

def sky():
    bg = Image.open(os.path.join(PUB, 'waitlist-bg.jpg')).convert('RGB')
    s = W / bg.width; bg = bg.resize((W, int(bg.height * s))).crop((0, 0, W, H))
    return Image.blend(bg, Image.new('RGB', (W, H), (4, 2, 10)), 0.25)

def center_text(d, y, text, f, fill):
    w = d.textlength(text, font=f); d.text(((W - w) / 2, y), text, font=f, fill=fill)

def wordmark(img, scale=0.62, y=None):
    wm = Image.open(os.path.join(PUB, 'waitlist-hero.png')).convert('RGBA')
    w = int(W * scale); wm = wm.resize((w, int(wm.height * w / wm.width)))
    img.paste(wm, ((W - w) // 2, (H - wm.height) // 2 if y is None else y), wm)

os.makedirs(OUT, exist_ok=True)
img = sky(); wordmark(img); img.save(os.path.join(OUT, 'card-open.png'))
img = sky(); wordmark(img, 0.5, 150); d = ImageDraw.Draw(img)
center_text(d, 430, 'mantua.ai', font(34, 'SemiBold'), (255, 255, 255))
center_text(d, 640, 'Illustrative only. Not investment advice. Prediction markets carry risk; '
            'markets can move against any view.', font(17, 'Regular'), (120, 120, 135))
img.save(os.path.join(OUT, 'card-close.png'))
print('cards ok')
