# Changelog

## 1.1.7

- Cap Wikipedia responses at 4 MB with curl, including chunked transfers.

## 1.1.6

- Prevent a canceled screenshot capture from reopening the overlay, and finish
  cleanup before another capture. Screenshots require a private runtime directory.
- Keep the current Wikipedia article when another search fails or is canceled.
- Share torn-piece cleanup, remove unused engine fields, and check release versions agree.

## 1.1.5

- Plan sideways steps and body turns together so the rear legs keep a relaxed
  pose instead of folding inward or making clipped corrective swings. Moving
  pointer corrections use short lateral steps; sustained destinations turn the
  spider toward the target before walking. Straight walking is unchanged.

## 1.1.4

- **Back legs no longer splay on sideways movement.** During sideways pans, turns
  and roaming, legs 3 and 4 stay inside the range a straight walk already uses
  (leg 3 about 84-128°, leg 4 about 111-153° from the heading). They no longer
  swing out toward perpendicular. Leg lengths, step order and tetrapod gait are unchanged.

## 1.1.3

- **Optional Arch marking.** Set `marking: "arch"` on this plugin's entry in
  `shell.json` for a red translucent Arch Linux triangle. The hourglass remains
  the default; missing or invalid settings fall back to it. Settings are read-only.

## 1.1.2

- **Back legs stay beside the body on sideways pans.** The rear feet no longer
  sweep as far behind the body while it changes direction. Their rearward
  excursion is capped at 155°, with the same leg lengths and tetrapod gait.

## 1.1.1

- **Back legs step properly.** The back pair no longer drags: its planted feet
  stay put while the body turns, it steps with its own group instead of
  stalling the body, and it reaches out behind the body less far (rear leg
  angle 150° to 140°). Leg lengths are unchanged.

## 1.1.0

- **Black widow look.** The spider keeps its see-through style, now with a
  strong red hourglass, head and body joined, three-segment legs, and legs in
  a widow's length order (front pair 1.5×). The desktop spider starts a little
  smaller, at scale 0.714; `+` and `-` still resize it.
- **Lifelike gait.** The body follows four planted feet, so it never glides.
  Swinging legs lift and arc, reach and tap before they grip, and the knees
  bend. Pauses alternate with bursts.
- **Faster spider.** A click across half a wide screen now takes about 8 s,
  against about 28 s before.
- **Wikipedia search.** Press `/` in the overlay, or use a second keybind, to
  search for a Wikipedia article. The article replaces the screenshot, with
  your search words highlighted and torn first. Each search makes one HTTPS
  request to Wikipedia, and the article is shown as an adaptation under
  Wikipedia's CC BY-SA licence, with attribution. See
  [Wikipedia search](README.md#wikipedia-search) in the README.
- **Screensaver.** An idle screensaver trigger now leaves an already-open
  overlay alone.

## 1.0.0

- First release: the spider crawls a web page in the browser, or your Omarchy desktop as an overlay and screensaver.
