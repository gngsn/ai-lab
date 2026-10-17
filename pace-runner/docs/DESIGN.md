# Pace Runner — Design Specification

The visual and interaction design for Pace Runner. It is **mandatory**: the build must match it. It describes *what things look like*, never how to code them. Every colour is a hex value; every size is in CSS px (UI) or world units (3D, where the runner is about 1.8 units tall and the road is 9 units wide).

**Mood in one line:** a pastel, toy-like summer meadow at golden hour. Soft, rounded, friendly, never neon, never dark.

---

## 1. Design tokens

### 1.1 Colour
| Token | Hex | Use |
|---|---|---|
| ink | `#2b2233` | primary text, outlines, dark stripes |
| ink-soft | `#6b6275` | secondary text, captions |
| paper | `#fffaf2` | panels |
| paper-2 | `#fff3e3` | stat tiles, secondary buttons, chips on panels |
| card | `#fffaf4` | reward cards, stat cards |
| coral | `#ff8a7a` | primary button, logo, player dot, accents |
| coral-dark | `#f06a5a` | primary button lip shadow |
| coral-deep | `#f2677d` | start/finish dots, pin gradient end |
| pace-fast | `#3fc39a` | mint green; must read clearly against the grass |
| pace-steady | `#f5d04f` | yellow |
| pace-slow | `#f5a04f` | orange |
| pace-very-slow | `#ee6767` | red |
| lilac-shadow | `#8e72b8` | soft coloured shadows (used at 14–35 % opacity) |
| gel-red | `#e8414f` | energy gel, gel badges, energy bar |
| turbo-cyan | `#5fd3ff` | turbo pads, turbo screen flash |

Overlay backdrop for full-screen pages (My Routes, My Stats): a vertical gradient from `rgba(232,222,248,0.72)` (lilac, top) to `rgba(255,236,226,0.78)` (peach, bottom), with a 14 px backdrop blur over the 3D scene.

### 1.2 Typography (Google Fonts)
| Role | Font | Weight | Size |
|---|---|---|---|
| Logo / screen titles / panel titles | **Hanalei Fill** (single weight, never fake-bolded) | 400 | logo: `min(13vw, 22vh)` desktop, `min(22vw, 16vh)` mobile, line-height 0.92; page titles: `clamp(48px, 8vw, 84px)`; panel titles: 34 px |
| Everything else | **Lexend** | 400–800 | body 15–18 px; buttons 17–20 px, 600; stat values 18 px, 600; captions 12–13 px |
| Eyebrow labels | Lexend | 600 | 13 px, letter-spacing 0.18em, ink-soft |
| Numbers (timer, stats) | Lexend | 600–700 | tabular figures |

All copy is **English**. No text effects on titles (no outlines, gradients or 3D).

### 1.3 Shape and depth
- **Radii:** panels 28 px; cards 26 px; stat tiles 14 px; badges and pills fully round (999 px); item slots 18 px.
- **"Lip" shadow (toy feel):** solid, no blur, offset straight down. Buttons 5 px; chips 4 px; cards 6 px. The colour is `rgba(43,34,51,0.07–0.15)`, or coral-dark for primary buttons.
- **Soft lift:** cards add `0 18px 34px rgba(142,114,184,0.14)`; panels add `0 20px 40px rgba(43,34,51,0.12)`.
- **Press:** buttons move 3 px down and the lip shrinks to 2 px. **Hover:** lift by 2–4 px.

### 1.4 Components
| Component | Look |
|---|---|
| Primary button | coral fill, white Lexend 600, pill, 5 px coral-dark lip |
| Secondary button | paper-2 fill, ink text, pill, 5 px neutral lip |
| Back button | 40 px circle, paper-2 (or 80 % white on overlays), "←" |
| Chip (HUD) | `rgba(255,250,242,0.92)` pill, 4 px lip, Lexend 600 |
| Badge | small pill, 12 px, 700: **New** lilac `#e6dcff` / `#5b3fa0`; **★ best** butter `#ffe9a8` / `#8a5a00`; **coins** paper-2 with an orange "$"; **gels** pink `#ffdbe0` / `#b8283a` |
| Stat tile | paper-2 rounded tile: 12 px ink-soft label above an 18 px value |
| Card | card colour, 26 px radius, lip + soft lift; on hover lifts 4 px and tilts −0.4° |

---

