"""Text spots for the Circle Sports Agent demo (1280x720) on the owner's nebula art."""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
PUB = os.path.join(HERE, "..", "..", "..", "public", "assets")
FONTS = "/usr/share/fonts/opentype/inter"
W, H = 1280, 720
VIOLET, MINT, WHITE, DIM = (184, 146, 255), (76, 198, 198), (255, 255, 255), (150, 146, 170)


def font(size, face="InterDisplay-SemiBold"):
    return ImageFont.truetype(os.path.join(FONTS, face + ".otf"), size)


def art(y_frac):
    """Cover-crop the portrait art to 16:9 at a vertical position (0 sky … 1 city)."""
    bg = Image.open(os.path.join(HERE, "nebula-bg.jpg")).convert("RGB")
    s = W / bg.width
    bg = bg.resize((W, int(bg.height * s)))
    top = int((bg.height - H) * y_frac)
    bg = bg.crop((0, top, W, top + H))
    return Image.blend(bg, Image.new("RGB", (W, H), (4, 2, 10)), 0.22)


def centered(d, y, text, f, fill, tracking=0):
    w = d.textlength(text, font=f) + tracking * (len(text) - 1)
    x = (W - w) / 2
    if tracking:
        for ch in text:
            d.text((x, y), ch, font=f, fill=fill)
            x += d.textlength(ch, font=f) + tracking
    else:
        d.text((x, y), text, font=f, fill=fill)


def wordmark(img, scale, y):
    wm = Image.open(os.path.join(PUB, "waitlist-hero.png")).convert("RGBA")
    w = int(W * scale)
    wm = wm.resize((w, int(wm.height * w / wm.width)))
    img.paste(wm, ((W - w) // 2, y), wm)


def save(img, name):
    img.save(os.path.join(OUT, name))


os.makedirs(OUT, exist_ok=True)

# Opener — eyebrow, headline, sub.
img = art(0.28)
d = ImageDraw.Draw(img)
centered(d, 262, "INTRODUCING", font(17, "Inter-SemiBold"), MINT, tracking=5)
centered(d, 300, "Your Circle Sports Agent", font(62), WHITE)
centered(d, 392, "A daily brief, an edge, and an agent that acts on it.", font(24, "Inter-Regular"), (220, 214, 236))
save(img, "card-open.png")

# Chapter cards — "< label >" in a framed band.
for n, label in enumerate(["Daily Brief", "Automated trading", "Policy-capped risk"]):
    img = art(0.4 + 0.12 * n)
    band = Image.new("RGBA", (760, 190), (4, 2, 10, 150))
    bd = ImageDraw.Draw(band)
    for x in range(0, 760, 60):
        bd.line([(x, 0), (x, 190)], fill=(255, 255, 255, 16))
    bd.rectangle([0, 0, 759, 189], outline=(255, 255, 255, 40))
    img.paste(band, (260, 265), band)
    d = ImageDraw.Draw(img)
    f = font(40, "InterDisplay-Medium")
    text = f"<   {label}   >"
    centered(d, 336, text, f, WHITE)
    save(img, f"card-{n + 1}.png")

# "Find Your Edge" — then the close with the wordmark.
img = art(0.8)
d = ImageDraw.Draw(img)
centered(d, 318, "Find Your Edge", font(72), WHITE)
save(img, "card-edge.png")

img = art(0.93)
d = ImageDraw.Draw(img)
centered(d, 232, "ONLY AT", font(17, "Inter-SemiBold"), MINT, tracking=5)
wordmark(img, 0.5, 268)
centered(d, 528, "Mantua.AI", font(40), WHITE)
disc = "Illustrative demo. Agents trade USDC on Arc within the policy and caps you set. Not investment advice."
centered(d, 664, disc, font(16, "Inter-Regular"), DIM)
save(img, "card-close.png")
print("cards ok")
