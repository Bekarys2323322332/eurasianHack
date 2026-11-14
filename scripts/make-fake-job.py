"""
Generate the fake job in fixtures/fake-job/.

It draws simple placeholder screenshots (1280x720 PNGs) of an imaginary
product called "Taskly" so the renderer and web app can be built and tested
before the real agent exists. Each step gets a "before" and an "after" image,
and the before image marks where the cursor will click (x, y in steps.json).

Run from the repo root:  python3 scripts/make-fake-job.py
Needs Pillow:            pip install pillow
"""
import json
import os

from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
OUT = os.path.join("fixtures", "fake-job")
FONT_DIR = "/usr/share/fonts/truetype/dejavu"

BG = (246, 247, 251)
INK = (24, 28, 40)
MUTED = (110, 116, 135)
ACCENT = (91, 76, 255)
CARD = (255, 255, 255)
LINE = (225, 228, 238)


def font(size, bold=False):
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    try:
        return ImageFont.truetype(os.path.join(FONT_DIR, name), size)
    except OSError:
        return ImageFont.load_default()


def base(page_title):
    """Empty page with the Taskly nav bar."""
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 64], fill=CARD)
    d.line([0, 64, W, 64], fill=LINE, width=1)
    d.rounded_rectangle([32, 18, 60, 46], radius=8, fill=ACCENT)
    d.text((72, 20), "Taskly", font=font(22, True), fill=INK)
    for i, label in enumerate(["Features", "Pricing", "Docs"]):
        d.text((820 + i * 110, 23), label, font=font(17), fill=MUTED)
    d.text((32, 90), page_title, font=font(14), fill=MUTED)
    return img, d


def button(d, box, label, filled=True):
    x0, y0, x1, y1 = box
    if filled:
        d.rounded_rectangle(box, radius=12, fill=ACCENT)
        color = (255, 255, 255)
    else:
        d.rounded_rectangle(box, radius=12, fill=CARD, outline=LINE, width=2)
        color = INK
    f = font(20, True)
    tw = d.textlength(label, font=f)
    d.text(((x0 + x1 - tw) / 2, (y0 + y1) / 2 - 12), label, font=f, fill=color)


def marker(d, x, y):
    """Faint ring showing where the next click lands (debug aid)."""
    d.ellipse([x - 22, y - 22, x + 22, y + 22], outline=(255, 120, 80), width=3)


def page_home(click=None):
    img, d = base("taskly.example/")
    d.text((140, 190), "Plan your week in minutes.", font=font(44, True), fill=INK)
    d.text((140, 270), "Turn messy to-do lists into a calm, shared plan.",
           font=font(22), fill=MUTED)
    button(d, (140, 340, 380, 404), "Get started")
    button(d, (400, 340, 600, 404), "See demo", filled=False)
    d.rounded_rectangle([830, 150, 1200, 600], radius=20, fill=CARD, outline=LINE, width=2)
    for i in range(5):
        y = 190 + i * 76
        d.rounded_rectangle([860, y, 1170, y + 54], radius=10, fill=BG)
        d.text((880, y + 15), f"Task {i + 1}", font=font(18), fill=INK)
    if click:
        marker(d, *click)
    return img


def page_signup(email="", click=None):
    img, d = base("taskly.example/signup")
    d.rounded_rectangle([390, 130, 890, 620], radius=20, fill=CARD, outline=LINE, width=2)
    d.text((440, 170), "Create your account", font=font(32, True), fill=INK)
    d.text((440, 240), "Email", font=font(16), fill=MUTED)
    d.rounded_rectangle([440, 268, 840, 324], radius=10, fill=BG, outline=LINE, width=2)
    d.text((460, 284), email or "you@example.com", font=font(18), fill=INK if email else MUTED)
    button(d, (440, 360, 840, 424), "Continue")
    d.text((440, 460), "No credit card needed.", font=font(16), fill=MUTED)
    if click:
        marker(d, *click)
    return img


