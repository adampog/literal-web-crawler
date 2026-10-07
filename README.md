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
| `/` | Open Wikipedia search (interactive mode) |
| `Esc` or `Q` | Close |

### Wikipedia search

Press `/`, type a Wikipedia article title and press Enter. Or use a second
keybind to open directly into search, without taking a screenshot:

```lua
o.bind("SUPER + ALT + SHIFT + W", "Wikipedia web crawler", "omarchy-shell shell toggle io.github.adampog.literal-web-crawler '{\"mode\":\"search\"}'")
```

The article replaces the screenshot. Matching search words are highlighted;
the spider seeks them and tears them before other words on the page. Use
PgUp/PgDown or the mouse wheel to read the next page, `/` to search again,
and `R` to restore torn words. Esc cancels a new search when an article is
already open; Esc from the article closes the overlay. Normal spider controls
still work outside the search box. The screensaver stays in screenshot mode;
any input closes it, including `/`.

Each submitted title makes one asynchronous HTTPS GET to English Wikipedia's
MediaWiki REST API (`/w/rest.php/v1/page/{title}/with_html`), identifying
`LiteralWebCrawler/1.0` and this repository in the User-Agent. Wikipedia sees
the title and the usual network information, including your IP address.
There are no background requests, parallel searches, or automatic retries.
A request is canceled after 12 seconds or when the overlay closes. Missing,
ambiguous, offline and other failed requests show a message in the search box.
Use an exact, specific article title rather than a general search question.

Only text and attribution from the REST response are displayed: no scripts,
images, styles or linked resources are loaded. The plugin lays out the article
as plain text, with paragraph breaks and pages. Responses over 4 million
characters are rejected; display is limited to the first 10,000 words (shown
when truncated). The source URL, revision and Wikipedia license appear above
the article. The text layout is an adaptation of Wikipedia content under its
displayed license, separate from this plugin's MIT code license.

The current article and its layout live only in memory until the next search
or closing the overlay. There is no article disk cache or search history file.
The existing temporary screenshots are still used only in screenshot mode.
Search is available in the Omarchy plugin; the browser build keeps its existing
page and paste behavior.

The desktop spider starts at scale 0.70; `+` and `-` still adjust it. Its new
leg proportions follow the widow's 1–4–2–3 order, with the front pair at 1.5×.

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
  a real spider), three-segment IK for the legs, and the physics of torn pieces.
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
