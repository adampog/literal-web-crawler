# Literal Web Crawler 🕷️

A web crawler that actually crawls. A little spider walks across a page,
grips links and IDs with its feet, and tears them off as it goes.

It comes in two forms that share one engine:

- **In the browser** ([play it here](https://adampog.github.io/literal-web-crawler/)): the spider crawls a page
  of references, or anything you paste in.
- **As an [Omarchy](https://omarchy.org) plugin**: the spider crawls a
  snapshot of *your screen*, tearing glowing chunks out of your windows.
  Toggle it with a keybind, or let it be your screensaver.

Inspired by [this short](https://www.youtube.com/shorts/VKVA8yZ5gTw).

## Omarchy plugin

Needs Omarchy 4 (the Quickshell-based shell) and `grim`, which Omarchy ships.

### Install

```bash
omarchy plugin add https://github.com/adampog/literal-web-crawler.git
omarchy plugin enable io.github.adampog.literal-web-crawler
```

Plugins land disabled so you can read the code first. It runs inside
`omarchy-shell` with your user's permissions, like every Omarchy plugin.

### Keybind

Add this to `~/.config/hypr/bindings.lua`:

```lua
o.bind("SUPER + ALT + W", "Literal web crawler", "omarchy-shell shell toggle io.github.adampog.literal-web-crawler '{}'")
```

`SUPER + ALT + W` is free in Omarchy's default bindings. Press it again to close.

### Controls

| Key | Does |
| --- | --- |
| Click | Send the spider there |
| `F` | Switch between roaming and following the mouse |
| `Space` | Pause or resume |
| `R` | Repair the screen |
| `+` / `-` | Bigger or smaller spider |
| `[` / `]` | Rip less or more |
| `H` | Hide the key hints |
| `Esc` or `Q` | Close |

### Screensaver

The plugin replaces Omarchy's terminal screensaver once you switch that one off:

```bash
omarchy-toggle-screensaver
```

After `idle.screensaver` seconds (from `~/.config/omarchy/shell.json`,
150 by default) the spider appears on every monitor and starts eating
your desktop. Any key, click or mouse move closes it. The lock screen still
comes on at its usual time.

To keep the keybind but stop the spider screensaver:

```bash
touch ~/.local/state/omarchy/toggles/literal-web-crawler-screensaver-off
```

### Remove

```bash
omarchy plugin remove io.github.adampog.literal-web-crawler
```

## How it works

- [`core/crawler.js`](core/crawler.js) is the spider: steering, an
  alternating tetrapod gait (four legs move while the other four hold on, like
  a real spider), two-bone IK for the legs, and the physics of torn pieces.
  It is a plain script with no DOM or QML, so the browser loads it with a
  `<script>` tag and QML imports it directly.
- The engine asks a *host* for footholds and to tear things off. In the
  browser ([`web/app.js`](web/app.js)) every word is a foothold and every
  link or ID-looking word can be torn off.
- On the desktop, [`core/screen-map.js`](core/screen-map.js) finds
  high-contrast edges in a downscaled screenshot (mostly text and window
  borders) and uses them as footholds. Around each one it grows a word-sized
  "chunk" that a foot can rip out.
- [`Crawler.qml`](Crawler.qml) captures each monitor with `grim` and opens a
  [`CrawlerScreen.qml`](CrawlerScreen.qml) window per monitor.
  [`Service.qml`](Service.qml) watches for idle time and summons it as a
  screensaver.

## Development

The plugin needs no build step. To run the linters and tests, or to work on
the browser version, see [docs/development.md](docs/development.md).

## License

MIT
