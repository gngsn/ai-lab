# Medal collection — build plan

Working name: Medal Shelf. Branch: `feat/medal-collection`.

## Product and first release

A mobile-first website where runners turn physical race medals into a personal digital collection and attractive images they can share. The main journey is: photograph a medal → approve its cutout → add race details → save to a shelf → export a celebration card.

Start with individual recreational runners, including marathon and half-marathon finishers. Support other distances through a custom distance field. Treat race details as self-reported; a medal photo is not proof of a result.

MVP screens:

- Landing page with an example collection and an “Add your first medal” action.
- Sign-in and a private collection, with a grid of medals and filters by year and distance.
- Add-medal flow: camera/gallery, image preview, background removal, crop/rotate, race details, save.
- Medal detail: large image, event name, date, distance, optional finish time, location, and personal note; edit/delete actions.
- Share studio: single medal or collection, template selection, optional name/time, image preview, download/share.
- Optional public profile at `/u/{handle}`, containing only medals explicitly made public.

Keep social feeds, leaderboards, Strava integration, automatic result verification, 3D scanning, payments, and a native mobile app outside the first release.

## Mobile-first requirements

Mobile friendliness is a launch requirement. Design and validate the complete experience on phones before adapting layouts to desktop.

- Support narrow screens from 320 CSS pixels upward without horizontal scrolling. Use a two-column medal gallery where space permits and a single-column upload/edit flow.
- Use bottom navigation for Collection, Add Medal, and Profile, with primary actions within easy thumb reach. Provide at least 44 × 44 CSS pixel touch targets, visible focus states, readable type, and sufficient contrast.
- Respect device safe areas and the on-screen keyboard. Keep Save/Continue controls accessible without covering form fields; preserve entered details when moving between upload steps.
- Provide separate camera and gallery entry points. Preview the chosen photo before upload, show progress, and support retry after connection loss without losing race details.
- Load appropriately sized gallery thumbnails, reserve image space to avoid layout shifts, and lazy-load off-screen medals. Test on a mid-range phone with a throttled mobile connection.
- Make the share preview fit the screen, with large Download and Share actions. Explain the download-to-Instagram flow in a short, dismissible hint.
- Treat real-device iOS Safari and Android Chrome checks as release gates, including camera permissions, HEIC photos, rotation, keyboard behavior, slow uploads, and Story image export. Desktop-only testing is insufficient.

A responsive website is the initial delivery format; installable PWA support can follow once the core phone experience is validated.

## Best upload approach

Recommendation: guided single-photo upload with automatic background removal and a mandatory preview. This preserves the runner’s actual medal and works without building a race catalog first. This is a provisional product recommendation; test cutout quality on real medals before committing to a provider.

| Approach                           | Benefit                                                   | Limitation                                                    | Decision                           |
| ---------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------- |
| Photo with background removal      | Personal, supports any medal, consistent shelf appearance | Reflective edges, holes, and ribbons can confuse segmentation | MVP default                        |
| Original photo with crop           | Reliable fallback and minimal processing                  | Less consistent presentation                                  | Always available                   |
| Choose a medal from a race catalog | Very fast and consistent                                  | Requires licensed assets and accurate year/distance variants  | Later, with organizer partnerships |
| 3D scan or multiple photos         | Rich interactive presentation                             | High effort and processing complexity                         | Defer                              |

Upload experience:

1. Offer both “Take a photo” and “Choose a photo.” Show a short example: one medal, plain contrasting background, diffuse light, camera directly above it. Let users include the ribbon if desired.
2. Show a local preview immediately; allow rotation and crop. Initially accept JPEG, PNG, WebP, and HEIC/HEIF, with a proposed 20 MB limit. Verify actual HEIC decoding and orientation on iPhones during the spike; provide an actionable conversion message if unsupported.
3. Normalize orientation, constrain pixel dimensions, and strip location/EXIF metadata from stored display assets. Validate decoded content and limits on the server, not just the browser.
4. Upload directly to image storage using server-authorized, constrained upload parameters. Keep credentials server-side and associate the asset with its owner.
5. Remove the background asynchronously. Preserve the normalized source and show an explicit processing state; users can enter race details while waiting.
6. Preview the transparent result on light and dark backgrounds. Offer “Use cutout,” “Use original,” and “Retake.” Avoid generative reconstruction that could change medal lettering or shape.
7. Save only after confirmation. Processing failures must not prevent saving the original image. Retry transient failures without creating duplicate medals or repeat charges.

Start by evaluating Cloudinary because its documented upload and background-removal capabilities cover the core flow. Do not assume its segmentation handles medals well: benchmark at least 30 permissioned images covering shiny metal, ribbons, openwork, dark medals, busy backgrounds, and rotated HEIC photos. Proposed gate: at least 90% usable cutouts without touch-up; otherwise compare another segmentation provider and retain the original-photo fallback. Record latency and processing cost per accepted medal before selecting a production plan.

## Display and sharing

Use a restrained gallery with large medal cutouts, soft shadows, and race captions. Show collection count and distance totals only from completed race entries; do not imply official verification. Include accessible text labels and keyboard controls.

