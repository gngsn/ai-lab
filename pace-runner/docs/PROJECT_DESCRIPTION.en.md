<p align="center"><img src="assets/logo.png" alt="Run at your pace" width="480"></p>

# Run at your pace

**Demo:** https://run-at-your-pace.ai.studio

## Yesterday's 10K is today's game level.

The moment you stop your watch, your run turns into a thin line on a map and a handful of numbers. You sweat for that route, and then you look at it once and close the tab.

**Drop a GPX file into Run at your pace and the route you actually ran becomes a 3D running course in a soft pastel world.** The riverside path, the hill near your place, your usual park loop: this time you play it.

**Your pace is the game's speed.** The hill that left you gasping plays slow. The straight where you pushed plays fast. Run at your pace, literally.

---

## Who it's for

Casual runners and running crews who track every run on a phone or watch but almost never open the data again.

Most run logs get checked once and forgotten. They tell you your distance and pace, but they don't give you a reason to run that route again. Run at your pace takes the GPX file you already have and turns it into something you can reopen, replay, and build up over time. There is no new device to buy, no account to create, and nothing to log by hand. GPX is exported by the major running platforms, so most runners already have a file to start with.

## What's different

- **Your route is the level.** The course is built from the path you ran, including its bends, its distance, and the pace of each section, not from a premade map.
- **Your pace is the game's speed.** Slow stretches play slow, fast stretches play fast, and the stride follows.
- **Real run data stays in the game.** Per-km splits, average pace, and a route minimap sit alongside the coin-collecting game.
- **Your location data stays with you.** GPX parsing and all calculations run in the browser. Nothing is sent to a server.

---

## What you can do

**Drop a file, get a course.** Export a GPX from Strava, Garmin, Nike Run Club, or Apple Watch, drag it onto the page, and the course is ready to play right away. You can also export a course back out as GPX.

**Run it.** Your runner moves forward on its own, at the speed you ran that stretch, and you switch between three lanes to pick up coins. Coins come in straight and diagonal rows, hurdles are cleared with `Space`, and items like Magnet Fever pull coins toward you. Chain pickups for combos and fever. Coins, jumps, and lane changes each have their own sound, and you can mute them any time.

**Your pace is the game's speed.** The hill that left you gasping plays slow, and the straight where you pushed plays fast. Even the runner's stride keeps your rhythm. (Speed stays within about 0.75x to 1.45x of the base speed.)

**Pick the mood.** There are four themes: Pink Fluffy Meadow, Cloud Stride Autumn, Luminous Night Garden, and Riverside Felt Stroll. Each course gets a suggested theme, and you can change it.

**Change the view.** Press `C` to cycle through chase, front, side, aerial, and first-person cameras.

**Try it without a file.** Five Seoul courses are built in: Banpo Hangang Park, Seoul Forest and Hangang 10K, Namsan Loop, Olympic Park Mongchon Moat, and Yeouido Waterfront.

**Keep your records.** Your best score, coins, and time for each course are saved on My Routes, and My Stats shows total distance and your pace mix.

## It's still a real run log

- Distance, real elapsed time, and average pace
- A per-km split report, where clicking a split jumps to that point on the course
- Landmarks near the route
- A live minimap in the corner while you run (Google Maps if a key is set, otherwise a simple route map)

## The runners

<p align="center">
<img src="assets/03_hoodie.png" alt="Hoodie" height="260">
<img src="assets/01_sprout_smile.png" alt="Sprout" height="260">
<img src="assets/04_flower.png" alt="Flower" height="260">
<img src="assets/05_beanie.png" alt="Beanie" height="260">
<img src="assets/02_peach_xeyes.png" alt="Peach" height="260">
</p>

| Runner | Look |
|---|---|
| **Hoodie** | Mint bangs, yellow hood, always smiling |
| **Sprout** | A sprout on its head and a big orange smile |
| **Flower** | A pink and mint gradient body with a flower growing from the top |
| **Beanie** | Yellow beanie, rosy cheeks, orange dress |
| **Peach** | X eyes and a wide open grin |

## How to play

Open https://run-at-your-pace.ai.studio.

1. Pick a course on **My Routes**, or drop in a GPX file.
2. Check the distance, time, and pace in the course preview.
3. Choose a runner.
4. Wait out the 3-2-1 countdown and go.
5. Finish the course and your result is saved.

Controls: `←` `→` (or `A` `D`) to change lanes, `Space` to jump or use an item, `C` to change camera, `H` to hide the panel, `Esc` to leave a run.

## How it's built, and where it stands

- Built in Google AI Studio. The source is public at github.com/gngsn/RunAtYourPace.
- **Working now:** GPX import and export, the 3-lane 3D running game, five Seoul courses, four themes, saved records, split reports, and the minimap.
- **Not in the app yet:** it makes no AI model calls. Everything it does is ordinary rule-based code.

## Tech

- React 19, TypeScript, Vite, Tailwind CSS
- A 3D world built directly with three.js: courses are CatmullRom curves, and coins, trees, and buildings are drawn with instanced meshes to keep it light
- GPX parsing and distance and pace calculations all happen in the browser
- Optional Google Maps Platform minimap

## What's next

These are ideas, not features. None of them are built yet.

- Courses that use real elevation and the surroundings of the route
- Racing a friend's or a crew member's ghost
- Automatic sync with running platforms
