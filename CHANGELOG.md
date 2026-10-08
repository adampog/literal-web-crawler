# Changelog

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