## 2. Screens

Layouts are given for **desktop (≥ 721 px)** and **mobile (≤ 720 px)**. The 3D scene always fills the background.

### 2.1 Home
- **Desktop:** text block on the left, about 52 % of the width, padded 7 vw from the left edge, over a left-to-right paper fade (85 % → transparent at 70 % of the width). From top to bottom:
  - the logo "PACE / RUNNER" on two lines in coral;
  - the tagline "The route you ran becomes the course." (Lexend, ~20–26 px, ink-soft);
  - a full-width (max 480 px) primary button **My Runs**;
  - under it, a secondary button **My Stats**.

  The **main runner** stands on the right of the screen, idling on the road, with the camera slowly swaying around its front.
- **Mobile:** the character is in the upper half. The logo, tagline and both buttons sit at the bottom over a bottom-to-top paper fade.
- No eyebrow line and no extra marketing copy.

### 2.2 My Routes (the runner's rewards — the centrepiece)
- **Overlay page** with the lilac→peach backdrop. Centred header:
  - a back button at top-left and a secondary **My Stats** button at top-right;
  - the eyebrow "Every run you finish becomes a course";
  - the title "My Routes" in Hanalei Fill;
  - the summary line "`N` routes · `X` km · `M` raced".
- **Grid:** auto-fill columns at least 250 px wide, max width 1120 px, 18 px gaps. On mobile, exactly 2 columns with 12 px gaps.
- **Route card:**
  - **Art area** (4:3): a soft two-colour pastel gradient. The tint cycles per card: pink→blue, blue→butter, butter→pink, mint→lilac. A white radial highlight sits at the top-left. The route is drawn on it in the map style (§5). A teardrop pin sits at top-left, and a white pill distance tag (e.g. "9.9 km", 13 px 700) at top-right.
  - **Info area:**
    - the run name (Lexend 18 px 700);
    - the date (13 px, ink-soft);
    - a row "⏱ 54:12   ↗ 5'28"/km" (15 px, 600, tabular);
    - a badge row.
- **Last card:** "+ Add a run" as a dashed lilac border (3 px, 45 % opacity) with no fill. It has a 54 px white circle "+", "Add a run" (lilac `#6b5a8e`, 700) and "Upload a GPX file". Tapping it opens the file picker.
- Cards stagger in from 18 px below, 50 ms apart.

### 2.3 Course preview
- **Desktop:** a single panel (max 440 px) docked on the right, about 5 vw from the edge, vertically centred. Behind it, the 3D camera slowly orbits high above the whole course.
- **Mobile:** the panel docks to the bottom at full width.
- **Panel contents, top to bottom:**
  - the date (eyebrow) and the run name (Hanalei Fill 34 px);
  - the route map (§5) at aspect ~1.35, with a 20 px radius;
  - a 3-tile stat row: Distance / Real time / Avg pace;
  - the pace legend: 2×2 rows of a colour pill, the label (Fast / Steady / Slow / Very slow) and the real pace range;
  - the how-to hint (14 px, ink-soft);
  - the primary button **Run this course**.

### 2.4 Character select
- **Panel:** max 660 px, docked like the preview.
  - The eyebrow is the course name, the title is "Who's running?".
  - **5 character cards** sit in one row on desktop and in a 3 + 2 grid on mobile.
  - The primary button **Start running** is at the bottom.
- **Character card:**
  - **Thumbnail:** a square with a 14 px radius on a sky→peach gradient, `#d9effa` → `#fff3e3`, showing the 3D character in a ¾ idle pose.
  - **Text:** the name (Lexend 600) and a one-line blurb (12 px, ink-soft).
  - **States:**
    - **Selected:** a 3 px coral border and a white background.
    - **Main runner:** a small coral "Main" pill under the blurb.
- **Camera:** on wide screens the camera pans so the 3D character stands to the **left** of the panel. Picking a card swaps the character with an elastic squash-pop (it starts 0.6 wide × 1.3 tall and springs to 1:1 in 0.6 s).