Ship three templates: single-race celebration, collection grid, and annual recap. Provide 1080 × 1920 portrait images for Stories and 1080 × 1080 square images. Let the runner hide their name and finish time. Keep critical content away from the top and bottom and verify placement inside the Instagram app.

Render from a shared template definition using a server image renderer, bundled fonts, and owned image assets. Cache exports by medal revision and template settings. Generate the image before enabling the share button so the actual share call runs directly from a user gesture.

Use `navigator.canShare({ files })` before offering file sharing through `navigator.share`. Browser/OS/app combinations determine available targets; always provide PNG download and a separate public-link copy action. The dependable Instagram path is: download image → open Instagram → select image for a Story. Do not promise direct Story publishing from the website. Meta’s Stories documentation could not be retrieved during this research; recheck it if native integration is considered.

## Proposed architecture

Use an independent app inside `medal-collection/` rather than modifying the existing projects.

- Next.js and TypeScript for the responsive UI, server endpoints, and image-export routes.
- Supabase Auth and Postgres for accounts and collection records, with owner-based row-level access policies.
- Cloudinary provisionally for uploads, normalized sources, cutouts, and derived sizes; isolate vendor calls behind an image service module.
- A durable image-job record plus provider callbacks or a worker for processing and retries. Verify webhook signatures and make completion idempotent.
- Vercel as a proposed deployment target; validate runtime and image-rendering limits during the initial spike.

Data model:

- `profiles`: account ID, unique handle, display name, public-profile setting.
- `medals`: owner ID, race name/date, distance in meters, optional duration in seconds, location/note, visibility, selected image, timestamps.
- `medal_assets`: owner/medal IDs, provider asset ID, source/cutout kind, dimensions, processing state, retention status.
- `image_jobs`: asset ID, status, attempts, provider job ID, error category.
- `share_exports`: owner ID, selected medal revisions, template/options, asset reference, expiry.

Require ownership checks on every mutation and export. A public profile must query only explicitly public fields and medals. Use authenticated asset delivery for private images; an obscure CDN URL alone is not privacy. Verify delivery and cache behavior before choosing the image provider configuration.

Apply per-account upload/processing quotas, orphan-upload cleanup, and deletion of originals, derivatives, and exports when a medal/account is removed. Explain that downloaded or externally shared images cannot be recalled. Keep private image URLs and personal notes out of analytics.

## Delivery sequence

Indicative estimate: 4–5 weeks for one experienced full-time developer; provider setup, design iterations, and beta feedback may change it.

| Phase                   | Work                                                                                                         | Exit condition                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 1: validate, 2–3 days   | Phone upload prototype; 30-image cutout benchmark; HEIC and browser-sharing experiments; one export template | Provider choice backed by quality/cost measurements; real iPhone and Android export demonstrated      |
| 2: collection, 4–5 days | App setup, authentication, schema/access controls, medal CRUD, responsive gallery                            | Two users can manage independent private collections; cross-account access rejected                   |
| 3: upload, 4–5 days     | Signed uploads, normalization, async processing, approval UI, retries, fallback and deletion                 | Photo → saved medal works on mobile, including failure and interrupted-upload paths                   |
| 4: sharing, 4–5 days    | Three templates, image renderer, downloads, share sheet, public-profile opt-in                               | Export dimensions/fonts correct; files usable in Instagram; private medals excluded from public views |
| 5: beta, 3–5 days       | Accessibility, slow-network checks, cost monitoring, onboarding refinements; recruit 10–20 runners           | No blocking upload/share defects; measured activation and image-processing costs                      |

## Validation and launch decisions

Prioritize end-to-end checks for add/edit/delete, cross-user authorization, private/public transitions, expired upload authorization, duplicate callbacks, failed processing, and rendered export output. Test iOS Safari and Android Chrome on real devices, plus desktop Chrome/Safari. Include missing fields, long race names, non-Latin text, image orientation, and poor network conditions.

Measure upload started/completed, cutout accepted/fallback, first medal saved, export generated/downloaded, and share-sheet outcome. A share-sheet result does not prove an Instagram publication. Track processing p50/p95 latency, error rate, storage/egress, and cost per accepted medal.

Proposed beta targets: 80% of test runners save a first medal without help; median first-medal flow under two minutes; 90% usable cutouts on the benchmark; at least half of beta runners export a card. These are targets to validate, not forecasts. Set a monthly spending ceiling before opening uploads broadly.

The first implementation task is the photo-to-share prototype: one real medal photo → approved cutout → Story-sized PNG. Validate the distinctive experience before expanding the application.

## Research references

- [Cloudinary background removal](https://cloudinary.com/documentation/background_removal): documented automatic foreground segmentation; medal-specific accuracy remains untested.
- [Cloudinary image uploads](https://cloudinary.com/documentation/upload_images): upload integration options and server/client responsibilities.
- [MDN Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API): system sharing and capability detection.
- [MDN navigator.share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share): file sharing, user activation, and compatibility constraints.