def page_dashboard(projects=0, click=None):
    img, d = base("taskly.example/app")
    d.text((80, 130), "Your projects", font=font(36, True), fill=INK)
    button(d, (960, 126, 1200, 186), "New project")
    for i in range(projects):
        d.rounded_rectangle([80, 220 + i * 110, 1200, 310 + i * 110], radius=14,
                            fill=CARD, outline=LINE, width=2)
        d.text((110, 250 + i * 110), "Launch plan", font=font(22, True), fill=INK)
        d.text((900, 254 + i * 110), "3 tasks due this week", font=font(16), fill=MUTED)
    if projects == 0:
        d.text((80, 240), "No projects yet. Create one to get started.", font=font(20), fill=MUTED)
    if click:
        marker(d, *click)
    return img


def page_features(scrolled=False, click=None):
    img, d = base("taskly.example/app#features")
    top = 110 if scrolled else 420
    d.text((80, top), "What you can do", font=font(36, True), fill=INK)
    for i, (title, body) in enumerate([
        ("Smart scheduling", "Drops tasks into free time."),
        ("Shared boards", "Everyone sees the same plan."),
        ("Weekly recap", "A short summary every Friday."),
    ]):
        x = 80 + i * 380
        d.rounded_rectangle([x, top + 70, x + 340, top + 270], radius=16, fill=CARD,
                            outline=LINE, width=2)
        d.text((x + 24, top + 100), title, font=font(22, True), fill=INK)
        d.text((x + 24, top + 145), body, font=font(17), fill=MUTED)
    if click:
        marker(d, *click)
    return img


# Each entry: (step fields, before image, after image)
STEPS = [
    (dict(action="click", target="Get started button", x=260, y=372, typedText=None,
          reason="Open sign-up to show how quick onboarding is",
          narration="Getting started takes a single click.",
          caption="Start in one click"),
     page_home(click=(260, 372)), page_signup()),
    (dict(action="type", target="Email field", x=640, y=296, typedText="demo@example.com",
          reason="Fill the form with a fake email to continue",
          narration="Just enter an email, no credit card needed.",
          caption="Only an email needed"),
     page_signup(click=(640, 296)), page_signup(email="demo@example.com")),
    (dict(action="click", target="Continue button", x=640, y=392, typedText=None,
          reason="Submit the form and land on the dashboard",
          narration="One more click and you are in.",
          caption="You are in"),
     page_signup(email="demo@example.com", click=(640, 392)), page_dashboard(projects=0)),
    (dict(action="click", target="New project button", x=1080, y=156, typedText=None,
          reason="Show the core feature: creating a project",
          narration="Create your first project in seconds.",
          caption="Create a project"),
     page_dashboard(projects=0, click=(1080, 156)), page_dashboard(projects=1)),
    (dict(action="scroll", target="Features section", x=640, y=500, typedText=None,
          reason="Scroll to show the three headline features",
          narration="Smart scheduling, shared boards and a weekly recap keep everyone on track.",
          caption="Everything in one place"),
     page_features(scrolled=False, click=(640, 500)), page_features(scrolled=True)),
]


def main():
    os.makedirs(os.path.join(OUT, "steps"), exist_ok=True)
    steps = []
    for i, (fields, before, after) in enumerate(STEPS, start=1):
        sid = f"s{i}"
        before.save(os.path.join(OUT, "steps", f"{sid}-before.png"))
        after.save(os.path.join(OUT, "steps", f"{sid}-after.png"))
        steps.append({
            "id": sid,
            "index": i,
            "action": fields["action"],
            "target": fields["target"],
            "x": fields["x"],
            "y": fields["y"],
            "typedText": fields["typedText"],
            "reason": fields["reason"],
            "screenshotBefore": f"steps/{sid}-before.png",
            "screenshotAfter": f"steps/{sid}-after.png",
            "status": "ok",
            "narration": fields["narration"],
            "caption": fields["caption"],
            # No audio in the fixture: the renderer falls back to 2.5 s scenes.
            "audioFile": None,
            "audioSeconds": None,
            "hidden": False,
        })

    step_file = {
        "jobId": "fake-job",
        "mode": "demo",
        "url": "https://taskly.example",
        "repoUrl": "https://github.com/example/taskly",
        "goal": "Show how fast it is to sign up and create a first project",
        "language": "en",
        "viewport": {"width": W, "height": H},
        "title": "Taskly",
        "steps": steps,
    }
    with open(os.path.join(OUT, "steps.json"), "w") as f:
        json.dump(step_file, f, indent=2)
        f.write("\n")
    print(f"Wrote {len(steps)} steps to {OUT}")


if __name__ == "__main__":
    main()