### 2.5 My Stats
Overlay page like My Routes, with the title "My Stats" and the eyebrow "Your running at a glance". Cards sit in a 2-column grid (1 column on mobile):
1. **Main runner** (full width): the same 5 character cards; the chosen one has a coral border and a "Main" pill.
2. **Running summary:** a 2×3 grid of stat tiles: Total distance, Total time, Runs, Avg pace, Longest run (with the run name as an 11 px caption), Fastest run (with its name).
3. **Pace mix:** a 22 px tall rounded stacked bar in the four pace colours, sized by share of distance, plus a 2×2 legend with percentages.
4. **Course bests** (full width): one white row per course containing:
   - a medal (🥇 / 🥈 / 🥉, or a grey "·");
   - the name with km underneath;
   - the best time in bold tabular figures, or "Not raced";
   - a paper-2 pill "$ best/total".

### 2.6 Race HUD
- **Top-left stack:**
  - a time chip (30 px, tabular) and a coin chip with a coin icon and "`n` / total" (the total in 14 px ink-soft);
  - under them, an **effect bar** while an item is active: a pill with a small icon, the label and a white progress track. It is gel-red for "Energy boost", banana-yellow `#e0a81e` for "Grip" and muscat-green `#6fae2a` for "Sprint", each with a darker 4 px lip;
  - the **gap box**: a 230 px card with a 13 px label ("Side by side with past you" / "48m ahead of past you" / "12m behind past you") and a 10 px track with a centre tick. It fills right in mint when ahead, and left in orange, turning red as the gap nears game over.
- **Top-right:**
  - the minimap (190 × 160 desktop, 120 × 100 mobile; §5, faint streets, no pin);
  - an 8 px coral progress bar;
  - a small round ✕ quit button.
- **Bottom-left:** **3 item slots**, 64 px square, 18 px radius.
  - **Empty:** a dashed outline.
  - **Filled:** a white border, a 4 px lip and the item icon.
  - A tiny ink key hint sits on the corner: "Space", "2", "3".
  - "Bag full — use an item!" fades in above the slots in gel-red.
