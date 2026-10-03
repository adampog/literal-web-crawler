import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io

// Overlay entry point for the Literal Web Crawler plugin.
//
// Opening it takes a screenshot of every monitor with grim, then shows one
// fullscreen CrawlerScreen per monitor on top of that frozen picture, with a
// spider walking across it. The overlay never touches your real windows: the
// spider tears pieces out of the screenshot only.
//
// Summoned two ways:
//   - a keybind runs `omarchy-shell shell toggle <id>`        -> interactive mode
//   - Service.qml summons it with {"mode":"screensaver"} on idle -> any input closes it
Item {
  id: root

  // Injected by the Omarchy shell host.
  property string omarchyPath: Quickshell.env("OMARCHY_PATH")
  property var shell: null
  property var manifest: null

  readonly property string pluginId: (manifest && manifest.id) || "io.github.adampog.literal-web-crawler"

  // The host reads `opened` to decide whether a toggle opens or closes us, so
  // it turns true the moment we are asked to open, while the screenshot is
  // still being taken. The screens only appear once `captured` is true too.
  property bool opened: false
  property bool captured: false
  property bool screensaver: false
  // Set when an open arrives while the previous capture is still finishing.
  property bool captureAgain: false

  // Screenshots go to a per-user tmpfs folder; each open gets a fresh stamp so
  // QML never shows a cached picture from the last run.
  readonly property string captureDir: (Quickshell.env("XDG_RUNTIME_DIR") || "/tmp") + "/literal-web-crawler"
  property string captureStamp: ""

  // Settings shared by every screen. The keyboard controls change these.
  property real size: 1
  property real ripRate: 0.35
  property bool paused: false
  property bool follow: false
  // Bumped to tell every screen to put its torn pieces back.
  property int repairGeneration: 0

  readonly property string focusedScreenName: Hyprland.focusedMonitor ? String(Hyprland.focusedMonitor.name || "") : ""

  function log(message) {
    console.info("literal-web-crawler: " + message)
  }

  function open(payloadJson) {
    var payload = ({})
    try { payload = JSON.parse(payloadJson || "{}") } catch (e) { payload = ({}) }
    root.screensaver = payload.mode === "screensaver"
    if (root.opened) return

    root.opened = true
    root.captured = false
    root.paused = false
    root.log("open (" + (root.screensaver ? "screensaver" : "interactive") + ")")
    if (capture.running) {
      // A close-then-open faster than grim: shoot again once it finishes.
      root.captureAgain = true
      return
    }
    root.startCapture()
  }

  // Capture first, then show: the overlay must not be in its own screenshot.
  function startCapture() {
    root.captureStamp = String(Date.now())
    var names = []
    for (var i = 0; i < Quickshell.screens.length; i++) names.push(Quickshell.screens[i].name)
    capture.command = ["bash", "-c", root.captureScript, "literal-web-crawler", root.captureDir, root.captureStamp].concat(names)
    capture.running = true
  }

  function close() {
    if (root.opened) root.log("close")
    root.opened = false
    root.captured = false
    root.captureAgain = false
    cleanup.running = true
  }

  // Close from inside the overlay, and tell the host so its state matches.
  function dismiss() {
    root.close()
    if (root.shell && typeof root.shell.hide === "function") root.shell.hide(root.pluginId)
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open("{}")
  }

  function shotPath(screenName) {
    return root.captureDir + "/" + screenName + "-" + root.captureStamp + ".png"
  }

  // $1 = folder, $2 = stamp, then one output name per monitor.
  readonly property string captureScript: [
    "dir=$1; stamp=$2; shift 2",
    "command -v grim >/dev/null || exit 127",
    "mkdir -p \"$dir\" && rm -f \"$dir\"/*.png",
    "for out in \"$@\"; do grim -o \"$out\" \"$dir/$out-$stamp.png\" || exit 1; done"
  ].join("\n")

  Process {
    id: capture
    onExited: function(exitCode) {
      if (root.captureAgain) {
        root.captureAgain = false
        if (root.opened) root.startCapture()
        return
      }
      // Closed while grim was still running: nothing to show.
      if (!root.opened) return
      if (exitCode === 0) {
        root.log("captured " + Quickshell.screens.length + " screen(s)")
        root.captured = true
        return
      }
      root.log("capture failed with exit code " + exitCode)
      var why = exitCode === 127 ? "Install grim to let the spider see your screen" : "Could not take a screenshot"
      Quickshell.execDetached([root.omarchyPath + "/bin/omarchy-notification-send", "Literal Web Crawler", why])
      root.dismiss()
    }
  }

  Process {
    id: cleanup
    command: ["bash", "-c", "rm -f \"$1\"/*.png", "literal-web-crawler", root.captureDir]
  }

  // One window per monitor, created on open and destroyed on close.
  Variants {
    model: root.opened && root.captured ? Quickshell.screens : []

    CrawlerScreen {
      required property var modelData

      screen: modelData
      host: root
      shotPath: root.shotPath(modelData.name)
      focused: modelData.name === root.focusedScreenName || Quickshell.screens.length === 1
    }
  }
}