- **Bottom-centre** (bottom-right on mobile, stacked): the pace chip (zone dot + "Slow · real 5'22"") and a speed chip ("20.0 km/h").
- **Centre:** the countdown "3, 2, 1, GO!" in huge white Lexend with a coral offset shadow. It scales in from 1.6 and GO! fades out.
- **Banners:** "5K ENERGY GEL!", "BANANA GRIP!" and "SHINE MUSCAT SPRINT!" show at about 22 % from the top (smaller, with a red offset shadow) and fade after about 1 s.
- **Edge flashes** (radial vignettes): cyan for turbo, red for leaving the road, pink when an item is used.
- **Touch devices:** faint ◀ ▶ hints near the bottom corners.

### 2.7 Result and game over
- **Result:** a centred panel with these elements, top to bottom.
  - **Heading:** an eyebrow of "FINISH" or "NEW RECORD", then a title of "Finished!" or "New record!".
  - **Time:** in coral (64 px, tabular).
  - **Comparison line:** "x.xxs faster than past you!".
  - **Stat tiles (3×2):** Equiv. time, Equiv. pace, Coins (★ if it's a new best), Turbo · Items, Off road, Best.
  - **Buttons:** **Courses** (secondary) and **Run again** (primary).
- **Game over:** the eyebrow "GAME OVER", the title "Past you got away", one encouraging sentence with the % reached, and **Courses** / **Try again**.

### 2.8 Toast
A dark ink pill at the bottom centre with white 15 px text. It slides up 20 px and fades in, then disappears after about 2.6 s.

---

## 3. 3D art direction

### 3.1 World
- **Sky:** a vertical gradient dome from horizon `#ffe6cc` (peach) to zenith `#8ecbf0` (soft blue). There is **no sun disc**.
- **Fog:** linear, peach `#ffe6cc`, 70–320 units in the race. It retargets smoothly for wide overview shots.
- **Light:**
  - a hemisphere light, sky `#cfe9ff` over ground `#8dbf6a`, intensity 1.6;
  - a warm directional "late afternoon" sun `#fff1d6`, intensity 2.2, high and to one side, casting soft shadows near the player.
- **Shading:** **toon / cel shading with 3 soft steps.** Everything is matte. Nothing is metallic or glossy except tiny white glints on eyes and grapes.
- **Ground:** flat pastel grass `#9fd47a`, extending far past the course.
- **Grass blades:** dense tufts along both road shoulders (out to about 16 units). Each is a tapered 3-segment blade, dark `#5f9f45` at the base to light `#d8f0a0` at the tip, with gently varied hue. They **sway in a slow wind**: about 1.7 Hz plus a faster flutter, stronger at the tips, phase varying across the field.
- **Flowers:** small faceted blobs in white `#ffffff`, pink `#ffb3c7`, butter `#ffe17a` and lilac `#c9b6ff`, scattered near the road.
- **Lollipop trees:** a tapered tan trunk `#b98a62` with a big round faceted crown. Most crowns are greens (`#7cc26b`, `#94d070`, `#6db86a`); about 1 in 5 are blossom pink `#f6b8c8` or amber `#ffd38a`. Sizes vary from 0.8 to 1.5×. They stand 5–75 units from the road, never on it.
- **Bushes:** squashed round green blobs (`#6fb35a`, slight hue jitter) close to the shoulders.
- **Clouds:** 26 puffy clusters of 4–7 white balls, high in the sky. They are not affected by fog, so they stay crisp white.

### 3.2 Road
- **Surface:** 9 units wide, coloured by pace zone (the pace colours lifted 10 % toward cream `#fff8ec`). Colours blend smoothly where zones change.
- **Edges:** a sandy shoulder `#efdfc0`, 0.9 units wide, on each side, and a thin white edge line just inside each edge.
- **Overlapping passes** (out-and-back, U-turns): they read as **two side-by-side lanes with a strip of grass between**, joined by a rounded U. A crossing reads as a clean crossing. The stretch the runner is on is always drawn on top.
- **Start and finish:** a white stripe across the road at the start, and a dark `#333344` stripe at the finish. The finish has a **white arch**: two rounded pillars about 5.8 units tall, with a chunky banner across the top printed in a black-and-white checkerboard.
- **Turbo pads:** flat 3.2 × 4.5 rectangles in turbo-cyan with two white chevrons pointing forward, **scrolling forward** continuously. Used pads fade to 15 %.

### 3.3 Camera
- **Race:**
  - **Position:** behind and above the runner (about 8.5 back, 4.2 up), following the runner's smoothed heading so it swings calmly through hairpins. It looks about 10 units ahead at knee-to-hip height.
  - **Field of view:** 58°, widening slightly with speed, plus 10° during turbo and 4° while energized.
  - **Shake:** a small camera shake when leaving the road.
- **Intro:** from the overview shot, a smooth swoop down to the chase position (about 1.3 s), then the countdown.
- **Finish:** a slow orbit (about 6 units out) around the celebrating runner.
- **Menus:** a close, slow sway around the character's front; overview shots orbit high over the whole course.

---

## 4. Characters

All five are **soft toys built from simple rounded shapes**, matte, with gradients that run bottom → top across a part.

### 4.1 Shared rules
- **Proportions:** they stand about 1.6–2.1 units tall. Heads are big relative to bodies. Limbs are short and tube-like, with ball or bean shapes at the ends (hands, boots).
- **Rig:** one rig for all — body, head, two arms hanging from the shoulders, two legs from the hips.
- **Animation:**
  - **Run:** legs swing alternately and arms counter-swing. The stride gets faster with speed but caps out (toy legs). The body bobs, leans into steering and pitches forward, more during turbo.
  - **Idle:** a small bounce, with the head looking slowly left and right.
  - **Celebrate:** a bouncy jump with both arms straight up.
- **Ghost "Past You":** the same character, rendered as a flat, translucent pale blue `#bfe6ff` silhouette (about 40 % opacity) with no face details. It always runs in the lane to the runner's left. When it is **just behind the runner** (between the runner and the chase camera), it fades out completely within about 4 units, so it never blocks the view.
- **Faces:** facial features sit **on the front surface** of the head and are clearly visible, never sunk inside it.

### 4.2 The five runners
| Name · blurb | Look |
|---|---|
| **Hoodie** · Mint hood kid *(default main runner)* | A big round hood that runs pale butter-yellow `#ffe8a8` → `#ffe2a0`, with a thick rolled rim around a round peachy-pink face `#f6c1b4`. **Two teal bangs** `#7fd7d2` part in the middle of the forehead. **Googly eyes** (white with black pupils), pink cheeks and a small smile. A round body graded **mint `#5fcfcb` → pale mint → butter `#ffe6a4`** with two teal hoodie drawstrings. **Puffy sleeves** graded mint → butter, with tiny pink hands. Thin pink legs and **mint rain boots** with butter tops. Slightly smaller overall (0.85×). |
| **Sprout** · Leafy smiler | A big **bulb head** graded **teal-mint `#5fcfc4` → pale green `#cfe8b4` → butter `#fbecbc`**. On top: **two lilac/pink rings** (`#dca6ef`, `#f3c4f0`) and **three leaf sprouts** graded green `#a8d98a` → pale yellow. **Closed happy ∩ eyes**, a small orange nose `#f07d5e` and **plump coral lips** `#f2876a`. Body graded **purple `#c27be0` → pink → peach**, with pink shoulder pads. Mint arms and legs `#79dccb`, yellow cuffs and pink boots `#e7a6f2`. Scale 0.82. |
| **Dizzy** · Giggly sprout | A big **bulb head** graded **orange `#f19f68` → apricot → butter `#fbd98f`**. On top: **two teal rings** and **four pale-yellow leaves** fanning out. **✕✕ eyes** (two crossed dark bars each) and a **big open laughing mouth**: a red bowl `#e5435a` with a pink tongue `#ff8f9c` and a darker lip line, bulging slightly out of the face. A teal round body `#3fb5b0` with lighter teal shorts and round shoulder caps. **Long pink arms and legs** `#f4b8b2`, yellow cuffs `#f6c46a` and coral boots `#ee8b68`. Scale 0.82. |
| **Bloom** · Walking flower pot | The **head is the whole body**: an open-topped pot-sphere graded **pink `#e58fdc` → lilac `#cdb3e6` → mint `#9fd9d6` → mint `#7fdcc8`** from bottom to top. It has a mint rim, a dark-green soil disc and a **crown of seven mint leaves** leaning outward. From the pot rises a **curved stem with a six-petal pink flower** `#e78ae8` and a yellow centre `#f6d44a`. **Glossy black bead eyes** with a tiny white glint, and **plump yellow lips** `#f6d23f`. **Long, thin pink arms** `#f3b9df` that hang straight at the sides, and thin pink legs with pink→mint boots and mint cuffs. Scale 0.82. |
| **Beanie** · Cozy beanie walker | A round **teal head** `#3db4b8` wearing a **pale-yellow beanie**: a domed top `#f8dfa2` and a thick rolled brim `#fae5b0`. **Googly eyes**, pink cheeks and a smile. A **bell-shaped body** (wide at the hem, narrowing up to the neck) graded **coral `#f19478` → peach `#f6b07f` → butter `#fbd88e`**. Short peach sleeves, teal arms and hands, thin teal legs, butter cuffs and peach boots `#f39f74`. Scale 0.85. |

### 4.3 Thumbnails
Each character is shown on its card as a real render of the 3D model: a ¾ view from slightly above, the whole figure with headroom (leaves and flowers never cropped), on the sky→peach card gradient.

---

## 5. Route map style ("track on a street map")

Used on route cards, in the course preview and (more subtly) in the HUD minimap. North is up.

- **Streets:** a faint street network in the background, unique per route but stable.
  - Two near-perpendicular families of broken, slightly bent streets, plus short alleys.
  - Each street has a faint lilac edge, a soft blurred white body and a thin bright white core.
  - It fades out toward the edges like a vignette.
  - Strength: full on cards and in the preview, about 60 % in the HUD.
- **Track:** a soft coral glow (cards and preview only) under a white casing, with the line on top coloured by pace zone. It is 5 px on cards and preview, 3.5 px in the HUD.
- **Gels:** small red rounded rectangles with a white outline.
- **Start and finish:** round **coral dots** with a coral→deep-pink gradient, a white rim and a soft pink shadow. The **finish dot has a white centre**.
- **Pin:** a teardrop **map pin** at top-left (cards and preview), graded yellow `#ffc46b` → deep pink `#f2677d`, with a white hole.
- **Clearance:** the route never touches the corner tag or the pin; leave about 44 px of top padding on cards.
- **HUD extras:** a coral player dot and a pale-blue ghost dot, both with an ink outline.

---

## 6. Pickups and items

| Item | Look | Motion |
|---|---|---|
| **Coin** | An upright **soft matte toy coin** (radius 0.7, thick): orange edge band `#f39a3d`, slightly orange face `#fdbd4e`, and a thick pale-gold rounded rim `#ffd668` with a **raised "$"** on both sides. Tilted slightly forward. | Floats at about 1.1, bobs gently, spins. When collected it pops up and shrinks away in about 0.3 s. |
| **Energy gel** | A **soft pouch**: red body `#e8414f`, pink band and shoulder `#f4899a`, light pink tear-off cap `#f8a9b4`. A white label reads "ENERGY / **GEL** / ⚡" with the km mark, for example "5K". It is generic, with **no brand logo**. Scale about 1.6×. | Floats at about 1.8 with a gentle sway, over a pulsing pink ring on the ground. When picked up it rises and vanishes in about 0.4 s. |
| **Banana** | A curved yellow banana `#ffd84d` with a brown stem tip and a green end. | Floats at about 1.3, spins and bobs, over a pulsing butter ring. |
| **Shine muscat** | **One** glossy pale-green grape `#b8e86a` with a small white glint and a short stem. | Same as the banana, with a pale-green ring. |
| **Item slot icons** | Flat, friendly versions of the three: a red pouch with a lightning bolt, a yellow crescent banana, a green grape with a highlight. | The slot pops (1.35× → 1×) when an item lands in it. |

---

## 7. Motion and sound

### 7.1 Motion
- **Screen changes:** fade in over 0.35 s, and panels rise 24 px with a slight overshoot ("back-out") over 0.5 s.
- **Card hover:** lift and tilt in 0.18 s. **Button press:** 0.12 s.
- **Countdown digits:** scale 1.6 → 1 with a strong overshoot.
- **No motion is jarring:** cameras and colour changes always ease. Nothing flashes at full white.

### 7.2 Sound
All sounds are short synthesized tones, soft and cheerful, with no harsh noise:
- **Countdown:** ticks, then a brighter "GO".
- **Coin / item pickup:** a two-note chime.
- **Item use:** a rising arpeggio.
- **Turbo:** a short upward sweep.
- **Leaving the road:** a low bump.
- **Finish:** a rising four-note fanfare.
- **Game over:** three descending notes.

---

## 8. Design acceptance checklist

Capture each item at **1280×800** and **390×844** and compare it with this document.

1. The home screen shows the coral Hanalei Fill logo on two lines, one tagline, **My Runs** (coral) and **My Stats** (cream), and the main runner on the right (desktop) or on top (mobile).
2. The meadow is pastel with swaying grass, round lollipop trees (mostly green, some pink and amber), white puffy clouds, and a peach-to-blue sky with peach fog. It is never dark or saturated.
3. Route cards show the street-map art, coral glow, coral start/finish dots (white-centred finish), a pin at top-left and a km tag at top-right, with the route clear of both.
4. All five characters match §4.2, and none of their faces is hidden inside the head.
5. The road shows four distinct pace colours, with the mint clearly different from the grass. It has sandy shoulders and white edge lines, and the finish arch is checkered.
6. Out-and-back routes read as two lanes with a rounded U, and crossings are clean.
7. Coins are matte gold toy coins with a raised "$"; the gel pouch has no brand logo; the banana and the single grape are instantly recognisable.
8. HUD positions match §2.6, nothing overlaps on mobile, and the item slots are thumb-reachable.
9. Every title is Hanalei Fill without effects, and all other text is Lexend. All copy is English.

---

## 9. Inspiration (look and feel only)

These references set the direction. **No assets, code, sounds or text come from them.** Everything is made from scratch.

| Reference | What to take from it | What not to take |
|---|---|---|
| **Summer Afternoon** by Victor Lucendo, https://summer-afternoon.vlucendo.com/ | The mood: pastel colours, soft toon shading, wind-blown grass, round "lollipop" trees, warm golden-hour light, gentle fog, a calm and nostalgic feel | Its scene, models, characters, multiplayer or any asset |
| **Montblanc Legend Blue — "The Run"**, https://therun.montblanclegend.com/ | The game feel: auto-forward along a spline road, left/right steering only, turbo pads, slowing at the road edge with a camera shake, 3-2-1-GO countdown, time attack against a best time, cinematic finish | Any branding, logos, the car, product imagery, sounds or copy |
| **Fonts**: Hanalei Fill https://fonts.google.com/specimen/Hanalei+Fill and Lexend https://fonts.google.com/specimen/Lexend | Typography (§1.2) | — |

Character, coin and route-map designs were drawn after reference images that are **not** distributed (some carry stock watermarks). Use §4, §5 and §6 instead. Never put third-party stock images in the repository or the video.
